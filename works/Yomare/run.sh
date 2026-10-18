#!/bin/zsh
# Yomare を起動する。ocr_server.swift が新しければビルドし直す。
#   ./run.sh          → http://localhost:8765/
#   ./run.sh 8766     → ポートを変える
set -e
cd "$(dirname "$0")"
mkdir -p .build
if [[ ! -x .build/ocr_server || ocr_server.swift -nt .build/ocr_server ]]; then
  echo "ビルド中…"
  swiftc -O -swift-version 5 -o .build/ocr_server ocr_server.swift
fi
exec .build/ocr_server "${1:-8765}" web
