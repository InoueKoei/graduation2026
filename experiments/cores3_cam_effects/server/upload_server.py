#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# CoreS3 スナップ受信サーバ
#   CoreS3 が撮影時に POST してくる「加工後の生RGB565」を受け取り、
#   PNG に変換して ./shots/ に保存する。標準ライブラリ + numpy + Pillow のみ。
#
# 使い方:
#   pip install numpy pillow
#   python3 upload_server.py          # ポート8080で待ち受け
# -----------------------------------------------------------------------------
import os
import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from PIL import Image

PORT     = 8080
SAVE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        w      = int(self.headers.get("X-Width", 320))
        h      = int(self.headers.get("X-Height", 240))
        bswap  = self.headers.get("X-Bswap", "1") == "1"
        data   = self.rfile.read(length)

        # 生RGB565 → RGB888。X-Bswap で送られてくるバイト順を吸収する
        #   bswap=1: ワイヤ上はビッグエンディアン('>u2')
        #   bswap=0: リトルエンディアン('<u2')
        dtype = ">u2" if bswap else "<u2"
        px = np.frombuffer(data, dtype=dtype)[: w * h].reshape(h, w)
        r = (((px >> 11) & 0x1F) << 3).astype(np.uint8)
        g = (((px >> 5)  & 0x3F) << 2).astype(np.uint8)
        b = (( px        & 0x1F) << 3).astype(np.uint8)
        img = np.dstack([r, g, b])

        os.makedirs(SAVE_DIR, exist_ok=True)
        name = datetime.datetime.now().strftime("cores3_%Y%m%d_%H%M%S_%f") + ".png"
        path = os.path.join(SAVE_DIR, name)
        Image.fromarray(img, "RGB").save(path)
        print(f"saved {name}  ({w}x{h}, {length} bytes)")

        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass  # デフォルトのアクセスログは出さない（saved 行だけ表示）


if __name__ == "__main__":
    os.makedirs(SAVE_DIR, exist_ok=True)
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"listening on http://0.0.0.0:{PORT}/upload   → {SAVE_DIR}/ に保存")
    print("Ctrl+C で終了")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
