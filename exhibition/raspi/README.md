# ラズパイで展示する

電源を入れると作品が全画面で立ち上がり、マットとスピーカーをつなげばそのまま遊べる状態にする。
ページはラズパイの中から配るので、会場にネットが無くても動く（ネットが要るのは最初の取り込みと更新のときだけ）。

前提：デスクトップ版の Raspberry Pi OS が入っていて、ネットにつながっていること。

## 1. 取り込む（初回だけ）

ラズパイのターミナルで:

```sh
cd ~
git clone --depth 1 https://github.com/InoueKoei/graduation2026.git
```

## 2. 展示機にする

```sh
bash ~/graduation2026/exhibition/raspi/setup.sh
```

StepToggle 以外を出すなら作品名を足す（`KanaDance`、`HeadKana`、`moji-stack/dist`）。
Yomare は文字認識に Mac で動かすサーバが要るので、ラズパイ単体では出せない。

このスクリプトがやること:

- `exhibition/` を `http://localhost:8991/` で配るサーバを、起動時に自動で立ち上げる
- ログインしたら Chromium を全画面・音の自動再生許可で開く（**最初のクリックが要らなくなる**）
- 画面が消えないようにする
- 日本語フォントが無ければ入れる（Noto CJK）

HeadKana で商用書体を出すなら、Mac で焼いた `baked/` を別にコピーする（[HeadKana の README](../HeadKana/README.md#商用書体をラズパイで使う)）。

## 3. ラズパイの設定（初回だけ、`sudo raspi-config`）

- **自動ログイン**：System Options → Boot / Auto Login → **Desktop Autologin**。電源を入れるだけで始まる
- **音の出口**：System Options → Audio で、HDMI か USB スピーカーを選ぶ
  （ラズパイ3のイヤホン端子は雑音が乗りやすい）
- **画面の解像度**：重いときは Display Options で 1280×720 にする

設定したら `sudo reboot`。

## 4. 立ち上がったら確かめる

[StepToggle の本番チェックリスト](../StepToggle/README.md#本番チェックリスト展示版で足したもの)を上から。
ラズパイで特に見ておくこと:

- **踏んだ面が正しい字になるか**。マットの読み方は Mac の Chrome で測ったもので、Linux では番号がずれることがある。
  ずれていたら `StepToggle/config.js` の `BUTTON` と `CENTER_AXIS` を直す
- **すばやく踏んでも拾われるか**。マットは画面を描くたびに1回読むので、描画が遅いと取りこぼす。
  重いと感じたら解像度を下げる、ふたりのずれの見せ方を「ぼかし」以外にする
- **クリックが鳴るか**（右上の札が「調整」だけなら音は出せる状態）

全画面から抜けるのは `Alt`+`F4`（または `Ctrl`+`W`）。

## 更新するとき

Mac で直して main に push したあと、ラズパイで:

```sh
cd ~/graduation2026 && git pull
```

ページを読み直せば（`F5`、または再起動）新しい版になる。サーバは同じフォルダを配っているので再設定は要らない。

## 元に戻すとき

```sh
sudo systemctl disable --now exhibition-server
rm ~/.config/autostart/exhibition.desktop
```
