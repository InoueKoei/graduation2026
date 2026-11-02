// cores3_scales — Unit Mini Scales (U177) で重さを測って表示する
//
// 接続: ユニット → CoreS3 の PORT.A（赤いGroveポート / SDA=G2, SCL=G1）
// 依存: M5Unified のみ（ユニット用ライブラリ不要。I2C レジスタを直接読む）
//
// 注意: Unit Scales (U108) と同じ I2C アドレス 0x26 だがレジスタ配置が全く違う。
//       手元のユニット(FW v4)は Mini Scales の配置で応答するので、そちらに合わせている。
//
// 操作:
//   起動時に自動でゼロ合わせ
//   画面下の「ゼロ」をタップ / ユニット本体のボタン → 風袋引き（今の重さを0gに）
//   ユニットのLED: 安定=緑 / 計測中=橙
//
// レジスタ（M5Unit-Miniscale ライブラリより / 多バイト値はリトルエンディアン）
//   0x00 RAW_ADC   int32
//   0x10 WEIGHT    float, g
//   0x20 BUTTON    uint8（ボタン状態）
//   0x30 RGB_LED   R,G,B
//   0x50 OFFSET    1 を書くと現在値をゼロ点に
//   0x60 WEIGHT_I  int32, 0.01 g 単位

#include <M5Unified.h>
#include <Wire.h>

// ---- 型・定数（Arduino の自動プロトタイプより前に置く） ----
static constexpr uint8_t  SCALES_ADDR    = 0x26;
static constexpr uint8_t  REG_BUTTON     = 0x20;
static constexpr uint8_t  REG_RGB_LED    = 0x30;
static constexpr uint8_t  REG_SET_OFFSET = 0x50;
static constexpr uint8_t  REG_WEIGHT_INT = 0x60;
static constexpr uint8_t  REG_FW_VERSION = 0xFE;
static constexpr uint32_t I2C_FREQ       = 100000;

static constexpr int      HIST_N     = 120;   // グラフ: 100ms × 120 = 12秒
static constexpr int      STABLE_N   = 8;     // 安定判定に使う直近サンプル数
static constexpr float    STABLE_G   = 0.5f;  // この幅に収まれば「安定」
static constexpr float    ZERO_BAND  = 0.3f;  // ±この範囲は 0.0 g と表示
static constexpr uint32_t READ_MS    = 100;

static constexpr int W = 320, H = 240;
static constexpr int ZERO_BTN_Y = 196;        // 下部ボタン領域

// 色
static constexpr uint16_t C_BG     = 0x0841;
static constexpr uint16_t C_FG     = TFT_WHITE;
static constexpr uint16_t C_DIM    = 0x7BEF;
static constexpr uint16_t C_ACCENT = 0xFD20;  // オレンジ
static constexpr uint16_t C_OK     = 0x47E8;  // 緑
static constexpr uint16_t C_GRID   = 0x2124;

M5Canvas canvas(&M5.Display);

float    hist[HIST_N];
int      histLen  = 0;
int      histHead = 0;
float    shown    = 0;       // 表示用（平滑化後）
float    raw      = 0;
bool     connected = false;
bool     stable    = false;
uint32_t lastRead  = 0;
uint32_t tareFlashUntil = 0;
uint8_t  fwVersion = 0;
uint8_t  btnIdle   = 0;      // 起動時のボタン値（＝離している状態）
uint8_t  btnPrev   = 0;
int      ledState  = -1;     // 0=計測中 1=安定

// ---- Mini Scales I2C（公式ライブラリと同じ手順: 番号を書いて STOP → 読む） ----
bool scalesWrite(uint8_t reg, const uint8_t* data, size_t len) {
  Wire.beginTransmission(SCALES_ADDR);
  Wire.write(reg);
  Wire.write(data, len);
  return Wire.endTransmission() == 0;
}

bool scalesRead(uint8_t reg, uint8_t* buf, size_t len) {
  Wire.beginTransmission(SCALES_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(SCALES_ADDR, (uint8_t)len) != len) return false;
  for (size_t i = 0; i < len; i++) buf[i] = Wire.read();
  return true;
}

bool scalesReadGram(float* out) {
  uint8_t d[4];
  if (!scalesRead(REG_WEIGHT_INT, d, 4)) return false;
  int32_t v = (int32_t)((uint32_t)d[0] | (uint32_t)d[1] << 8 | (uint32_t)d[2] << 16 | (uint32_t)d[3] << 24);
  *out = v / 100.0f;
  return true;
}

