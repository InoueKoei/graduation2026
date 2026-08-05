# CoreS3 タイポグラフィ・デモ「文字を積もらせる」 — 書き込み手順

M5Stack CoreS3 / CoreS3 SE に `cores3_typography_demo.ino` を書き込むための手順です。
`moji-stack`（文字が皿に積もる）をハードウェアに移植したデモで、追加センサは不要。
CoreS3 内蔵の **液晶 / タッチ / IMU / スピーカー** だけで動きます。

## 操作

| 操作 | 反応 |
|---|---|
| 画面をタップ | その場所に文字が生まれて降る |
| 本体を傾ける | IMU の加速度が重力になり文字が流れる |
| 本体を振る | 溜まった文字が一気に散る |
| （自動） | 文字どうしが衝突して積もる ＋ 効果音 |

---

## 方法A：Arduino IDE（おすすめ・簡単）

### 1. Arduino IDE を用意
[Arduino IDE 2.x](https://www.arduino.cc/en/software) をインストール。

### 2. M5Stack のボード定義を追加
1. `Arduino IDE` → `設定`（macOS は `Arduino IDE` メニュー → `Settings…`）を開く
2. **「追加のボードマネージャのURL」** に次を貼る:
   ```
   https://static-cdn.m5stack.com/resource/arduino/package_m5stack_index.json
   ```
3. `ツール` → `ボード` → `ボードマネージャ` を開き、**`M5Stack`** を検索してインストール

### 3. ライブラリを入れる
`ツール` → `ライブラリを管理` → **`M5Unified`** を検索してインストール
（依存の `M5GFX` も一緒に入ります）

### 4. ボードを選ぶ
`ツール` → `ボード` → `M5Stack` → **`M5CoreS3`** を選択

### 5. 本体を接続してポートを選ぶ
- USB-C ケーブルで Mac と CoreS3 を接続（**データ通信対応のケーブル**を使うこと。充電専用だと認識しません）
- `ツール` → `ポート` → **`/dev/cu.usbmodem…`** を選択
- CoreS3 はネイティブ USB なので、Mac では **ドライバのインストール不要**です

### 6. 推奨アップロード設定（通常は自動でOK）
| 項目 | 値 |
|---|---|
| Upload Speed | 921600 |
| USB Mode | Hardware CDC and JTAG |
| Flash Size | 16MB |
| PSRAM | 任意（有効推奨） |

### 7. 書き込む
- このフォルダ（`cores3_typography_demo`）内の `cores3_typography_demo.ino` を Arduino IDE で開く
  （※ `.ino` は **同名フォルダの中に置く**必要があります。このリポジトリはその形になっています）
- 左上の **→（Upload）** をクリック
- CoreS3 は通常そのまま書き込みモードに入ります。うまくいかない時は本体側面の **RESET を押しながら Upload** → ログに `Connecting…` が出たら離す

書き込み後、自動でデモが起動します。

---

## 方法B：PlatformIO（VS Code 派向け）

1. VS Code に PlatformIO 拡張を入れる
2. プロジェクト直下に `platformio.ini` を作成:
   ```ini
   [env:m5stack-cores3]
   platform      = espressif32
   board         = m5stack-cores3
   framework     = arduino
   lib_deps      = m5stack/M5Unified
   monitor_speed = 115200
   upload_speed  = 1500000
   ```
3. `cores3_typography_demo.ino` の中身を **`src/main.cpp`** にコピー
   （先頭に `#include <Arduino.h>` は不要。M5Unified が取り込みます）
4. PlatformIO の **Upload**（→ アイコン）で書き込み

---

## シリアルモニタ（任意）
`ツール` → `シリアルモニタ`、ボーレート **115200**。
デバッグ出力を足したい時は `.ino` に `Serial.printf(...)` を追記してください。

---

## うまくいかない時

| 症状 | 対処 |
|---|---|
| ポートが出てこない | 充電専用でないUSBケーブルに替える／別のUSBポートに挿す |
| `Connecting…` で止まる | 側面 RESET を押しながら Upload、`Connecting…` 表示で離す |
| 文字が流れる向きが逆 | `.ino` の `gx = ax * G;` `gy = -ay * G;` の**符号を入れ替える** |
| 傾けても動かない | IMU が読めていない可能性。まずはタップで文字が出るか確認 |
| 画面が真っ暗／固まる | スプライトのメモリ確保失敗の可能性。`.ino` は 16bit→8bit に自動フォールバックしますが、`MAX_P` を減らすとより安全 |
| 音が出ない | 本体スピーカーの音量は M5Unified 既定。`M5.Speaker.setVolume(200);` を `setup()` に追記して調整 |

---

## 手を加えるなら

- **積もる文字を変える** … `.ino` の `KANA[]` を差し替え（フォント対応内の漢字・記号もOK）
- **書体の印象を変える** … `setFont(&fonts::lgfxJapanGothic_24)` を `lgfxJapanMincho_24`（明朝）などに
- **重力・反発の感触** … `G` / `DAMP` / `REST_WALL` を調整
- **拡張の芽** … Grove Port A に **Weight Unit(重量)** を挿せば、実際の皿の重さで文字量を変える“本物の moji-stack”に発展できます
