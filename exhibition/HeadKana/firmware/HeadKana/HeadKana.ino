#include <M5Unified.h>
#include "KanaInput.h" // Existing, tested button debounce; text editing runs in browser.
#include "BleLink.h"

constexpr uint8_t RED_PIN = 2, BLUE_PIN = 1;
constexpr uint32_t CALIBRATION_MS = 1500;
DebouncedButton red(RED_PIN), blue(BLUE_PIN);
float bias[3] = {}, sum[3] = {}, accel[3] = {0,1,0}, gyro[3] = {};
uint32_t samples = 0, stillSince = 0, lastImuMs = 0;
uint32_t lastNotifyMs = 0, lastStatusMs = 0, lastDrawMs = 0;
uint32_t redCount = 0, blueCount = 0;
uint16_t sequence = 0;
bool calibrating = true, imuOK = false;
bool kanaDisplay = true, forceDraw = true;
uint32_t firstTapMs = 0;
uint8_t lastDrawnKana = 255;
constexpr uint32_t DOUBLE_TAP_MS = 450;

bool ready() { return imuOK && !calibrating && millis() - lastImuMs < 150; }
void startCalibration() {
  calibrating = true; samples = 0; stillSince = millis();
  for (int i=0;i<3;++i) sum[i] = 0;
  Serial.println("CALIBRATING: keep still for 1.5 seconds");
}
void updateIMU(uint32_t now) {
  if (!(M5.Imu.update() & m5::IMU_Class::sensor_mask_gyro)) return;
  const auto d = M5.Imu.getImuData();
  lastImuMs = now;
  const float g[3] = {d.gyro.x,d.gyro.y,d.gyro.z};
  accel[0]=d.accel.x; accel[1]=d.accel.y; accel[2]=d.accel.z;
  if (calibrating) {
    const float gn = sqrtf(g[0]*g[0]+g[1]*g[1]+g[2]*g[2]);
    const float an = sqrtf(accel[0]*accel[0]+accel[1]*accel[1]+accel[2]*accel[2]);
    if (gn>6 || an<.85f || an>1.15f) {
      stillSince=now; samples=0; for(int i=0;i<3;++i) sum[i]=0;
    } else {
      for(int i=0;i<3;++i) sum[i]+=g[i];
      ++samples;
      if (now-stillSince>=CALIBRATION_MS && samples>=100) {
        for(int i=0;i<3;++i) bias[i]=sum[i]/samples;
        calibrating=false;
        forceDraw=true;
        Serial.println("READY HeadKana v2.2 DJ modifier sensor");
      }
    }
  }
  for(int i=0;i<3;++i) gyro[i] = calibrating ? 0 : g[i]-bias[i];
}
int16_t quantize(float value, float scale) {
  return int16_t(lroundf(fmaxf(-32768, fminf(32767,value*scale))));
}
void put16(uint8_t* p, uint16_t v) { p[0]=v&255; p[1]=(v>>8)&255; }
String sensorJSON();
void sendSensor() {
  // Single 20-byte notification; works with ATT MTU=23, no fragmentation.
  uint8_t p[20] = {0xA5, uint8_t((ready()?1:0)|(imuOK?2:0)|(red.down?4:0)|(blue.down?8:0))};
  put16(p+2, ++sequence);
  for(int i=0;i<4;++i) p[4+i]=(lastImuMs>>(8*i))&255;
  for(int i=0;i<3;++i) {
    put16(p+8+2*i,uint16_t(quantize(accel[i],1000)));
    put16(p+14+2*i,uint16_t(quantize(gyro[i],100)));
  }
  notifySensor(p,sizeof(p));
  if (Serial) Serial.println(sensorJSON());
}
String sensorJSON() {
  char buf[350];
  snprintf(buf,sizeof(buf),"{\"type\":\"sensor\",\"protocol\":2,\"seq\":%u,\"t\":%lu,\"ready\":%s,\"imu\":%s,\"red\":%s,\"blue\":%s,\"accel\":[%.3f,%.3f,%.3f],\"gyro\":[%.2f,%.2f,%.2f]}",
    sequence,(unsigned long)lastImuMs,ready()?"true":"false",imuOK?"true":"false",red.down?"true":"false",blue.down?"true":"false",
    accel[0],accel[1],accel[2],gyro[0],gyro[1],gyro[2]);
  return String(buf);
}
void printStatus() {
  const String json=sensorJSON(); Serial.println(json);
  if(bleEnabled) bleSnapshot->setValue(json);
}
void drawDiagnostics() {
  M5.Display.startWrite();
  M5.Display.fillScreen(0x0841);
  M5.Display.setTextDatum(top_left);
  M5.Display.setFont(&fonts::efontJA_16);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawString("HeadKana v2.2 / DJ IMU",10,8);
  M5.Display.drawString(bleConnected.load()?"BLE 接続中":"BLE 待機中",10,36);
  M5.Display.drawString(ready()?"1回 濁点 / 2回 半濁点 / 3回 小":"静止して調整してください",10,60);
  M5.Display.drawString(String("ACC ")+String(accel[0],2)+" / "+String(accel[1],2)+" / "+String(accel[2],2),10,96);
  M5.Display.drawString(String("GYR ")+String(gyro[0],1)+" / "+String(gyro[1],1)+" / "+String(gyro[2],1),10,124);
  M5.Display.setTextColor(red.down?TFT_RED:TFT_WHITE);
  M5.Display.drawString(String("赤 ")+(red.down?"ON ":"OFF ")+String(redCount),10,164);
  M5.Display.setTextColor(blue.down?TFT_CYAN:TFT_WHITE);
  M5.Display.drawString(String("青 ")+(blue.down?"ON ":"OFF ")+String(blueCount),165,164);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawString("画面をダブルタップ：DJガイド",10,207);
  M5.Display.endWrite();
}
void drawKana() {
  const uint8_t index = selectedKanaIndex();
  M5.Display.startWrite();
  M5.Display.fillScreen(0x0841);
  M5.Display.setTextDatum(top_left);
  M5.Display.setFont(&fonts::efontJA_16);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawString("DJ HEADBANG / v2.2",16,12);
  M5.Display.drawString("頷いて直前の文字を変える",16,40);
  M5.Display.setFont(&fonts::efontJA_24_b);
  M5.Display.drawString("1回  濁点",24,76);
  M5.Display.drawString("2回  半濁点",24,114);
  M5.Display.drawString("3回  小文字",24,152);
  M5.Display.setFont(&fonts::efontJA_16);
  M5.Display.drawString(ready()?"準備OK / ブラウザで接続":"静止して調整してください",16,202);
  M5.Display.endWrite();
  lastDrawnKana = index;
}
void drawUI() {
  if (kanaDisplay) drawKana();
  else drawDiagnostics();
  forceDraw = false;
}
void updateDisplayMode(uint32_t now) {
  if (M5.Touch.getDetail().wasClicked()) {
    if (firstTapMs && now - firstTapMs <= DOUBLE_TAP_MS) {
      kanaDisplay = !kanaDisplay;
      firstTapMs = 0;
      forceDraw = true;
    } else {
      firstTapMs = now;
    }
  }
  if (firstTapMs && now - firstTapMs > DOUBLE_TAP_MS) firstTapMs = 0;
}
void setup() {
  auto cfg=M5.config(); cfg.internal_imu=true; cfg.internal_spk=false; cfg.internal_mic=false;
  M5.begin(cfg); Serial.begin(115200);
  M5.Display.setRotation(1); M5.Display.setBrightness(100);
  M5.Power.setExtOutput(true);
  pinMode(RED_PIN,INPUT_PULLUP); pinMode(BLUE_PIN,INPUT_PULLUP);
  imuOK=M5.Imu.isEnabled();
  if(imuOK) M5.Imu.setCalibration(0,0,0);
  Serial.printf("BOOT HeadKana v2.2 DJ modifier board=%d imu=%d type=%d psram=%u PORT_A red=2 blue=1\n",int(M5.getBoard()),imuOK,int(M5.Imu.getType()),ESP.getPsramSize());
  startBLE(); startCalibration(); printStatus(); drawUI();
}
void loop() {
  M5.update(); const uint32_t now=millis();
  updateDisplayMode(now);
  red.update(digitalRead(RED_PIN)==LOW,now); blue.update(digitalRead(BLUE_PIN)==LOW,now);
  if(red.pressed) ++redCount; if(blue.pressed) ++blueCount;
  if(imuOK) updateIMU(now);
  while(Serial.available()) {const char c=Serial.read(); if(c=='s')printStatus(); if(c=='c')startCalibration();}
  if(now-lastNotifyMs>=20) {lastNotifyMs=now;sendSensor();}
  if(now-lastStatusMs>=100) {lastStatusMs=now;if(bleEnabled)bleSnapshot->setValue(sensorJSON());}
  if(now-lastDrawMs>=200) {
    lastDrawMs=now;
    if(!kanaDisplay || forceDraw || calibrating || selectedKanaIndex()!=lastDrawnKana) drawUI();
  }
  delay(1);
}
