#!/usr/bin/env python3
"""液晶につながる唯一のプロセス。時計を同期しつつ、UDP で受けた行をそのまま流す。

    python3 lcd_daemon.py

シリアルポートは 1 プロセスしか開けないので、Claude のフックやカレンダー監視など
複数の送り手がある場合は、必ずここを経由させる。送り手側は lcd_send.py を使う。

なぜ UDP か: 名前付きパイプ（FIFO）だと読み手がいないときに書き込みが永久にブロックする。
フックから使うと Claude Code 自体が固まるので、受け手がいなければ黙って捨てられる UDP にした。

必要なもの: pyserial（pip3 install --user pyserial）。天気は標準ライブラリだけで取れる。
"""

import argparse
import glob
import json
import select
import socket
import time
import urllib.request

import serial  # pip3 install --user pyserial

UDP_ADDR = "127.0.0.1"
UDP_PORT = 9123


def wmo_to_wx(code):
    """WMO の天気コード → スケッチ側の 0=ハレ 1=クモ 2=アメ 3=ユキ 4=カミ"""
    if code in (0, 1):
        return 0
    if code in (2, 3, 45, 48):
        return 1
    if 51 <= code <= 67 or 80 <= code <= 82:
        return 2
    if 71 <= code <= 77 or code in (85, 86):
        return 3
    if code in (95, 96, 99):
        return 4
    return 1


def find_port():
    # StampS3 は USB-CDC なので mac では cu.usbmodem* に出る
    for pat in ("/dev/cu.usbmodem*", "/dev/ttyACM*", "/dev/ttyUSB*"):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[0]
    return None


def fetch_weather(lat, lon, timeout=8):
    url = ("https://api.open-meteo.com/v1/forecast"
           f"?latitude={lat}&longitude={lon}&current=weather_code")
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return int(json.load(r)["current"]["weather_code"])


def open_port(args):
    """ポートを開く。IDE のシリアルモニタが掴んでいる間は待ち続ける。"""
    warned = False
    while True:
        port = args.port or find_port()
        if not port:
            if not warned:
                print("シリアルポートが見つからない。USB を挿してください（--port で明示も可）。")
                warned = True
            time.sleep(2.0)
            continue
        try:
            ser = serial.Serial(port, 115200, timeout=0)
            print(f"port: {port}")
            return ser
        except serial.SerialException as e:
            if not warned:
                if "Resource busy" in str(e) or "Errno 16" in str(e):
                    print(f"{port} が塞がっています。")
                    print("  Arduino IDE のシリアルモニタを閉じてください。閉じたら自動で繋がります。")
                else:
                    print(f"開けない: {e}")
                warned = True
            time.sleep(2.0)


def serve(args, sock):
    ser = open_port(args)
    time.sleep(2.0)   # ESP32-S3 は USB を開くとリセットがかかる。起動を待つ

    next_sync = 0.0
    next_weather = 0.0
    wx = None
    rx = b""

    while True:
        now = time.time()

        if now >= next_sync:
            next_sync = now + args.interval
            # ローカル時刻の epoch を送る。ESP32 側は gmtime で読むので、ここで時差を足しておく
            ser.write(f"S{int(now) + time.localtime().tm_gmtoff}\n".encode())

        if not args.no_weather and now >= next_weather:
            next_weather = now + 600
            try:
                code = fetch_weather(args.lat, args.lon)
                new_wx = wmo_to_wx(code)
                if new_wx != wx:
                    wx = new_wx
                    ser.write(f"W{wx}\n".encode())
                    print(f"weather: WMO {code} -> {wx}")
            except Exception as e:
                print(f"天気の取得に失敗（時刻だけ続けます）: {e}")

        # UDP を待ちつつ、1 秒ごとに上の定期処理へ戻る
        ready, _, _ = select.select([sock], [], [], 1.0)
        if ready:
            data, _addr = sock.recvfrom(4096)
            for raw in data.decode("utf-8", "replace").splitlines():
                cmd = raw.strip()
                if cmd:
                    ser.write((cmd + "\n").encode())
                    print(f"  > {cmd}")

        # ESP32 からの応答
        chunk = ser.read(4096)
        if chunk:
            rx += chunk
            while b"\n" in rx:
                one, rx = rx.split(b"\n", 1)
                line = one.decode("utf-8", "replace").strip()
                if line:
                    print(f"  < {line}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=None, help="省略すると自動検出")
    ap.add_argument("--lat", type=float, default=35.68)
    ap.add_argument("--lon", type=float, default=139.76)
    ap.add_argument("--no-weather", action="store_true")
    ap.add_argument("--interval", type=float, default=60.0, help="時刻を投げ直す間隔（秒）")
    ap.add_argument("--udp-port", type=int, default=UDP_PORT)
    args = ap.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((UDP_ADDR, args.udp_port))
    print(f"listening: udp://{UDP_ADDR}:{args.udp_port}")
    print("Ctrl+C で終了。ESP32 側の時計はそのまま動き続けます。")

    while True:
        try:
            serve(args, sock)
        except KeyboardInterrupt:
            print("\n終了。ESP32 側の時計はそのまま動き続けます。")
            return
        except serial.SerialException as e:
            # 焼き直しやモニタの開閉でポートは頻繁に消える。黙って待って繋ぎ直す
            print(f"切断: {e}\n  5 秒後に繋ぎ直します。")
            try:
                time.sleep(5.0)
            except KeyboardInterrupt:
                return


if __name__ == "__main__":
    main()
