#pragma once
// 「MPU6050」として売られていたモジュール用の最小ドライバ。
//
// なぜ M5Unified を使わないか：
//   手元の個体は WHO_AM_I(0x75) が 0x70 を返す。これは MPU-6500 系の ID で、
//   M5Unified の MPU6886_Class::begin() は 0x19(MPU6886) / 0x68(MPU6050) / 0x71(MPU9250)
//   しか受け付けないため、中身は正常に動くのに ID だけで弾かれて M5.Imu が none になる。
//   ライブラリ側を書き換えると更新で消えるうえ他のスケッチにも影響するので、ここだけ自前で読む。
//
// レンジは CoreS3(BMI270) を M5Unified が初期化するのと同じ ±8g / ±2000dps に揃える。
// 単位を合わせておくだけで、それ以上の左右較正はしない。

#include <Arduino.h>
#include <Wire.h>

namespace foot {

class Mpu6500 {
public:
  // sda/scl は StampS3 の Grove（G13/G15）。addr は AD0=GND で 0x68
  bool begin(int sda, int scl, uint8_t addr = 0x68, uint32_t hz = 400000) {
    _addr = addr;
    Wire.end();
    delay(5);
    if (!Wire.begin(sda, scl, hz)) return false;
    delay(10);

    _who = read8(0x75);
    if (_who == 0xFF || _who == 0x00) return false;   // バスに何もいない

    write8(0x6B, 0x80);          // PWR_MGMT_1 : デバイスリセット
    delay(100);
    write8(0x6B, 0x01);          // PWR_MGMT_1 : スリープ解除、クロックはジャイロX の PLL
    delay(10);
    write8(0x1A, 0x01);          // CONFIG      : DLPF_CFG=1（ジャイロ帯域 ~184Hz、内部 1kHz）
    write8(0x19, 0x03);          // SMPLRT_DIV  : 1kHz/(1+3) = 250Hz。200Hz で読むには十分
    write8(0x1B, 0x18);          // GYRO_CONFIG : FS_SEL=3 → ±2000dps
    write8(0x1C, 0x10);          // ACCEL_CONFIG: AFS_SEL=2 → ±8g
    write8(0x1D, 0x00);          // ACCEL_CONFIG2（MPU6500 系のみ。MPU6050 では無害）
    write8(0x38, 0x00);          // INT_ENABLE  : 割り込みは使わない
    delay(10);
    return true;
  }

  uint8_t whoAmI() const { return _who; }

  // 加速度[g] と角速度[dps] をまとめて読む
  bool read(float* ax, float* ay, float* az, float* gx, float* gy, float* gz) {
    Wire.beginTransmission(_addr);
    Wire.write(0x3B);                       // ACCEL_XOUT_H から
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom((int)_addr, 14) != 14) return false;

    int16_t raw[7];
    for (int i = 0; i < 7; i++) {
      uint8_t h = Wire.read(), l = Wire.read();
      raw[i] = (int16_t)((h << 8) | l);
    }
    // raw[0..2]=accel, raw[3]=temp, raw[4..6]=gyro
    *ax = raw[0] * A_RES;  *ay = raw[1] * A_RES;  *az = raw[2] * A_RES;
    *gx = raw[4] * G_RES;  *gy = raw[5] * G_RES;  *gz = raw[6] * G_RES;
    return true;
  }

private:
  static constexpr float A_RES = 8.0f / 32768.0f;      // ±8g
  static constexpr float G_RES = 2000.0f / 32768.0f;   // ±2000dps

  void write8(uint8_t reg, uint8_t val) {
    Wire.beginTransmission(_addr);
    Wire.write(reg); Wire.write(val);
    Wire.endTransmission();
  }
  uint8_t read8(uint8_t reg) {
    Wire.beginTransmission(_addr);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return 0xFF;
    if (Wire.requestFrom((int)_addr, 1) != 1) return 0xFF;
    return Wire.read();
  }

  uint8_t _addr = 0x68;
  uint8_t _who  = 0;
};

}  // namespace foot