void setLed(uint8_t r, uint8_t g, uint8_t b) {
  uint8_t c[3] = {r, g, b};
  scalesWrite(REG_RGB_LED, c, 3);
}

bool scalesInit() {
  Wire.beginTransmission(SCALES_ADDR);
  if (Wire.endTransmission() != 0) return false;
  scalesRead(REG_FW_VERSION, &fwVersion, 1);
  scalesRead(REG_BUTTON, &btnIdle, 1);
  btnPrev = btnIdle;
  ledState = -1;
  return true;
}

void tare() {
  uint8_t one = 1;
  if (!scalesWrite(REG_SET_OFFSET, &one, 1)) return;
  histLen = 0;
  shown = 0;
  tareFlashUntil = millis() + 600;
  M5.Speaker.tone(1800, 40);
}

// ユニット本体のボタン: 離している値から変わった瞬間を「押した」とみなす
void pollUnitButton() {
  uint8_t b;
  if (!scalesRead(REG_BUTTON, &b, 1)) return;
  if (b != btnIdle && btnPrev == btnIdle) tare();
  btnPrev = b;
}

void updateLed() {
  int s = stable ? 1 : 0;
  if (s == ledState) return;
  ledState = s;
  if (stable) setLed(0, 40, 0);
  else        setLed(40, 16, 0);
}

// ---- 計測 ----
void pushHist(float g) {
  hist[histHead] = g;
  histHead = (histHead + 1) % HIST_N;
  if (histLen < HIST_N) histLen++;
}

float histAt(int i) {  // i=0 が最古
  int start = (histHead - histLen + HIST_N) % HIST_N;
  return hist[(start + i) % HIST_N];
}

void updateStable() {
  if (histLen < STABLE_N) { stable = false; return; }
  float lo = 1e9, hi = -1e9;
  for (int i = histLen - STABLE_N; i < histLen; i++) {
    float v = histAt(i);
    lo = min(lo, v);
    hi = max(hi, v);
  }
  stable = (hi - lo) < STABLE_G;
}

void readScales() {
  float g;
  if (!scalesReadGram(&g)) {
    connected = false;
    return;
  }
  connected = true;
  raw = g;
  pushHist(g);
  updateStable();
  // 大きく動いたときは即追従、落ち着いているときは平滑化してチラつきを抑える
  if (fabsf(g - shown) > 5.0f) shown = g;
  else shown += (g - shown) * (stable ? 0.5f : 0.35f);
}

// ---- 描画 ----
void drawWeight() {
  float v = fabsf(shown) < ZERO_BAND ? 0.0f : shown;
  char buf[16];
  if (fabsf(v) >= 1000.0f) snprintf(buf, sizeof(buf), "%.0f", v);  // 1kg 以上は 1g 単位
  else                     snprintf(buf, sizeof(buf), "%.1f", v);

  canvas.setFont(&fonts::Font7);  // 7セグ風
  canvas.setTextSize(1.4f);
  canvas.setTextDatum(textdatum_t::baseline_right);
  canvas.setTextColor(millis() < tareFlashUntil ? C_ACCENT : C_FG);
  canvas.drawString(buf, 262, 128);

  canvas.setFont(&fonts::FreeSansBold18pt7b);
  canvas.setTextSize(1);
  canvas.setTextDatum(textdatum_t::baseline_left);
  canvas.setTextColor(C_DIM);
  canvas.drawString("g", 272, 128);

  // 1kg 以上は kg 表記も添える
  if (fabsf(v) >= 1000.0f) {
    snprintf(buf, sizeof(buf), "%.2f kg", v / 1000.0f);
    canvas.setFont(&fonts::FreeSans9pt7b);
    canvas.setTextDatum(textdatum_t::top_right);
    canvas.drawString(buf, 300, 136);
  }
}

void drawGraph() {
  const int gx = 16, gy = 150, gw = W - 32, gh = 36;
  canvas.drawRect(gx, gy, gw, gh, C_GRID);
  if (histLen < 2) return;

  float lo = 1e9, hi = -1e9;
  for (int i = 0; i < histLen; i++) {
    float v = histAt(i);
    lo = min(lo, v);
    hi = max(hi, v);
  }
  if (hi - lo < 10.0f) {  // 変化が小さいときは最低10g幅で表示（ノイズを誇張しない）
    float mid = (hi + lo) / 2;
    lo = mid - 5;
    hi = mid + 5;
  }
  int px = 0, py = 0;
  for (int i = 0; i < histLen; i++) {
    int x = gx + 1 + (gw - 2) * (HIST_N - histLen + i) / (HIST_N - 1);
    int y = gy + gh - 2 - (int)((histAt(i) - lo) / (hi - lo) * (gh - 4));
    if (i > 0) canvas.drawLine(px, py, x, y, C_ACCENT);
    px = x;
    py = y;
  }
}

