# CoreS3 スナップ → Mac ローカルサーバ 自動アップロード 手順

撮影(1タップ)と同時に、加工後の画像を Mac 上のローカルサーバへ送って PNG 保存します。

```
CoreS3 (WiFi) ──POST 生RGB565──> Mac: upload_server.py ──PNG──> server/shots/
```

## 前提

- CoreS3 と Mac が **同じ WiFi** に接続していること
- Mac 側に Python 3

## 1. Mac 側サーバを起動

```bash
pip install numpy pillow
python3 "server/upload_server.py"
```

起動すると `listening on http://0.0.0.0:8080/upload` と出ます。受信した画像は
`server/shots/` に `cores3_YYYYMMDD_HHMMSS_*.png` で溜まっていきます。

## 2. Mac のローカルIPを調べる

```bash
ipconfig getifaddr en0
```

`192.168.x.x` のような値が出ます（Wi‑Fiが en0 でなければ `en1` も試す）。

## 3. スケッチにWiFiとIPを設定

`cores3_cam_effects.ino` の先頭を自分の環境に書き換える:

```cpp
const char* WIFI_SSID  = "あなたのSSID";
const char* WIFI_PASS  = "あなたのパスワード";
const char* UPLOAD_URL = "http://192.168.x.x:8080/upload";  // ← 手順2のIP
```

書き換えたら CoreS3 に書き込み。起動時に画面へ **「WiFi接続OK」** が出れば成功
（Serial モニタにも `WiFi OK  IP=...` が出ます）。

## 4. 撮る

ライブ画面で **1タップ** → 加工後の絵が保存され、そのままアップロード。
成功すると画面に **「送信OK」**、Mac のターミナルに `saved cores3_....png` が出ます。

## 動作の要点

- **送信するのは生の RGB565 バイト**。PNG 変換は Mac 側で行う（デバイスを軽く保つため）
- カメラ由来のバイト順は `X-Bswap` ヘッダでサーバに伝え、サーバ側で吸収
- **オフラインでも動く**: WiFi 未接続でもローカル保存＆アルバムは機能（送信だけスキップ）
- アップロードは同期処理なので、送信中の一瞬だけプレビューが止まります

## うまくいかない時

| 症状 | 対処 |
|---|---|
| 「WiFi未接続(ローカルのみ)」 | SSID/パスワードを確認。2.4GHz帯に接続しているか（ESP32は5GHz非対応） |
| 「送信失敗」 | `UPLOAD_URL` のIPが正しいか／サーバが起動中か。Mac のファイアウォールで python の受信を許可 |
| Mac に届かない | CoreS3 と Mac が同じネットワーク/SSIDか（ゲストWiFi分離に注意） |
| 画像の色が変 | スケッチの `CAM_BSWAP` を切り替えて再送。サーバは `X-Bswap` を見て自動対応 |
| `ipconfig getifaddr en0` が空 | Wi‑Fiインターフェースが違う。`en1` を試す／`ifconfig` で確認 |

## 発展

- **JPEG保存**にしたい → サーバの `save(path)` を `.jpg` に変えるだけ
- **ブラウザで一覧表示** → `server/shots/` を返す簡易ギャラリーを足す（必要なら作ります）
- **非同期アップロード**（プレビューを止めない）→ FreeRTOSタスクに送信を逃がす構成に変更可
