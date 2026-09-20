// cores3_tilt_bridge.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3 / CoreS3 SE → ブラウザ（文字ころがし）への傾き送出。
//
//   内蔵 IMU の加速度を読んで、1行1JSON でシリアルに流すだけ。
//   ブラウザ側は src/serial.js（_shared/serial.js の流用）が受ける。
//
//     {"ax":0.012,"ay":-0.345,"az":0.938,"mpu":true,"gain":1.20}
//
//   gain は「傾きの効き」。本体の画面を触って増減でき、電源を切っても残る。
//   ブラウザ側はこの値を傾きに掛ける（sensor.js）。
//   展示中に PC を触らず、本体だけで手ざわりを詰められるようにするためのもの。
//
// 画面
//   上半分 … 加速度の数値と、傾きを示す的（実機が生きているかの確認用）
//   下半分 … [ − ] [ 感度 1.20 ] [ ＋ ]  … 触ると 0.1 ずつ変わる
//            感度の表示を長押し（1秒）で 1.00 に戻る
//
// 使い方
//   1. Arduino IDE のボードを M5CoreS3 にする
//   2. ツール > USB CDC On Boot を「Enabled」にする
//      ★ これを忘れると Web Serial からポートが見えない（CoreS3 は
//        ESP32-S3 のネイティブ USB を使っているため）
//   3. 書き込んで、ブラウザの右下「⇄ USB」から接続
//
//   arduino-cli なら:
//     arduino-cli compile -b esp32:esp32:m5stack_cores3:CDCOnBoot=cdc,USBMode=hwcdc <このフォルダ>
//     arduino-cli upload  -b esp32:esp32:m5stack_cores3:CDCOnBoot=cdc,USBMode=hwcdc -p /dev/cu.usbmodem101 <このフォルダ>
//
// 必要ライブラリ: M5Unified（M5GFX を含む）
// -----------------------------------------------------------------------------
#include <M5Unified.h>
#include <Preferences.h>

static constexpr uint32_t SEND_HZ   = 100;              // 送出レート
static constexpr uint32_t SEND_MS   = 1000 / SEND_HZ;
static constexpr uint32_t DRAW_MS   = 100;              // 画面の更新はゆっくりで十分

static constexpr float GAIN_MIN  = 0.3f;
static constexpr float GAIN_MAX  = 3.0f;
static constexpr float GAIN_STEP = 0.1f;
static constexpr float GAIN_DEF  = 1.0f;
static constexpr uint32_t HOLD_MS = 1000;               // 長押しで既定に戻す

static Preferences prefs;
static float    gain      = GAIN_DEF;
static uint32_t lastSend  = 0;
static uint32_t lastDraw  = 0;
static bool     imuOk     = false;
static uint32_t sentCount = 0;
static float    ax = 0, ay = 0, az = 1;

// 画面の座標（setRotation(1) で 320x240）
static constexpr int SW = 320, SH = 240;
static constexpr int BAR_Y = 168;                        // 操作帯の上端
static constexpr int BTN_W = 84;

static uint32_t touchDownAt = 0;
static bool     holdFired   = false;

static void saveGain() {
  prefs.begin("korogashi", false);
  prefs.putFloat("gain", gain);
  prefs.end();
}

static void loadGain() {
  prefs.begin("korogashi", true);
  gain = prefs.getFloat("gain", GAIN_DEF);
  prefs.end();
  if (!(gain >= GAIN_MIN && gain <= GAIN_MAX)) gain = GAIN_DEF;
}

static void setGain(float v) {
  if (v < GAIN_MIN) v = GAIN_MIN;
  if (v > GAIN_MAX) v = GAIN_MAX;
  // 0.1 刻みに丸める（浮動小数の誤差で 1.2000001 のようにならないように）
  v = roundf(v * 10.0f) / 10.0f;
  if (fabsf(v - gain) < 1e-4f) return;
  gain = v;
  saveGain();
}

