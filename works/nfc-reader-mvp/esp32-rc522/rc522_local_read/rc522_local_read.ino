/* ============================================================
   ① ローカル動作確認：RC522 でタグの UID を読んでシリアルに出すだけ
   ------------------------------------------------------------
   目的：配線チェックと、各札(NFCタグ)の UID 採取。
   　　　ここで採った UID を ②rc522_scan_to_server の対応表に貼る。
   Wi-Fi は使わない（まずローカルで）。

   ■ 使うもの
     - ESP32 開発ボード（無印 ESP32 等）
     - RFID-RC522 モジュール（13.56MHz / SPI）
     - ジャンパー線

   ■ ライブラリ（Arduino IDE → ライブラリマネージャ）
     - "MFRC522" by GithubCommunity（miguelbalboa/rfid）をインストール

   ■ 配線（RC522 → ESP32）※ RC522 は 3.3V 専用。5V に挿さないこと！
     RC522        ESP32
     ---------    ------------------
     SDA(SS)  ->  GPIO 5
     SCK      ->  GPIO 18
     MOSI     ->  GPIO 23
     MISO     ->  GPIO 19
     IRQ      ->  未接続
     GND      ->  GND
     RST      ->  GPIO 22
     3.3V     ->  3V3   （※必ず 3.3V）

   ■ 使い方
     1. Arduino IDE のボードを「ESP32 Dev Module」等にして書き込み
     2. シリアルモニタを 115200 bps で開く
     3. タグをかざすと UID が出る。札ごとにかざして UID を控える
   ============================================================ */

#include <SPI.h>
#include <MFRC522.h>

// --- 配線に合わせたピン（変えたらここ） ---
#define SS_PIN   5
#define RST_PIN  22

MFRC522 rfid(SS_PIN, RST_PIN);

// 同じタグを連続で読んだときに何度も出さないための簡易デバウンス
String lastUid = "";
unsigned long lastTime = 0;
const unsigned long DEBOUNCE_MS = 1500;

// UID バイト列を "DEADBEEF" 形式の大文字HEX文字列にする
String uidToString(MFRC522::Uid *uid) {
  String s = "";
  for (byte i = 0; i < uid->size; i++) {
    if (uid->uidByte[i] < 0x10) s += "0";
    s += String(uid->uidByte[i], HEX);
  }
  s.toUpperCase();
  return s;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  SPI.begin();          // ESP32 の既定 SPI (SCK18/MISO19/MOSI23)
  rfid.PCD_Init();
  Serial.println();
  Serial.println("=== RC522 ローカル読み取り 開始 ===");
  Serial.println("タグをかざしてください（UID を控えて ②の対応表に貼る）");
}

void loop() {
  // 新しいカードが来ていなければ何もしない
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  String uid = uidToString(&rfid.uid);

  // 直前と同じタグの連続読みは無視
  unsigned long now = millis();
  if (uid == lastUid && (now - lastTime) < DEBOUNCE_MS) {
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }
  lastUid = uid;
  lastTime = now;

  // 見やすい表示 ＋ ②に貼りやすい行を両方出す
  Serial.print("UID: ");
  Serial.println(uid);
  Serial.print("  → 対応表に貼る例:  { \"");
  Serial.print(uid);
  Serial.println("\", \"01\" },   // ← \"01\" を実際の札番号に直す");

  rfid.PICC_HaltA();       // 通信終了
  rfid.PCD_StopCrypto1();
}
