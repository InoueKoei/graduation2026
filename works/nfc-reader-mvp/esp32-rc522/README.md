# ESP32 + RFID-RC522 リーダー

iPhone の代わりに **ESP32 + RC522** を「NFCリーダー」にして、既存の `nfc-reader-mvp` サーバー（`/scan?card=NN`）へタグのスキャンを送る。

段階を分けてある：

| スケッチ | 役割 |
|---|---|
| `rc522_local_read/` | **まずローカル**。UID を読んでシリアルに出すだけ（配線確認＋各札の UID 採取） |
| `rc522_scan_to_server/` | Wi-Fi 版。UID→札番号に変換し、Wi-Fi でサーバーへ送信＋振動フィードバック |
| `rc522_ble/` | **展示用 BLE 版（推奨）**。Wi-Fi 不要。ESP32↔Chrome を直接 BLE 接続。会場ネットワークに一切依存しない |

## 展示用 BLE 版（`rc522_ble`）— WiFi 不要

会場の Wi-Fi・ルーター・IP変動に依存しない構成。ESP32 が BLE 機器になり、表示PCの Chrome と直接つながる。

- **ESP32**：札をかざす→札番号を BLE で notify。ブラウザから判定結果("vibrate"/"none")を受けて手元モーターを鳴らす。
- **表示PC**：Chrome で `http://localhost:3000/` を開き、画面下部の「🔵 Bluetooth接続」を1回押して ESP32 とペアリング。以後、札をかざすと大画面が反応＋手元が振動。
- **サーバー**：`node server.js` を localhost で起動しておくだけ（ネットワーク不要）。

### 手順
1. `rc522_ble` を ESP32 に書き込み（ライブラリは MFRC522 のみ。BLE は ESP32 core 同梱で追加不要）
2. Mac で `node server.js` 起動
3. **Chrome** で `http://localhost:3000/` を開く（※`localhost` で。`192.168…` では Web Bluetooth が動かない）
4. 「🔵 Bluetooth接続」→ デバイス「NadaKaruta」を選ぶ → 接続
5. スタート → 札をかざすと大画面が反応、間違いで手元が振動

### 注意
- **Chrome/Edge 必須**（Safari は Web Bluetooth 非対応）。表示は必ず `localhost` で開く（安全なコンテキスト要件）。
- 無印 ESP32 で動作（**ESP32-S2 は BLE 非対応で不可**）。
- UID→札番号の対応表・配線・3.3V注意は Wi-Fi 版と共通。

## 用意するもの

- ESP32 開発ボード（無印 ESP32 等）＋ USB ケーブル
- RFID-RC522 モジュール（13.56MHz / SPI）
- ジャンパー線（メス–オス 7本）
- （任意）振動モーター or ブザー or LED … 手元フィードバック用

## ライブラリ（Arduino IDE）

- ライブラリマネージャで **「MFRC522」by GithubCommunity（miguelbalboa/rfid）** をインストール。
- ボードは既存の ESP32 環境（「ESP32 Dev Module」等）でOK。

## 配線（RC522 → ESP32）

> ⚠️ **RC522 は 3.3V 専用。5V に挿すと壊れます。**

| RC522 | ESP32 |
|---|---|
| SDA (SS) | GPIO 5 |
| SCK | GPIO 18 |
| MOSI | GPIO 23 |
| MISO | GPIO 19 |
| IRQ | 未接続 |
| GND | GND |
| RST | GPIO 22 |
| 3.3V | **3V3** |

ピンを変えたいときは各 `.ino` 冒頭の `SS_PIN` / `RST_PIN` を編集。

## 手順

### 1. ローカルで UID 採取（`rc522_local_read`）

1. スケッチを書き込み → シリアルモニタ **115200 bps**
2. 札を1枚ずつかざす → UID（例 `04A1B2C3`）が出る
3. 全札ぶん UID を控える。`{ "04A1B2C3", "01" },` の形で出力されるので、②にそのまま貼れる

### 2. サーバー起動（Mac）

```bash
cd nfc-reader-mvp
node server.js
```
表示画面の下部／起動ログに出る **「接続先」の IP:PORT** を控える（例 `192.168.10.130:3000`）。

### 3. サーバー送信版を設定・書き込み（`rc522_scan_to_server`）

`.ino` の CONFIG を埋める：
- `WIFI_SSID` / `WIFI_PASS`（**Mac と同じネットワーク**）
- `SERVER_HOST`（例 `"192.168.10.130:3000"`）
- `tags[]` に ①で採取した UID → 札番号の対応を貼る

書き込むと、タグをかざすたび `GET /scan?card=NN&format=haptic` が飛び、
サーバーの大画面が反応し、返り値（`vibrate`/`none`）で手元がフィードバック。

## 既存タグ・iPhone版との関係

- RC522 は各タグ固有の **UID** を読む（iPhone版のように URL を書き込む必要はない）。**同じ NFC タグ（NTAG213 等）をそのまま使える**。UID→札番号の対応だけ ESP32 側で持つ。
- サーバー側（`/scan?card=NN`）は iPhone でも ESP32 でも同じ。**判定・お題・タイマー・表示はすべてサーバーが担当**。ESP32 は「読んで送るだけ」。
- 手元フィードバックは `FEEDBACK_PIN`（既定 GPIO2＝内蔵LED）。ここに **振動モーター/ブザー** を繋げば、そのまま身体フィードバックになる（不正解=ブブッと2回／正解=軽く1回）。

## つまずきポイント

- **RC522 を 3.3V で**。5V厳禁。
- **同一ネットワーク・同一サブネット**（iPhone版と同じ。繋がらないときは親プロジェクトの README 参照）。
- UID の書式は大文字HEX・区切りなし（例 `04A1B2C3`）。①と②で同じ関数を使うので一致する。
- MFRC522 ライブラリ未導入だとコンパイルエラー → ライブラリマネージャで導入。
