#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KanaDance ローカルサーバ（USB 版）

    python server.py

app/ を配信し、参照ポーズを data/poses.json で読み書きするだけの小さなサーバ。
Python 3.7 以上の標準ライブラリだけで動く。追加インストールは要らない。

なぜ `python -m http.server` ではないのか:

  1. Windows の Python は MIME をレジストリから引くため、.js が text/plain
     で返ることがある。すると Chrome が ES モジュールの実行を拒否して
     画面が真っ白になる。ここでは拡張子→MIME を自前で固定して防ぐ。
  2. ポーズの保存に書き込み口（POST /api/poses）が要る。

カメラは http://localhost からなら使える（localhost は secure context 扱い）。
127.0.0.1 だけで待ち受けるので、同じ LAN の他の端末からは見えない。
"""

import gzip
import json
import os
import posixpath
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

# Windows のコンソールは既定が cp932 のことがあり、日本語を print した瞬間に
# UnicodeEncodeError で落ちる。出せない字は置き換えてでも動き続けさせる。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass  # 3.6 以下や差し替え済みの stdout ではそのまま使う

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(HERE, "app")
DATA_DIR = os.path.join(HERE, "data")
POSES_PATH = os.path.join(DATA_DIR, "poses.json")
MANIFEST_PATH = os.path.join(HERE, "manifest.json")

PORT = int(os.environ.get("PORT", "8000"))

# 拡張子 → MIME。OS の設定に左右されないよう、ここで決め打つ
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    # MediaPipe のモデル。中身はバイナリなので octet-stream でよい
    ".task": "application/octet-stream",
    ".tflite": "application/octet-stream",
    ".binarypb": "application/octet-stream",
    ".data": "application/octet-stream",
}

# poses.json の読み書きを直列化する（同時に触って壊さないため）
LOCK = threading.Lock()


def load_poses():
    """保存済みのポーズ一覧。無ければ空で始める"""
    if not os.path.exists(POSES_PATH):
        return []
    try:
        with open(POSES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (ValueError, OSError):
        # 壊れていても起動は止めない。空として扱う
        return []
    if isinstance(data, dict):
        data = data.get("poses", [])
    return data if isinstance(data, list) else []


def save_poses(rows):
    """書き途中で電源が落ちても元が残るよう、別名で書いてから差し替える"""
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = POSES_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, POSES_PATH)


def check_files():
    """
    manifest.json と突き合わせて、足りないファイルと途中で切れたファイルを見つける。

    フォルダを何回かに分けてコピーすると、1つ抜けたり、コピー途中で
    止まったりしやすい。そのまま起動すると「画面は出るのに線が出ない」
    のような分かりにくい壊れ方をするので、先に名指しで知らせる。

    data/ は動かしながら増えるので対象外。manifest が無ければ黙って通す。
    """
    if not os.path.exists(MANIFEST_PATH):
        return []
    try:
        with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
            expected = json.load(f)
    except (ValueError, OSError):
        return []

    problems = []
    for rel, size in sorted(expected.items()):
        full = os.path.join(HERE, rel.replace("/", os.sep))
        if not os.path.exists(full):
            problems.append((rel, "ありません"))
        else:
            actual = os.path.getsize(full)
            if actual != size:
                problems.append((rel, "途中で切れています（%d / %d バイト）" % (actual, size)))
    return problems


def safe_path(url_path):
    """app/ の外に出るリクエストを弾く。出ようとしたら None"""
    rel = posixpath.normpath(unquote(url_path)).lstrip("/")
    target = os.path.normpath(os.path.join(APP_DIR, rel.replace("/", os.sep)))
    if target != APP_DIR and not target.startswith(APP_DIR + os.sep):
        return None
    return target


class Handler(BaseHTTPRequestHandler):
    server_version = "KanaDanceUSB/1.0"

    def log_message(self, fmt, *args):
        # 既定のログは煩いので、失敗だけ出す
        if not args or str(args[1]).startswith(("2", "3")):
            return
        sys.stderr.write("  %s\n" % (fmt % args))

    # ── 応答の小道具 ────────────────────────────────────────
    def _send(self, status, body, content_type="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status, obj):
        self._send(status, json.dumps(obj, ensure_ascii=False),
                   "application/json; charset=utf-8")

    # ── GET ────────────────────────────────────────────────
    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/poses":
            with LOCK:
                rows = load_poses()
            return self._send_json(200, rows)

        if path == "/":
            path = "/index.html"

        target = safe_path(path)
        if target is None:
            return self._send(403, "forbidden")
        if os.path.isdir(target):
            target = os.path.join(target, "index.html")

        # 大きいものは .gz で置いてある（wasm は 8.3MB → 2.5MB）。
        # そのまま送って Content-Encoding: gzip を付ければ、
        # ブラウザが勝手に展開するので中身は何も変わらない。
        packed = None
        if not os.path.isfile(target) and os.path.isfile(target + ".gz"):
            packed = target + ".gz"
        if packed is None and not os.path.isfile(target):
            return self._send(404, "not found: %s" % path)

        ext = os.path.splitext(target)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")
        accepts_gzip = "gzip" in (self.headers.get("Accept-Encoding") or "")

        try:
            with open(packed or target, "rb") as f:
                body = f.read()
        except OSError as err:
            return self._send(500, "読めません: %s" % err)

        encoding = None
        if packed:
            if accepts_gzip:
                encoding = "gzip"
            else:
                # gzip を受け付けない相手（まず無い）には、その場で戻して渡す
                body = gzip.decompress(body)

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        if encoding:
            self.send_header("Content-Encoding", encoding)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # ── POST ───────────────────────────────────────────────
    def do_POST(self):
        if urlparse(self.path).path != "/api/poses":
            return self._send(404, "not found")

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 1024 * 1024:
            return self._send(400, "本文の長さが不正です")

        try:
            record = json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:
            return self._send(400, "JSON として読めません")

        letter = record.get("letter")
        points = record.get("points")
        if not isinstance(letter, str) or not letter or not isinstance(points, dict):
            return self._send(400, "letter と points が要ります")

        row = {"letter": letter, "points": points}
        if isinstance(record.get("lines"), list):
            row["lines"] = record["lines"]

        try:
            with LOCK:
                rows = load_poses()
                rows.append(row)
                save_poses(rows)
        except OSError as err:
            # USB が書き込み禁止だったときはここに来る
            return self._send(500, "保存できません（USB が書き込み可か確認してください）: %s" % err)

        return self._send_json(200, {"saved": letter, "count": len(rows)})


def main():
    if not os.path.isdir(APP_DIR):
        sys.exit("app/ が見つかりません。フォルダごとコピーできているか確認してください。")

    problems = check_files()
    if problems:
        print("")
        print("  ファイルが揃っていません（%d 件）" % len(problems))
        print("  " + "-" * 40)
        for rel, why in problems[:12]:
            print("    %s … %s" % (rel, why))
        if len(problems) > 12:
            print("    ほか %d 件" % (len(problems) - 12))
        print("")
        print("  分けてコピーした場合は、コピーし残しがないか確かめてください。")
        print("  フォルダごと入れ直すのが確実です。")
        print("", flush=True)
        sys.exit(1)

    os.makedirs(DATA_DIR, exist_ok=True)
    url = "http://localhost:%d/" % PORT

    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as err:
        sys.exit("ポート %d を使えません（別のものが使っている可能性）: %s" % (PORT, err))

    print("")
    print("  KanaDance （ローカル版）")
    print("  " + "-" * 40)
    print("  %s" % url)
    print("  登録したポーズの保存先: %s" % POSES_PATH)
    print("  いま %d 件" % len(load_poses()))
    print("")
    print("  終了するときはこの画面で Ctrl+C。")
    print("", flush=True)

    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  終了しました。")


if __name__ == "__main__":
    main()
