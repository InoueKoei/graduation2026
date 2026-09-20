// StampS3A に MPU6050 が見つからないので、配線されているかどうかから切り分ける。
//
// I2C モジュールは SDA/SCL に外部プルアップ（たいてい 4.7k〜10k）を持っている。
// 内部プルダウン（ESP32 は約 45k）を有効にしても外部プルアップのほうが強いので、
// 「内部プルダウンありで HIGH のまま」なら、そのピンには電源の入った I2C モジュールがぶら下がっている。
// まずそれでバス候補を絞り、見つかったピンの組み合わせだけ総当たりで I2C スキャンする。

#include <Arduino.h>
#include <Wire.h>

// StampS3 の外に出ているピン。G19/G20 は USB、G0 はボタン、G21 は内蔵 RGB LED なので除く
const int PINS[] = {1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,38,39,40,41,42,43,44,46};
const int NPINS = sizeof(PINS) / sizeof(PINS[0]);

int pulled[16];
int npulled = 0;

void scanPair(int sda, int scl) {
  Wire.end();
  delay(5);
  if (!Wire.begin(sda, scl, 100000)) return;
  delay(5);
  for (uint8_t a = 0x08; a < 0x78; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  ★ SDA=%d SCL=%d  ->  0x%02X", sda, scl, a);
      if (a == 0x68 || a == 0x69) Serial.print("  (MPU6050 の既定アドレス)");
      Serial.println();
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(2500);

  Serial.println();
  Serial.println("===== FIND I2C BUS =====");
  Serial.println("--- 外部プルアップの検査（内部プルダウンありで HIGH なら外部プルアップあり）---");
  for (int i = 0; i < NPINS; i++) {
    int p = PINS[i];
    pinMode(p, INPUT_PULLDOWN);
    delayMicroseconds(500);
    int lo = digitalRead(p);
    pinMode(p, INPUT);
    delayMicroseconds(500);
    int fl = digitalRead(p);
    const char* verdict = lo ? "<<< 外部プルアップあり" : "";
    Serial.printf("  G%-2d  pulldown=%d  float=%d  %s\n", p, lo, fl, verdict);
    if (lo && npulled < 16) pulled[npulled++] = p;
    pinMode(p, INPUT);
  }

  Serial.printf("--- プルアップされていたピン: %d 本 ---\n", npulled);
  if (npulled < 2) {
    Serial.println("  I2C バスとして成立する組がない。");
    Serial.println("  → MPU6050 が繋がっていないか、電源(3V3/GND)が来ていない可能性が高い。");
  } else {
    Serial.println("--- その組み合わせだけ I2C スキャン ---");
    for (int i = 0; i < npulled; i++)
      for (int j = 0; j < npulled; j++)
        if (i != j) scanPair(pulled[i], pulled[j]);
  }
  Serial.println("========================");
}

void loop() { delay(1000); }
