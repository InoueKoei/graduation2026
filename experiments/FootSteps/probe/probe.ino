// 判別用プローブ：どのポートがどの機体か、MPU6050 がどのピンに載っているかを調べる
#include <M5Unified.h>
#include <Wire.h>
#include <esp_mac.h>

struct PinPair { int sda; int scl; const char* note; };

// USB(19,20) と UART0(43,44) は触らない
PinPair candidates[] = {
  {12, 11, "CoreS3 internal"},
  { 2,  1, "CoreS3 Grove"},
  {13, 15, "StampS3 Grove(G13/G15)"},
  {15, 13, "StampS3 Grove reversed"},
  { 8,  9, "generic 8/9"},
  {21, 22, "classic 21/22"},
  { 1,  2, "reversed 1/2"},
  {38, 39, "38/39"},
  { 6,  7, "6/7"},
};

const char* imuName(int t) {
  switch (t) {
    case 0:  return "none";
    case 1:  return "SH200Q";
    case 2:  return "MPU6050";
    case 3:  return "MPU6886";
    case 4:  return "MPU9250";
    case 5:  return "BMI270";
    default: return "unknown";
  }
}

void scanBus(int sda, int scl, const char* note) {
  Wire.end();
  delay(5);
  if (!Wire.begin(sda, scl, 100000)) {
    Serial.printf("  SDA=%-2d SCL=%-2d %-26s begin failed\n", sda, scl, note);
    return;
  }
  delay(5);
  char found[96] = {0};
  int n = 0;
  for (uint8_t a = 0x08; a < 0x78; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      n++;
      snprintf(found + strlen(found), sizeof(found) - strlen(found), " 0x%02X", a);
    }
  }
  Serial.printf("  SDA=%-2d SCL=%-2d %-26s %s\n", sda, scl, note, n ? found : "-");
}

String macString() {
  uint8_t m[6];
  esp_efuse_mac_get_default(m);
  char b[18];
  snprintf(b, sizeof(b), "%02X:%02X:%02X:%02X:%02X:%02X", m[0], m[1], m[2], m[3], m[4], m[5]);
  return String(b);
}

void setup() {
  Serial.begin(115200);
  delay(2500);  // USB CDC が上がるのを待つ

  Serial.println();
  Serial.println("========== PROBE ==========");
  Serial.printf("chip       : %s rev%d %d core\n", ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores());
  Serial.printf("flash      : %u MB\n", (unsigned)(ESP.getFlashChipSize() / 1048576));
  Serial.printf("psram      : %u KB\n", (unsigned)(ESP.getPsramSize() / 1024));
  Serial.printf("mac        : %s\n", macString().c_str());

  // I2C スキャンは M5.begin() より前にやる。
  // Wire.end()/begin() で勝手にピンを張り替えるので、M5Unified の初期化を後に回さないとバスを壊す
  Serial.println("--- I2C scan (M5.begin の前) ---");
  for (auto& c : candidates) scanBus(c.sda, c.scl, c.note);
  Wire.end();
  delay(10);

  auto cfg = M5.config();
  cfg.external_imu = true;   // Grove 上の MPU6050 を M5.Imu として拾わせる
  M5.begin(cfg);

  Serial.println("--- M5Unified ---");
  Serial.printf("board_id   : %d\n", (int)M5.getBoard());
  Serial.printf("display    : %d x %d\n", M5.Display.width(), M5.Display.height());
  Serial.printf("M5.Imu     : %s (enabled=%d)  <- external_imu=true\n",
                imuName((int)M5.Imu.getType()), (int)M5.Imu.isEnabled());
  Serial.println("===========================");
}

void loop() {
  M5.update();
  // IMU が生きているなら、重力が 1g 前後で読めているかを 1 秒ごとに確認する
  if (M5.Imu.isEnabled()) {
    M5.Imu.update();
    float ax, ay, az, gx, gy, gz;
    M5.Imu.getAccel(&ax, &ay, &az);
    M5.Imu.getGyro(&gx, &gy, &gz);
    Serial.printf("acc % .3f % .3f % .3f (|a|=%.3f g)   gyro % 7.1f % 7.1f % 7.1f dps\n",
                  ax, ay, az, sqrtf(ax*ax + ay*ay + az*az), gx, gy, gz);
  }
  delay(1000);
}
