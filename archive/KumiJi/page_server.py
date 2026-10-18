#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# KumiJi — 認識結果をブラウザのページへ流す小さなサーバ
#   標準ライブラリだけ。WebSocket ライブラリは使わず SSE（Server-Sent Events）。
#   流すのは一方向だけなので SSE で足り、pip も要らない。
#
#   main.py が判定するたび push() を呼ぶ。ページは EventSource で受けて描く。
#
# 使い方:
#   import page_server
#   page_server.start(8899)            # http://localhost:8899 を開く
#   page_server.push({"char": "は", "score": 0.82, ...})
# -----------------------------------------------------------------------------
import os
import json
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE_DIR = os.path.join(HERE, "page")

_clients = []          # 接続中のブラウザごとのキュー
_lock = threading.Lock()
_last = None           # 後から開いたページにも直近の状態を見せる


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass           # アクセスログは出さない（ターミナルが埋まるので）

    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]

        if path == "/events":
            # SSE。切断されるまでこの接続を保持し続ける。
            q = queue.Queue()
            with _lock:
                _clients.append(q)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            try:
                if _last:
                    self.wfile.write(f"data: {json.dumps(_last)}\n\n".encode())
                    self.wfile.flush()
                while True:
                    try:
                        ev = q.get(timeout=15)
                        self.wfile.write(f"data: {json.dumps(ev)}\n\n".encode())
                    except queue.Empty:
                        self.wfile.write(b": keep-alive\n\n")   # 切れないように
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                with _lock:
                    if q in _clients:
                        _clients.remove(q)
            return

        name = "index.html" if path == "/" else path.lstrip("/")
        target = os.path.normpath(os.path.join(PAGE_DIR, name))
        if not target.startswith(PAGE_DIR) or not os.path.isfile(target):
            self._send(404, "text/plain; charset=utf-8", b"not found")
            return
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
        }.get(os.path.splitext(target)[1], "application/octet-stream")
        with open(target, "rb") as f:
            self._send(200, ctype, f.read())


def start(port=8899, tries=6):
    """バックグラウンドでサーバを立てる。**失敗しても例外を投げない。**

    ページは補助なので、ポートが塞がっているだけで本体が落ちるのはおかしい。
    空いているポートを順に探し、どうしても無理ならページ無しで続行する。
    戻り値は実際に使ったポート（立たなければ None）。
    """
    for i in range(max(1, tries)):
        p = port + i
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", p), _Handler)
        except OSError as e:
            if i == 0:
                print(f"ページ: ポート {p} は使用中。空きを探す…（{e.strerror}）")
            continue
        srv.daemon_threads = True
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        print(f"ページ: http://localhost:{p}")
        return p
    print(f"ページ: ポート {port}〜{port + tries - 1} が全部塞がっている。"
          f"ページ無しで続行する（本体は動く）。")
    return None


def push(event):
    """認識結果を、開いている全ページへ流す。"""
    global _last
    _last = event
    with _lock:
        targets = list(_clients)
    for q in targets:
        q.put(event)
