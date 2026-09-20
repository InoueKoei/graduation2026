// 右足 / M5Stack CoreS3（内蔵 BMI270）
//
// Stage 1：まず USB シリアルに JSON を吐いてアルゴリズムを確かめる段階。
// 無線（SoftAP + WebSocket）は Stage 2 で足す。
//
// サンプリングは core 0 の専用タスクに固定してある。
// 画面の再描画とシリアル出力を同じループでやると 200Hz を守れず、実測 140Hz まで落ちた。
// 推定は等間隔サンプリングが前提なので、ここは分けないと精度がそのまま悪くなる。
//
// 画面をタッチすると「構え」＝位置とヨーの原点を打ち直す。

#include <M5Unified.h>
#include "foot_core.h"

#define FOOT_ID "R"

foot::FootTracker tracker;
QueueHandle_t step_queue;

// 描画・シリアル用のスナップショット（タスクが書き、ループが読む。
// float 単位のずれは表示にしか使わないのでロックはしない）
struct Snapshot {
  float pitch, roll, yaw, x, y, hz;
  bool  stance;
  uint32_t steps;
};
volatile Snapshot snap = {};

volatile bool reset_request = false;

// 画面に出す足跡
constexpr int TRACK_MAX = 64;
float track_x[TRACK_MAX], track_y[TRACK_MAX];
int   track_n = 0;
bool  track_dirty = true;

void pushTrack(float x, float y) {
  if (track_n < TRACK_MAX) {
    track_x[track_n] = x; track_y[track_n] = y; track_n++;
  } else {
    memmove(track_x, track_x + 1, sizeof(float) * (TRACK_MAX - 1));
    memmove(track_y, track_y + 1, sizeof(float) * (TRACK_MAX - 1));
    track_x[TRACK_MAX - 1] = x; track_y[TRACK_MAX - 1] = y;
  }
  track_dirty = true;
}

// ---- core 0：200Hz のサンプリングと推定だけをやる ----------------------
void sampleTask(void*) {
  TickType_t last_wake = xTaskGetTickCount();
  uint32_t count = 0, rate_ms = millis();
  float hz = 0;
  uint32_t next_us = micros();

  for (;;) {
    uint32_t now = micros();
    if ((int32_t)(now - next_us) >= 0) {
      next_us += foot::SAMPLE_US;
      if ((int32_t)(micros() - next_us) > (int32_t)(foot::SAMPLE_US * 5)) next_us = micros();

      if (reset_request) { reset_request = false; tracker.resetOrigin(); }

      M5.Imu.update();
      float ax, ay, az, gx, gy, gz;
      M5.Imu.getAccel(&ax, &ay, &az);
      M5.Imu.getGyro(&gx, &gy, &gz);

      if (tracker.update(ax, ay, az, gx, gy, gz, now)) {
        foot::StepEvent s = tracker.lastStep();
        xQueueSend(step_queue, &s, 0);
      }

      count++;
      if (millis() - rate_ms >= 1000) {
        hz = count * 1000.0f / (millis() - rate_ms);
        count = 0; rate_ms = millis();
      }

      snap.pitch  = tracker.pitch();
      snap.roll   = tracker.roll();
      snap.yaw    = tracker.yaw();
      snap.x      = tracker.x();
      snap.y      = tracker.y();
      snap.stance = tracker.isStance();
      snap.steps  = tracker.steps();
      snap.hz     = hz;
    }
    vTaskDelayUntil(&last_wake, 1);   // 1 tick = 1ms。200Hz には十分細かい
  }
}

void doOrigin() {
  reset_request = true;
  track_n = 0; track_dirty = true;
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
  // ネイティブ USB CDC は受信側が繋がっていないと送信バッファが詰まってブロックする。
  // 実測で 12 秒に 5 行しか出ず、サンプリングごと止まった。0 にすると読み手がいないぶんは捨てる。
  Serial.setTxTimeoutMs(0);
  delay(300);

  M5.Display.setRotation(1);
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);

  if (!M5.Imu.isEnabled()) {
    M5.Display.setTextSize(2);
    M5.Display.setCursor(10, 100);
    M5.Display.print("no IMU");
    Serial.println("{\"t\":\"error\",\"msg\":\"no IMU\"}");
    while (true) delay(1000);
  }

  tracker.begin();
  step_queue = xQueueCreate(16, sizeof(foot::StepEvent));
  Serial.printf("{\"t\":\"hello\",\"foot\":\"%s\",\"imu\":%d}\n", FOOT_ID, (int)M5.Imu.getType());

  xTaskCreatePinnedToCore(sampleTask, "sample", 4096, nullptr, 5, nullptr, 0);
}

