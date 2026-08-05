#include <Wire.h>
const uint8_t MPU = 0x68;

void setup() {
  Serial.begin(115200);
  Wire.begin();                 // SDA=D21, SCL=D22
  // 起きろの合図（電源投入時はスリープしてる）
  Wire.beginTransmission(MPU);
  Wire.write(0x6B);             // PWR_MGMT_1
  Wire.write(0);                // スリープ解除
  Wire.endTransmission();
}

void loop() {
  Wire.beginTransmission(MPU);
  Wire.write(0x3B);             // ACCEL_XOUT_H から
  Wire.endTransmission(false);
  Wire.requestFrom(MPU, (uint8_t)14);
  int16_t ax = (Wire.read() << 8) | Wire.read();
  int16_t ay = (Wire.read() << 8) | Wire.read();
  int16_t az = (Wire.read() << 8) | Wire.read();
  Wire.read(); Wire.read();     // 温度は読み飛ばし
  int16_t gx = (Wire.read() << 8) | Wire.read();
  int16_t gy = (Wire.read() << 8) | Wire.read();
  int16_t gz = (Wire.read() << 8) | Wire.read();

  // 加速度: ±2gレンジで 16384 = 1g
  Serial.printf("加速度 %.2f,%.2f,%.2f  ジャイロ %d,%d,%d\n",
    ax/16384.0, ay/16384.0, az/16384.0, gx, gy, gz);
  delay(200);
}