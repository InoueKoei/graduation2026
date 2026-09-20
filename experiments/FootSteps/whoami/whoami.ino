// MPU6050 の WHO_AM_I(0x75) を直接読む。
// M5Unified は 0x19/0x68/0x71 しか受け付けないので、クローン品で値が違うと弾かれる。
// 速度でも変わるか見るため 100k と 400k の両方で試す。
#include <Arduino.h>
#include <Wire.h>

void tryRead(uint32_t hz) {
  Wire.end(); delay(5);
  Wire.begin(13, 15, hz); delay(5);
  Serial.printf("--- %lu Hz ---\n", (unsigned long)hz);
  for (uint8_t addr : {0x68, 0x69}) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() != 0) { Serial.printf("  0x%02X : 応答なし\n", addr); continue; }
    Wire.beginTransmission(addr);
    Wire.write(0x75);
    if (Wire.endTransmission(false) != 0) { Serial.printf("  0x%02X : reg 書き込み失敗\n", addr); continue; }
    if (Wire.requestFrom((int)addr, 1) != 1) { Serial.printf("  0x%02X : 読み出し失敗\n", addr); continue; }
    uint8_t id = Wire.read();
    Serial.printf("  0x%02X : WHO_AM_I = 0x%02X", addr, id);
    if (id == 0x68) Serial.print("  (MPU6050 正規)");
    else if (id == 0x19) Serial.print("  (MPU6886)");
    else if (id == 0x71) Serial.print("  (MPU9250)");
    else Serial.print("  <<< M5Unified が知らない値。クローン品");
    Serial.println();
  }
}

void setup() {
  Serial.begin(115200);
  delay(2500);
  Serial.println();
  Serial.println("===== WHO_AM_I =====");
  tryRead(100000);
  tryRead(400000);
  Serial.println("====================");
}
void loop() { delay(1000); }
