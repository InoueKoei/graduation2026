/* ============================================================
   ③ 展示用：RC522 → BLE でブラウザ(Chrome)へ直結
   ------------------------------------------------------------
   WiFi・ルーター・IP を一切使わない展示向け構成。
   ESP32 が BLE 機器になり、Chrome の表示ページと直接つながる。
     - 札をかざす → 札番号(01〜) を「スキャン特性」で notify
     - ブラウザが judge 結果("vibrate"/"none") を「フィードバック特性」に write
       → ESP32 が手元のモーター/LED を鳴らす（＝身体フィードバック）
   サーバー(node)は Mac の localhost のまま。ブラウザは localhost で開くこと。

   ■ ライブラリ：MFRC522（miguelbalboa/rfid）。BLE は ESP32 core 同梱で追加不要。
   ■ 配線：①rc522_local_read の先頭コメントと同じ（RC522 は 3.3V！）。
   ■ ボード：無印 ESP32（BLE対応）。ESP32-S2 は BLE 非対応なので不可。
   ============================================================ */

#include <SPI.h>
#include <MFRC522.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// --- 配線ピン（①と同じ） ---
#define SS_PIN   5
#define RST_PIN  22
#define FEEDBACK_PIN 2   // 内蔵LED。ここに振動モーター/ブザーを繋げば身体フィードバックに

// --- BLE の識別子（ブラウザ側と一致させる。変更するなら両方直す） ---
#define DEVICE_NAME        "NadaKaruta"
#define SERVICE_UUID       "7a0b9d00-4e2a-4b7c-9c1a-0f1e2d3c4b5a"
#define CHAR_SCAN_UUID     "7a0b9d01-4e2a-4b7c-9c1a-0f1e2d3c4b5a" // notify: 札番号
#define CHAR_FEEDBACK_UUID "7a0b9d02-4e2a-4b7c-9c1a-0f1e2d3c4b5a" // write : "vibrate"/"none"

// ===== UID → 札番号 対応表（①で採取・②と同じ） =====
struct TagMap { const char* uid; const char* card; };
TagMap tags[] = {
  { "0484397DD22A81", "01" },
  { "0482397DD22A81", "02" },
  { "0483397DD22A81", "03" },
  { "04E7397DD22A81", "04" },
  { "04E8397DD22A81", "05" },
  { "04E9397DD22A81", "06" },
  { "04EA397DD22A81", "07" },
  { "04DE397DD22A81", "08" },
  { "04D7397DD22A81", "09" },
  { "04DF397DD22A81", "10" },
  { "04D6397DD22A81", "11" },
  { "04E2397DD22A81", "12" },
  { "04D8397DD22A81", "13" },
  { "04D9397DD22A81", "14" },
  { "04E1397DD22A81", "15" },
};
const int TAG_COUNT = sizeof(tags) / sizeof(tags[0]);

MFRC522 rfid(SS_PIN, RST_PIN);
BLECharacteristic* scanChar = nullptr;
bool bleConnected = false;

String lastUid = "";
unsigned long lastTime = 0;
const unsigned long DEBOUNCE_MS = 1500;

String uidToString(MFRC522::Uid *uid) {
  String s = "";
  for (byte i = 0; i < uid->size; i++) {
    if (uid->uidByte[i] < 0x10) s += "0";
    s += String(uid->uidByte[i], HEX);
  }
  s.toUpperCase();
  return s;
}
String cardForUid(const String& uid) {
  for (int i = 0; i < TAG_COUNT; i++)
    if (uid.equals(tags[i].uid)) return String(tags[i].card);
  return "";
}

// 手元フィードバック（不正解=vibrate で強め、正解=none で軽く）
void feedback(const String& haptic) {
  if (haptic == "vibrate") {
    for (int i = 0; i < 2; i++) {
      digitalWrite(FEEDBACK_PIN, HIGH); delay(120);
      digitalWrite(FEEDBACK_PIN, LOW);  delay(80);
    }
  } else {  // "none" など：軽く1回
    digitalWrite(FEEDBACK_PIN, HIGH); delay(60);
    digitalWrite(FEEDBACK_PIN, LOW);
  }
}

// 接続状態：切れたら広告を再開してブラウザが再接続できるように
class SrvCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override { bleConnected = true; }
  void onDisconnect(BLEServer* s) override {
    bleConnected = false;
    delay(200);
    BLEDevice::startAdvertising();
  }
};

// ブラウザからの判定結果("vibrate"/"none")を受けてモーターを鳴らす
class FbCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = String(c->getValue().c_str());
    v.trim();
    Serial.printf("feedback <- %s\n", v.c_str());
    feedback(v);
  }
};

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(FEEDBACK_PIN, OUTPUT);
  digitalWrite(FEEDBACK_PIN, LOW);

  SPI.begin();
  rfid.PCD_Init();

  // ---- BLE 立ち上げ ----
  BLEDevice::init(DEVICE_NAME);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new SrvCallbacks());
  BLEService* svc = server->createService(SERVICE_UUID);

  // スキャン特性（notify）：札番号を送る
  scanChar = svc->createCharacteristic(
      CHAR_SCAN_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  scanChar->addDescriptor(new BLE2902());

  // フィードバック特性（write）：判定結果を受け取る
  BLECharacteristic* fbChar = svc->createCharacteristic(
      CHAR_FEEDBACK_UUID, BLECharacteristic::PROPERTY_WRITE);
  fbChar->setCallbacks(new FbCallbacks());

  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.println("=== RC522 → BLE 開始（ブラウザから接続してください）===");
}

void loop() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  String uid = uidToString(&rfid.uid);
  unsigned long now = millis();
  if (uid == lastUid && (now - lastTime) < DEBOUNCE_MS) {
    rfid.PICC_HaltA(); rfid.PCD_StopCrypto1();
    return;
  }
  lastUid = uid; lastTime = now;

  String card = cardForUid(uid);
  if (card == "") {
    Serial.printf("未登録UID: %s\n", uid.c_str());
  } else if (bleConnected && scanChar) {
    Serial.printf("UID %s → 札 %s notify\n", uid.c_str(), card.c_str());
    scanChar->setValue(card.c_str());
    scanChar->notify();          // ブラウザへ札番号を送信
  } else {
    Serial.printf("札 %s（ブラウザ未接続のため送信スキップ）\n", card.c_str());
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}