void drawHeader() {
  canvas.setFont(&fonts::lgfxJapanGothicP_16);
  canvas.setTextSize(1);
  canvas.setTextDatum(textdatum_t::top_left);
  canvas.setTextColor(C_DIM);
  canvas.drawString("Unit Mini Scales", 12, 10);

  canvas.setTextDatum(textdatum_t::top_right);
  if (!connected) {
    canvas.setTextColor(TFT_RED);
    canvas.drawString("未接続", W - 12, 10);
  } else if (stable) {
    canvas.fillCircle(W - 62, 18, 5, C_OK);
    canvas.setTextColor(C_OK);
    canvas.drawString("安定", W - 12, 10);
  } else {
    canvas.drawCircle(W - 62, 18, 5, C_DIM);
    canvas.setTextColor(C_DIM);
    canvas.drawString("計測中", W - 12, 10);
  }
}

void drawZeroButton(bool pressed) {
  int x = 16, y = ZERO_BTN_Y + 4, w = W - 32, h = H - ZERO_BTN_Y - 12;
  canvas.fillRoundRect(x, y, w, h, 10, pressed ? C_ACCENT : C_GRID);
  canvas.setFont(&fonts::lgfxJapanGothicP_20);
  canvas.setTextDatum(textdatum_t::middle_center);
  canvas.setTextColor(pressed ? C_BG : C_FG);
  canvas.drawString("ゼロ（風袋引き）", W / 2, y + h / 2);
}

void drawDisconnected() {
  canvas.setFont(&fonts::lgfxJapanGothicP_20);
  canvas.setTextDatum(textdatum_t::middle_center);
  canvas.setTextColor(C_FG);
  canvas.drawString("Mini Scales が見つかりません", W / 2, 90);
  canvas.setFont(&fonts::lgfxJapanGothicP_16);
  canvas.setTextColor(C_DIM);
  canvas.drawString("PORT.A（赤いポート）に接続してください", W / 2, 124);
  canvas.drawString("I2C 0x26 を探しています…", W / 2, 150);
}

void render(bool zeroPressed) {
  canvas.fillScreen(C_BG);
  drawHeader();
  if (connected) {
    drawWeight();
    drawGraph();
    drawZeroButton(zeroPressed);
  } else {
    drawDisconnected();
  }
  canvas.pushSprite(0, 0);
}

// ---- main ----
void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  Serial.begin(115200);
  M5.Display.setRotation(1);
  M5.Speaker.setVolume(80);
  canvas.setColorDepth(16);
  canvas.createSprite(W, H);

  // PORT.A（CoreS3: SDA=G2, SCL=G1）
  Wire.begin(M5.getPin(m5::pin_name_t::port_a_sda), M5.getPin(m5::pin_name_t::port_a_scl), I2C_FREQ);
  Wire.setTimeOut(50);
  connected = scalesInit();
  Serial.printf("Mini Scales: %s (FW %u, button idle=%u)\n", connected ? "OK" : "not found", fwVersion, btnIdle);
  if (connected) tare();  // 起動時ゼロ合わせ
}

void loop() {
  M5.update();
  uint32_t now = millis();

  // 未接続なら1秒ごとに再探索（抜き差し対応）
  static uint32_t lastScan = 0;
  if (!connected && now - lastScan > 1000) {
    lastScan = now;
    if (scalesInit()) { connected = true; tare(); }
  }

  if (connected && now - lastRead >= READ_MS) {
    lastRead = now;
    readScales();
    if (connected) { pollUnitButton(); updateLed(); }
    if (connected) Serial.printf("%.2f g%s\n", raw, stable ? " (stable)" : "");
  }

  bool zeroPressed = false;
  auto t = M5.Touch.getDetail();
  if (connected && t.y >= ZERO_BTN_Y) {
    if (t.isPressed()) zeroPressed = true;
    if (t.wasPressed()) tare();
  }

  render(zeroPressed);
  delay(16);
}