void drawHeader() {
  M5.Display.setTextSize(2);
  M5.Display.setCursor(6, 4);
  M5.Display.setTextColor(snap.stance ? TFT_GREEN : TFT_ORANGE, TFT_BLACK);
  M5.Display.printf("%s %-6s", FOOT_ID, snap.stance ? "STANCE" : "SWING");
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.printf(" %3lu steps", (unsigned long)snap.steps);
  M5.Display.setTextSize(1);
  M5.Display.setCursor(6, 24);
  M5.Display.printf("x%+6.2f y%+6.2f yaw%+5.0f  %5.1fHz  ",
                    snap.x, snap.y, snap.yaw * 57.2958f, snap.hz);
}

void drawTrack() {
  M5.Display.fillRect(0, 40, 320, 200, TFT_BLACK);
  if (track_n < 2) return;
  float minx = track_x[0], maxx = track_x[0], miny = track_y[0], maxy = track_y[0];
  for (int i = 1; i < track_n; i++) {
    minx = min(minx, track_x[i]); maxx = max(maxx, track_x[i]);
    miny = min(miny, track_y[i]); maxy = max(maxy, track_y[i]);
  }
  float w = max(maxx - minx, 0.5f), h = max(maxy - miny, 0.5f);
  float s = min(300.0f / w, 180.0f / h);
  float cx = (minx + maxx) * 0.5f, cy = (miny + maxy) * 0.5f;
  int px = 0, py = 0;
  for (int i = 0; i < track_n; i++) {
    int sx = 160 + (int)((track_x[i] - cx) * s);
    int sy = 140 - (int)((track_y[i] - cy) * s);
    if (i > 0) M5.Display.drawLine(px, py, sx, sy, TFT_DARKGREY);
    M5.Display.fillCircle(sx, sy, 3, i == track_n - 1 ? TFT_YELLOW : TFT_CYAN);
    px = sx; py = sy;
  }
}

void loop() {
  M5.update();

  if (M5.BtnA.wasPressed() || M5.BtnB.wasPressed() || M5.BtnC.wasPressed()) doOrigin();
  pollCommand();

  // 溜まった接地イベントを吐く
  foot::StepEvent s;
  while (xQueueReceive(step_queue, &s, 0) == pdTRUE) {
    pushTrack(s.x, s.y);
    Serial.printf("{\"t\":\"step\",\"foot\":\"%s\",\"seq\":%lu,\"t_us\":%lu,"
                  "\"dx\":%.3f,\"dy\":%.3f,\"dz\":%.3f,\"x\":%.3f,\"y\":%.3f,"
                  "\"yaw\":%.3f,\"pitch_hs\":%.3f,\"stance_ms\":%lu,\"swing_ms\":%lu,"
                  "\"peak_a\":%.2f,\"peak_w\":%.0f}\n",
                  FOOT_ID, (unsigned long)s.seq, (unsigned long)s.t_us,
                  s.dx, s.dy, s.dz, s.x, s.y,
                  s.yaw, s.pitch_hs, (unsigned long)s.stance_ms, (unsigned long)s.swing_ms,
                  s.peak_a, s.peak_w);
  }

  static uint32_t next_pose_ms = 0;
  if (millis() >= next_pose_ms) {
    next_pose_ms = millis() + 40;    // 25Hz
    Serial.printf("{\"t\":\"pose\",\"foot\":\"%s\",\"t_us\":%lu,\"pitch\":%.3f,\"roll\":%.3f,"
                  "\"yaw\":%.3f,\"state\":\"%s\",\"x\":%.3f,\"y\":%.3f,\"hz\":%.1f}\n",
                  FOOT_ID, (unsigned long)micros(), snap.pitch, snap.roll,
                  snap.yaw, snap.stance ? "stance" : "swing", snap.x, snap.y, snap.hz);
  }

  // ヘッダは 5fps、トラックは足跡が増えたときだけ描く（全面再描画はループを食う）
  static uint32_t next_hdr_ms = 0;
  if (millis() >= next_hdr_ms) { next_hdr_ms = millis() + 200; drawHeader(); }
  if (track_dirty) { track_dirty = false; drawTrack(); }

  delay(2);
}