static void drawBar() {
  // [ − ] [ 感度 x.xx ] [ ＋ ]
  M5.Display.fillRect(0, BAR_Y, SW, SH - BAR_Y, TFT_BLACK);
  M5.Display.drawFastHLine(0, BAR_Y, SW, TFT_DARKGREY);

  M5.Display.fillRoundRect(6, BAR_Y + 8, BTN_W, 56, 8, 0x2104);
  M5.Display.fillRoundRect(SW - BTN_W - 6, BAR_Y + 8, BTN_W, 56, 8, 0x2104);

  M5.Display.setTextDatum(middle_center);
  M5.Display.setTextColor(TFT_WHITE, 0x2104);
  M5.Display.setTextSize(3);
  M5.Display.drawString("-", 6 + BTN_W / 2, BAR_Y + 36);
  M5.Display.drawString("+", SW - BTN_W - 6 + BTN_W / 2, BAR_Y + 36);

  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setTextSize(1);
  M5.Display.drawString("kando", SW / 2, BAR_Y + 16);
  M5.Display.setTextSize(3);
  M5.Display.drawString(String(gain, 1), SW / 2, BAR_Y + 42);
  M5.Display.setTextDatum(top_left);
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  Serial.begin(115200);

  loadGain();
  imuOk = M5.Imu.begin();

  M5.Display.setRotation(1);
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(10, 10);
  M5.Display.print(imuOk ? "IMU ready" : "IMU NOT FOUND");
  drawBar();
}

void loop() {
  M5.update();
  const uint32_t now = millis();

  // --- 感度の操作（画面を触る）---
  auto t = M5.Touch.getDetail();
  if (t.wasPressed() && t.y >= BAR_Y) {
    touchDownAt = now;
    holdFired = false;
    if (t.x < BTN_W + 6) setGain(gain - GAIN_STEP);
    else if (t.x > SW - BTN_W - 6) setGain(gain + GAIN_STEP);
    drawBar();
  }
  // 真ん中を長押しで既定に戻す
  if (t.isPressed() && !holdFired && touchDownAt && (now - touchDownAt) > HOLD_MS
      && t.y >= BAR_Y && t.x >= BTN_W + 6 && t.x <= SW - BTN_W - 6) {
    holdFired = true;
    setGain(GAIN_DEF);
    drawBar();
  }
  if (t.wasReleased()) touchDownAt = 0;

  // --- 送出 ---
  if (now - lastSend >= SEND_MS) {
    lastSend = now;
    if (imuOk) M5.Imu.getAccel(&ax, &ay, &az);
    // 生の加速度と感度を別々に送る。掛けた後の値だけを送ると、
    // ブラウザ側で「実機が何 g 傾いているのか」が分からなくなるため。
    // mpu が false のとき、ブラウザ側は自動でマウス操作に落ちる
    Serial.printf("{\"ax\":%.3f,\"ay\":%.3f,\"az\":%.3f,\"mpu\":%s,\"gain\":%.2f}\n",
                  ax, ay, az, imuOk ? "true" : "false", gain);
    sentCount++;
  }

  // --- 画面（展示のときの切り分け用）---
  // 向き（どちらに傾けるとどちらへ転がるか）はブラウザ側の
  // config.js の invertX / invertY / swapXY、または操作モードの X / Y / S キーで合わせる。
  if (now - lastDraw >= DRAW_MS) {
    lastDraw = now;
    M5.Display.setTextSize(2);
    M5.Display.setCursor(10, 10);
    M5.Display.printf("ax %+6.3f\n", ax);
    M5.Display.setCursor(10, 34);
    M5.Display.printf("ay %+6.3f\n", ay);
    M5.Display.setCursor(10, 58);
    M5.Display.printf("az %+6.3f\n", az);
    M5.Display.setCursor(10, 90);
    M5.Display.setTextSize(1);
    M5.Display.printf("IMU %s  sent %lu   \n", imuOk ? "ok" : "NG", (unsigned long)sentCount);

    // 傾きの向きを目で確かめる的
    const int cx = 246, cy = 74, r = 52;
    M5.Display.drawCircle(cx, cy, r, TFT_DARKGREY);
    static int px = cx, py = cy;
    M5.Display.fillCircle(px, py, 6, TFT_BLACK);
    M5.Display.drawCircle(cx, cy, r, TFT_DARKGREY);
    px = cx + (int)(ax * r);
    py = cy + (int)(ay * r);
    M5.Display.fillCircle(px, py, 6, TFT_RED);
  }
}
