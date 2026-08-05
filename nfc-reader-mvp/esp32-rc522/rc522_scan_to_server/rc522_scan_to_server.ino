/* ============================================================
   ② 本番：RC522 でタグを読み → Wi-Fi で既存サーバーへ送信
   ------------------------------------------------------------
   iPhone の代わりに ESP32 を「NFCリーダー」にする版。
   タグの UID を札番号(01〜)に変換し、nfc-reader-mvp サーバーの
     GET /scan?card=NN&format=haptic
   を叩く。返る "vibrate"/"none" で手元フィードバック（LED/振動）を出す。

   ■ 事前準備
     1. ①rc522_local_read で各札の UID を採取
     2. 下の CONFIG（Wi-Fi・サーバー）と tags[] 対応表を埋める
     3. サーバーを Mac で起動:  cd nfc-reader-mvp && node server.js
        （サーバー画面の下部／起動ログに出る「接続先」の IP をここに入れる）

   配線・ライブラリは ①rc522_local_read の先頭コメント参照（RC522 は 3.3V！）。
   ============================================================ */

#include <SPI.h>
#include <MFRC522.h>
#include <WiFi.h>
#include <HTTPClient.h>

// ===================== CONFIG（ここを埋める） =====================
const char* WIFI_SSID = "あなたのSSID";
const char* WIFI_PASS = "あなたのパスワード";

// サーバーの IP:PORT。Mac の IP は変わるので、サーバー画面下部の「接続先」を見て合わせる
const char* SERVER_HOST = "192.168.10.130:3000";

// UID → 札番号(cards.json の id) 対応表。①で採取した UID を貼る。
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
// ================================================================

// --- 配線ピン（①と同じ） ---
#define SS_PIN   5
#define RST_PIN  22
// 手元フィードバック用（LED or 振動モーター/ブザーの制御ピン）
#define FEEDBACK_PIN 2   // 多くの ESP32 devkit の内蔵LED。無ければ外付けLED/モーターを繋ぐ

MFRC522 rfid(SS_PIN, RST_PIN);

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

// UID → 札番号。未登録なら "" を返す
String cardForUid(const String& uid) {
  for (int i = 0; i < TAG_COUNT; i++) {
    if (uid.equals(tags[i].uid)) return String(tags[i].card);
  }
  return "";
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("Wi-Fi 接続中");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("接続OK  ESP32 IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("接続失敗（SSID/パス、同一ネットワークか確認）");
  }
}

// サーバーへ送信。返り値の本文（"vibrate"/"none"）を返す
String sendScan(const String& card) {
  String result = "";
  if (WiFi.status() != WL_CONNECTED) { connectWiFi(); }
  if (WiFi.status() != WL_CONNECTED) return result;

  HTTPClient http;
  String url = String("http://") + SERVER_HOST + "/scan?card=" + card + "&format=haptic";
  http.begin(url);
  http.setConnectTimeout(3000);
  int code = http.GET();
  if (code == 200) {
    result = http.getString();   // "vibrate" か "none"
    result.trim();
  }
  Serial.printf("  → GET %s  [%d]  body=\"%s\"\n", url.c_str(), code, result.c_str());
  http.end();
  return result;
}

// 手元フィードバック（不正解=vibrate のとき鳴らす）
// ※振動モーター/ブザーを FEEDBACK_PIN に繋げばそのまま振動になる
void feedback(const String& haptic) {
  if (haptic == "vibrate") {
    for (int i = 0; i < 2; i++) {           // 不正解：ブブッと2回
      digitalWrite(FEEDBACK_PIN, HIGH); delay(120);
      digitalWrite(FEEDBACK_PIN, LOW);  delay(80);
    }
  } else if (haptic == "none") {
    digitalWrite(FEEDBACK_PIN, HIGH); delay(60); // 正解：軽く1回
    digitalWrite(FEEDBACK_PIN, LOW);
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(FEEDBACK_PIN, OUTPUT);
  digitalWrite(FEEDBACK_PIN, LOW);
  SPI.begin();
  rfid.PCD_Init();
  connectWiFi();
  Serial.println("=== RC522 → サーバー送信 開始 ===");
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
    Serial.printf("未登録UID: %s（①で採取して対応表に追加してください）\n", uid.c_str());
  } else {
    Serial.printf("UID %s → 札 %s 送信\n", uid.c_str(), card.c_str());
    String haptic = sendScan(card);
    feedback(haptic);
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}
