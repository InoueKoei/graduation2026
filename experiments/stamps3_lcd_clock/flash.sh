#!/bin/bash
# このフォルダのスケッチをビルドして焼く。
#
#   ./flash.sh
#
# Arduino IDE にコピペしてはいけない。スケッチブックのコピーは別物なので、
# ディスク側をいくら直しても焼かれるのは古いコードのままになる（2026-09-16 に丸一晩踏んだ）。
# kana.h を分けてある以上、.ino だけ貼ってもコンパイルも通らない。
set -u
SKETCH="$(cd "$(dirname "$0")" && pwd)"
FQBN=esp32:esp32:m5stack_stamp_s3
LIBS="$HOME/Library/Arduino15/libraries"

PORT="${1:-$(ls /dev/cu.usbmodem* 2>/dev/null | head -1)}"
if [ -z "$PORT" ]; then echo "ポートが見つからない。USB を挿してください。"; exit 1; fi

if lsof "$PORT" >/dev/null 2>&1; then
  echo "$PORT が塞がっています。lcd_daemon.py か IDE のシリアルモニタを止めてください。"
  exit 1
fi

echo "== build =="
# esptool の merge-bin が失敗することがあるが、実体の .bin はその前に出来ている。
# 本当に失敗したかは .bin の有無で判定する。
arduino-cli compile --fqbn "$FQBN" --libraries "$LIBS" "$SKETCH" 2>&1 | grep -vE "^\s*$"
BIN=$(ls "$HOME/Library/Caches/arduino/sketches/"*/"$(basename "$SKETCH").ino.bin" 2>/dev/null | head -1)
if [ -z "$BIN" ]; then echo "ビルド失敗（.bin が出来ていない）"; exit 1; fi
echo "built: $BIN"

echo "== upload to $PORT =="
arduino-cli upload -p "$PORT" --fqbn "$FQBN" "$SKETCH" || {
  echo "書き込み失敗。G0 を押しながら USB を挿し直してもう一度。"; exit 1; }
echo "完了。lcd_daemon.py を起動し直してください。"
