// 左足 / M5Stamp S3A + MPU6050(実体は MPU6500 系クローン、Grove G13/G15)
//
// Stage 1：まず USB シリアルに JSON を吐いてアルゴリズムを確かめる段階。
// 右足(foot_right)と同じ foot_core.h を使うので、推定のコードは左右で完全に同じ。
// 違うのはセンサの読み方だけ（CoreS3 は M5.Imu、こちらは自前の mpu6500.h）。
//
// 画面が無いので、内蔵 RGB LED(G21) で状態を出す：
//   緑 = 立脚 / 橙 = 遊脚 / 赤点滅 = IMU 見つからず / 白 = 構えのリセット直後
// G0 のボタンを押すと「構え」＝位置とヨーの原点を打ち直す。

#include <M5Unified.h>
#include <FastLED.h>
#include "foot_core.h"
#include "mpu6500.h"

#define FOOT_ID "L"

constexpr int PIN_SDA = 13;   // Grove
constexpr int PIN_SCL = 15;
constexpr int PIN_LED = 21;   // StampS3 内蔵 WS2812
constexpr int PIN_BTN = 0;

CRGB leds[1];
foot::Mpu6500     imu;
foot::FootTracker tracker;

uint32_t next_sample_us = 0;
uint32_t next_pose_us   = 0;
constexpr uint32_t POSE_INTERVAL_US = 40000;   // 25Hz

uint32_t white_until_ms = 0;
uint32_t sample_count = 0, last_rate_ms = 0;
float actual_hz = 0;

void setLed(const CRGB& c) { leds[0] = c; FastLED.show(); }

void doOrigin() {
  tracker.resetOrigin();
  white_until_ms = millis() + 400;
  Serial.printf("{\"t\":\"origin\",\"foot\":\"%s\"}\n", FOOT_ID);
}

// PC から「構え」の指示を受ける。
// 足に装着した状態では本体のボタンを押せないので、シリアル経由でも原点を打てるようにする。
// ビューアは {"cmd":"origin"} を1行で送ってくる。
void pollCommand() {
  static char buf[48];
  static uint8_t n = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      buf[n] = 0;
      if (n && strstr(buf, "origin")) doOrigin();
      n = 0;
    } else if (n < sizeof(buf) - 1) {
      buf[n++] = c;
    }
  }
}


void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  Serial.begin(115200);
  // ESP32-S3 のネイティブ USB CDC は、受信側が繋がっていないと送信バッファが詰まって
  // Serial.printf がブロックする（実測：12秒で pose が5行しか出ず、サンプリングごと止まった）。
  // タイムアウト 0 にすると、読み手がいないぶんは捨てて先へ進む。
  Serial.setTxTimeoutMs(0);
  pinMode(PIN_BTN, INPUT_PULLUP);

  FastLED.addLeds<WS2812, PIN_LED, GRB>(leds, 1);
  FastLED.setBrightness(40);
  setLed(CRGB::Blue);

  delay(2000);

  if (!imu.begin(PIN_SDA, PIN_SCL)) {
    Serial.println("{\"t\":\"error\",\"msg\":\"MPU not found on G13/G15\"}");
    while (true) { setLed(CRGB::Red); delay(300); setLed(CRGB::Black); delay(300); }
  }
  Serial.printf("{\"t\":\"hello\",\"foot\":\"%s\",\"who_am_i\":\"0x%02X\"}\n", FOOT_ID, imu.whoAmI());

  tracker.begin();
  next_sample_us = micros();
}

void loop() {
  M5.update();

  static bool btn_prev = true;
  bool btn = digitalRead(PIN_BTN);
  if (btn_prev && !btn) doOrigin();             // 押した瞬間
  btn_prev = btn;
  pollCommand();

  uint32_t now = micros();
  if ((int32_t)(now - next_sample_us) >= 0) {
    next_sample_us += foot::SAMPLE_US;
    if ((int32_t)(micros() - next_sample_us) > (int32_t)(foot::SAMPLE_US * 5)) next_sample_us = micros();

    sample_count++;
    if (millis() - last_rate_ms >= 1000) {
      actual_hz = sample_count * 1000.0f / (millis() - last_rate_ms);
      sample_count = 0; last_rate_ms = millis();
    }

    float ax, ay, az, gx, gy, gz;
    if (imu.read(&ax, &ay, &az, &gx, &gy, &gz)) {
      if (tracker.update(ax, ay, az, gx, gy, gz, now)) {
        const auto& s = tracker.lastStep();
        Serial.printf("{\"t\":\"step\",\"foot\":\"%s\",\"seq\":%lu,\"t_us\":%lu,"
                      "\"dx\":%.3f,\"dy\":%.3f,\"dz\":%.3f,\"x\":%.3f,\"y\":%.3f,"
                      "\"yaw\":%.3f,\"pitch_hs\":%.3f,\"stance_ms\":%lu,\"swing_ms\":%lu,"
                      "\"peak_a\":%.2f,\"peak_w\":%.0f}\n",
                      FOOT_ID, (unsigned long)s.seq, (unsigned long)s.t_us,
                      s.dx, s.dy, s.dz, s.x, s.y,
                      s.yaw, s.pitch_hs, (unsigned long)s.stance_ms, (unsigned long)s.swing_ms,
                      s.peak_a, s.peak_w);
      }

      if ((int32_t)(now - next_pose_us) >= 0) {
        next_pose_us = now + POSE_INTERVAL_US;
        Serial.printf("{\"t\":\"pose\",\"foot\":\"%s\",\"t_us\":%lu,\"pitch\":%.3f,\"roll\":%.3f,"
                      "\"yaw\":%.3f,\"state\":\"%s\",\"x\":%.3f,\"y\":%.3f,\"hz\":%.1f}\n",
                      FOOT_ID, (unsigned long)now, tracker.pitch(), tracker.roll(),
                      tracker.yaw(), tracker.isStance() ? "stance" : "swing",
                      tracker.x(), tracker.y(), actual_hz);
      }
    }
  }

  static uint32_t last_led_ms = 0;
  if (millis() - last_led_ms >= 50) {
    last_led_ms = millis();
    if (millis() < white_until_ms)   setLed(CRGB::White);
    else if (tracker.isStance())     setLed(CRGB::Green);
    else                             setLed(CRGB::OrangeRed);
  }
}
