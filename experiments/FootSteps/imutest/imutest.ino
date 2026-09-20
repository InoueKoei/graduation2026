// StampS3A + MPU6050 が M5.Imu として拾えるかだけを見る最小スケッチ。
// Wire を一切触らないので、プローブ側の干渉と切り分けられる。
#include <M5Unified.h>

const char* imuName(int t) {
  switch (t) {
    case 0: return "none";     case 1: return "unknown";
    case 2: return "SH200Q";   case 3: return "MPU6050";
    case 4: return "MPU6886";  case 5: return "MPU9250";
    case 6: return "BMI270";   default: return "?";
  }
}

void setup() {
  auto cfg = M5.config();
  cfg.external_imu = true;
  M5.begin(cfg);
  Serial.begin(115200);
  delay(2500);
  Serial.println();
  Serial.println("===== IMU TEST =====");
  Serial.printf("board    : %d\n", (int)M5.getBoard());
  Serial.printf("Ex_I2C   : enabled=%d sda=%d scl=%d\n",
                (int)M5.Ex_I2C.isEnabled(), M5.Ex_I2C.getSDA(), M5.Ex_I2C.getSCL());
  Serial.printf("M5.Imu   : %s (enabled=%d)\n",
                imuName((int)M5.Imu.getType()), (int)M5.Imu.isEnabled());
  Serial.println("====================");
}

void loop() {
  M5.update();
  if (M5.Imu.isEnabled()) {
    M5.Imu.update();
    float ax, ay, az, gx, gy, gz;
    M5.Imu.getAccel(&ax, &ay, &az);
    M5.Imu.getGyro(&gx, &gy, &gz);
    Serial.printf("acc % .3f % .3f % .3f (|a|=%.3f g)  gyro % 7.1f % 7.1f % 7.1f dps\n",
                  ax, ay, az, sqrtf(ax*ax+ay*ay+az*az), gx, gy, gz);
  } else {
    Serial.println("IMU not detected");
  }
  delay(1000);
}
