# Sessan × CoreS3 ワイヤレスカメラ 手順

CoreS3（無印・カメラ機）を **Sessan のカメラ**として使う。CoreS3 は映像を MJPEG で
配信するだけで、かなの判定（MediaPipe Holistic）は **Mac のブラウザの Sessan** が行う。

```
CoreS3 (WiFi) ──MJPEG /stream──> Mac ブラウザ Sessan（MediaPipe＝ブラウザで実行）──> かな入力
```

> なぜこの構成か: MediaPipe Holistic（手＋顔メッシュ）は ESP32-S3 単体では動かせない。
> CoreS3 は「映像を送る」役に徹し、重い処理は Mac 側に置く。Python 常駐サーバは不要。

## 1. CoreS3 に書き込む

`cores3_sessan_cam.ino` の先頭を自分の WiFi に書き換える（**2.4GHz 帯**。ESP32 は 5GHz 不可）:

```cpp
const char* WIFI_SSID = "あなたのSSID";
const char* WIFI_PASS = "あなたのパスワード";
```

必要ライブラリは **M5CoreS3**（`esp_camera` / `img_converters` / `esp_http_server` は
Arduino-ESP32 コアに同梱）。書き込むと画面に **IP と `/stream` URL** が出る。
例: `http://192.168.1.42` … `/stream`

## 2. Sessan を開いてソースを CoreS3 にする

Sessan を **http でホスト**（既存のとおり）:

```bash
cd "…/SourceCode/Sessan"
python3 -m http.server 8000
# → http://localhost:8000/
```

ブラウザは **Chrome 推奨**（`<img>` の MJPEG ストリーム対応が確実）。

1. ステージ右上の **📷** を押す
2. CoreS3 の画面に出ている IP（例 `192.168.1.42`）を入力（`/stream` は省略可）
3. **「CoreS3 で開始」** → リロードして CoreS3 の映像で動き出す

URL で直接指定も可: `http://localhost:8000/?src=cores3&url=192.168.1.42`
Mac のカメラに戻すときは 📷 →「Mac カメラで開始」。設定は localStorage に保存される。

## 3. 使う

操作は通常の Sessan と同じ（指の本数＝行 / 口形＝段 / 保持で確定 / 目閉じ＝削除 / グー＝濁点）。
CoreS3 を三脚などで固定し、**手と顔が同時にフレームに入る距離**に立つ。

## 調整ノブ（`.ino` 冒頭）

| 症状 / 目的 | 対処 |
|---|---|
| 認識が甘い・指を拾わない | 既定は `FRAMESIZE_VGA`。距離を取り手と顔を両方フレームへ |
| カクつく・電波が弱い | `STREAM_FRAMESIZE` を `FRAMESIZE_QVGA` に落とす |
| 配信の色がおかしい | `CAM_BSWAP` を `0`/`1` で切り替え（cam_effects と同じ知見） |
| 映像が鏡像／上下逆 | `setup()` の `set_hmirror` / `set_vflip` のコメントを外す |
| 確定までが遅く感じる | WiFi 経由は Mac 内蔵カメラより fps が低め。`config.js` の `HOLD_FRAMES` を下げる |

## うまくいかない時

| 症状 | 対処 |
|---|---|
| 画面が「WiFi NG」 | SSID/パスワード確認。2.4GHz か（5GHz 不可）。ゲスト分離に注意 |
| Sessan で「接続できません」 | IP が合っているか。CoreS3 とブラウザが**同じ WiFi**か。ブラウザで `http://IP/`（末尾 stream なし）を直接開いて映像が出るか確認 |
| 映像は出るが判定されない | Chrome を使う／解像度・明るさを見直す。`http://localhost` で Sessan をホスト（`file://` や https 化は避ける） |
| 一瞬映って止まる | 別タブ/別PCが同じ CoreS3 に同時接続していないか（同時接続は 2〜3 まで） |

## 仕組みメモ

- CoreS3 は `esp_http_server` で `/stream` を multipart MJPEG 配信。RGB565 を
  `frame2jpg()` で JPEG 化して送る（`CAM_BSWAP` で色順を吸収）。
- 別オリジンのブラウザ canvas から画素を読めるよう、配信レスポンスに
  `Access-Control-Allow-Origin: *` を付与。Sessan 側は `<img crossOrigin="anonymous">`
  を毎フレーム Holistic に渡す（webcam の代わり）。判定・HUD・記録は無改造で共有。
