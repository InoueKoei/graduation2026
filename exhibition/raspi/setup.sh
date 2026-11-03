#!/usr/bin/env bash
# ============================================================
#  setup.sh — ラズパイを展示機にする
#
#  ラズパイの上で（デスクトップ版 Raspberry Pi OS、ふだん使うユーザーで）:
#    bash ~/graduation2026/exhibition/raspi/setup.sh            # StepToggle
#    bash ~/graduation2026/exhibition/raspi/setup.sh KanaDance  # 別の作品
#
#  やること（何度流してもよい）:
#    1. exhibition/ をローカルで配る小さなサーバを、起動時に立ち上がるようにする（systemd）
#    2. ログインしたら Chromium を全画面・自動再生許可で開くようにする（XDG autostart）
#    3. 画面が消えないようにする
#  ネットが無い会場でも動くよう、ページは GitHub Pages ではなくラズパイの中から出す。
# ============================================================
set -euo pipefail

WORK="${1:-StepToggle}"
PORT=8991
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVE_DIR="$REPO_DIR/exhibition"
URL="http://localhost:$PORT/$WORK/"

if [ ! -d "$SERVE_DIR/$WORK" ]; then
  echo "exhibition/$WORK が見つかりません。作品名を確かめてください:" >&2
  ls "$SERVE_DIR" >&2
  exit 1
fi

# Bookworm までは chromium-browser、それ以降は chromium
BROWSER="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$BROWSER" ]; then
  echo "Chromium を入れます"
  sudo apt-get update
  sudo apt-get install -y chromium-browser || sudo apt-get install -y chromium
  BROWSER="$(command -v chromium-browser || command -v chromium)"
fi

# 日本語の字が豆腐（□）にならないように
if ! fc-list :lang=ja | grep -q .; then
  echo "日本語フォント（Noto CJK）を入れます"
  sudo apt-get update
  sudo apt-get install -y fonts-noto-cjk
fi

echo "1/3 ローカルサーバ（port $PORT, $SERVE_DIR）"
sudo tee /etc/systemd/system/exhibition-server.service >/dev/null <<EOF
[Unit]
Description=Exhibition static server
After=network.target

[Service]
User=$USER
WorkingDirectory=$SERVE_DIR
ExecStart=/usr/bin/python3 -m http.server $PORT --bind 127.0.0.1
Restart=always

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now exhibition-server.service
sudo systemctl restart exhibition-server.service

echo "2/3 ログイン時に $URL を全画面で開く"
#  --autoplay-policy  マットの踏み込みはクリックに数えられないので、これが無いと音が出ない
#  --password-store   起動のたびに鍵束のパスワードを聞かれないように
#  --check-for-update-interval  更新の案内を出さない
mkdir -p "$HOME/.config/autostart"
cat >"$HOME/.config/autostart/exhibition.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Exhibition ($WORK)
Exec=$BROWSER --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required --password-store=basic --check-for-update-interval=31536000 $URL
X-GNOME-Autostart-enabled=true
EOF

echo "3/3 画面を消さない"
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_blanking 1 || true   # 1 = 消さない
fi

# 自動ログインになっていなければ知らせる（電源を入れただけで始まるようにするため）
if command -v raspi-config >/dev/null && [ "$(sudo raspi-config nonint get_autologin 2>/dev/null || echo 1)" != 0 ]; then
  echo "※ 自動ログインが切れています。電源を入れるだけで始めたいなら:"
  echo "   sudo raspi-config → System Options → Boot / Auto Login → Desktop Autologin"
fi

sleep 1
if curl -fsS -o /dev/null "$URL"; then
  echo "OK: $URL を配っています。再起動すると全画面で開きます（sudo reboot）"
else
  echo "サーバが応答しません: sudo systemctl status exhibition-server" >&2
  exit 1
fi
