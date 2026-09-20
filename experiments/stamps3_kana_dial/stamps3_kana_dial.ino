// つまみ字盤 — stamps3_kana_dial
//
// M5Stamp S3 (V0.3) + WeAct Studio 4.2" Epaper Module 400x300 + ロータリーエンコーダ。
// つまみを回してかなを選び、押して確定する。確定した文字列は画面下と Serial に出る。
//
//   回す              : 1文字ずつ送る
//   押しながら回す    : 行送り（あ行 → か行 …）
//   短く押す          : 確定（1文字追加）
//   長押し 0.7秒      : 1文字消す
//   長押し 2.5秒      : 全消去 + 全画面リフレッシュ（残像取り）
//
// 必要なライブラリ（ライブラリマネージャから）:
//   GxEPD2 / Adafruit GFX Library / U8g2_for_Adafruit_GFX
// ボード: ESP32S3 Dev Module / USB CDC On Boot: Enabled / Flash 8MB

#include <Arduino.h>
#include <SPI.h>
#include <GxEPD2_BW.h>
#include <U8g2_for_Adafruit_GFX.h>

// ---------------------------------------------------------------- 配線
// StampS3 で 2.54mm ピッチのピンヘッダが挿さるのは G1/G3/G5/G7/G9/G13/G15 と
// G0(BTN) / G43(U0TXD) / G44(U0RXD)。EN はチップのリセットなので GPIO には使えない。
// ちょうど 9 本必要なので、G0 だけ予備に残してある。
//
// WeAct 4.2" の基板シルク（1→8）: BUSY / RES / D/C / CS / SCL / SDA / GND / VCC
// VCC は 3V3 へ（I/O は 3.3V）。
#define PIN_EPD_BUSY 44  // U0RXD。起動時から入力なのでそのまま BUSY に使える
#define PIN_EPD_RST  43  // U0TXD。起動時に ROM のログが出るが、init() で正しくリセットし直すので問題ない
#define PIN_EPD_DC   7
#define PIN_EPD_CS   9
#define PIN_EPD_SCK  13  // モジュール側の SCL（Grove の SDA ピンだが I2C は使っていない）
#define PIN_EPD_MOSI 15  // モジュール側の SDA（同じく Grove の SCL ピン）

// エンコーダモジュール（GND / S1 / S2 / KEY / 5V の 5 ピン基板）。5V は 3V3 で動く。
// 割り込みで拾う 2 本と押しボタンは、ブート時に何も繋がっていない G1/G3/G5 に置く。
// G0 に繋ぐと、つまみを押したまま電源を入れたときにダウンロードモードで起動してしまう。
#define PIN_ENC_A   1    // S1
#define PIN_ENC_B   3    // S2
#define PIN_ENC_SW  5    // KEY
#define ENC_REVERSE 0    // 回す向きと文字送りが逆なら 1 にする
#define ENC_COUNTS_PER_DETENT 4  // EC11 の 1 クリック分。半クリック型なら 2

#define PIN_RGB_LED 21   // StampS3 内蔵 WS2812（シルクの RGB 21）

// ---------------------------------------------------------------- パネル
// WeAct 4.2" 400x300。ロットで載っているコントローラが違う。
// まずこれで試して、真っ白／文字化けなら下の GxEPD2_420 に差し替える。
GxEPD2_BW<GxEPD2_420_GDEY042T81, GxEPD2_420_GDEY042T81::HEIGHT>
    display(GxEPD2_420_GDEY042T81(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));
// 旧ロット（GDEW042T2 / UC8176、部分更新が遅い）:
//   GxEPD2_BW<GxEPD2_420, GxEPD2_420::HEIGHT>
//       display(GxEPD2_420(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));

U8G2_FOR_ADAFRUIT_GFX u8g2;   // 画面に直接書く用
U8G2_FOR_ADAFRUIT_GFX u8g2c;  // 拡大用オフスクリーンに書く用

#define FONT_JP  u8g2_font_unifont_t_japanese2  // 16px。flash が厳しければ japanese1 へ
#define FONT_NUM u8g2_font_10x20_tf
#define FONT_EN  u8g2_font_7x14_tf

// 16px のかなを 1 ドット = scale px の四角として拡大するためのオフスクリーン
#define CELL     18  // キャンバスの一辺（下の出っぱりぶんの余裕こみ）
#define ADVANCE  16  // 全角 1 文字の送り
GFXcanvas1 glyphCanvas(CELL, CELL);

// ---------------------------------------------------------------- 文字盤
// 5文字 = 1行。押しながら回すとこの 5 を単位に飛ぶ。
static const char* const KANA[] = {
    "あ", "い", "う", "え", "お",
    "か", "き", "く", "け", "こ",
    "さ", "し", "す", "せ", "そ",
    "た", "ち", "つ", "て", "と",
    "な", "に", "ぬ", "ね", "の",
    "は", "ひ", "ふ", "へ", "ほ",
    "ま", "み", "む", "め", "も",
    "や", "ゆ", "よ", "ー", "、",
    "ら", "り", "る", "れ", "ろ",
    "わ", "を", "ん", "。", "　",
};
static const int KANA_N = sizeof(KANA) / sizeof(KANA[0]);
static const int ROW_LEN = 5;

// ---------------------------------------------------------------- レイアウト (400x300)
#define HEADER_H  34
#define BOX_X     10
#define BOX_Y     44
#define BOX_S     210
#define BIG_SCALE 11   // 18 * 11 = 198 ドット角

#define DIAL_X    240
#define DIAL_ROW  28
#define DIAL_N    7    // 前後 3 文字ずつ
#define DIAL_TOP  48

#define INFO_X    296
#define BAND_Y    262  // 確定文字列の帯（上端）
#define BAND_SCALE 2   // 帯の文字は 2 倍（32px 角）

// ---------------------------------------------------------------- 状態
volatile int32_t encRaw = 0;
volatile uint8_t encState = 0;
int32_t encConsumed = 0;

int cursor = 0;                 // 文字盤の現在位置

#define MAX_CHARS 64
int8_t  stackIdx[MAX_CHARS];    // 確定済み（KANA の添字で持つ）
int     stackLen = 0;

bool     swDown = false;
uint32_t swDownMs = 0;
uint8_t  holdStage = 0;         // 0:まだ 1:1文字削除ずみ 2:全消去ずみ
bool     turnedWhileHeld = false;

bool     dirty = true;
bool     firstDraw = true;
uint32_t lastInputMs = 0;
uint32_t lastDrawMs = 0;
int      partialCount = 0;
bool     sleeping = false;

// ---------------------------------------------------------------- エンコーダ
// A/B の遷移テーブルで数える。無効な遷移（チャタリング）は 0 として捨てられる。
static const int8_t QDEC[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};

void IRAM_ATTR encISR() {
  uint8_t s = (digitalRead(PIN_ENC_A) << 1) | digitalRead(PIN_ENC_B);
  encState = ((encState << 2) | s) & 0x0F;
  encRaw += QDEC[encState];
}

int takeDetents() {
  int32_t raw = encRaw;
  int32_t d = (raw - encConsumed) / ENC_COUNTS_PER_DETENT;
  if (d) encConsumed += d * ENC_COUNTS_PER_DETENT;
#if ENC_REVERSE
  d = -d;
#endif
  return (int)d;
}

// ---------------------------------------------------------------- 描画
// 16px のかなを scale 倍のドット絵として置く。にじまない代わりに角が出る。
void blitGlyph(const char* utf8, int16_t x, int16_t y, uint8_t scale) {
  glyphCanvas.fillScreen(0);
  u8g2c.setFont(FONT_JP);
  u8g2c.setFontMode(1);
  u8g2c.setForegroundColor(1);
  u8g2c.setCursor(0, 14);
  u8g2c.print(utf8);

  for (int cy = 0; cy < CELL; cy++) {
    for (int cx = 0; cx < CELL; cx++) {
      if (glyphCanvas.getPixel(cx, cy)) {
        display.fillRect(x + cx * scale, y + cy * scale, scale, scale, GxEPD_BLACK);
      }
    }
  }
}

void drawHeader() {
  const int16_t W = display.width();
  display.fillRect(0, 0, W, HEADER_H, GxEPD_BLACK);

  u8g2.setFontMode(1);
  u8g2.setForegroundColor(GxEPD_WHITE);
  u8g2.setFont(FONT_JP);
  u8g2.setCursor(12, 24);
  u8g2.print("つまみ字盤");

  char buf[32];
  snprintf(buf, sizeof(buf), "%d / %d", cursor + 1, KANA_N);
  u8g2.setFont(FONT_EN);
  u8g2.setCursor(W - 12 - u8g2.getUTF8Width(buf), 23);
  u8g2.print(buf);

  u8g2.setForegroundColor(GxEPD_BLACK);
}

void drawDial() {
  u8g2.setFont(FONT_JP);
  u8g2.setFontMode(1);
  const int half = DIAL_N / 2;

  for (int k = -half; k <= half; k++) {
    int idx = ((cursor + k) % KANA_N + KANA_N) % KANA_N;
    int16_t y = DIAL_TOP + (k + half) * DIAL_ROW;
    if (k == 0) {
      display.fillRect(DIAL_X - 8, y, 40, DIAL_ROW, GxEPD_BLACK);
      u8g2.setForegroundColor(GxEPD_WHITE);
    } else {
      u8g2.setForegroundColor(GxEPD_BLACK);
    }
    u8g2.setCursor(DIAL_X, y + 21);
    u8g2.print(KANA[idx]);
  }
  u8g2.setForegroundColor(GxEPD_BLACK);
}

void drawInfo() {
  char buf[32];

  u8g2.setFont(FONT_NUM);
  u8g2.setForegroundColor(GxEPD_BLACK);
  snprintf(buf, sizeof(buf), "%02d chars", stackLen);
  u8g2.setCursor(INFO_X, 70);
  u8g2.print(buf);

  u8g2.setFont(FONT_EN);
  u8g2.setCursor(INFO_X, 118);
  u8g2.print("PUSH");
  u8g2.setCursor(INFO_X + 12, 134);
  u8g2.print("commit");

  u8g2.setCursor(INFO_X, 160);
  u8g2.print("HOLD 0.7s");
  u8g2.setCursor(INFO_X + 12, 176);
  u8g2.print("delete");

  u8g2.setCursor(INFO_X, 202);
  u8g2.print("HOLD + TURN");
  u8g2.setCursor(INFO_X + 12, 218);
  u8g2.print("row jump");
}

void drawBand() {
  const int16_t W = display.width();
  display.drawFastHLine(0, BAND_Y - 6, W, GxEPD_BLACK);

  const int16_t cellW = ADVANCE * BAND_SCALE;          // 32
  const int16_t left = 10;
  const int fit = (W - left - 24) / cellW;             // 入る文字数（カーソル分を残す）
  int start = stackLen - fit;
  if (start < 0) start = 0;

  int16_t x = left;
  for (int i = start; i < stackLen; i++) {
    blitGlyph(KANA[stackIdx[i]], x, BAND_Y, BAND_SCALE);
    x += cellW;
  }

  // 入力位置
  display.fillRect(x + 4, BAND_Y + 4, 6, 26, GxEPD_BLACK);

  // 画面から溢れているぶんの目印
  if (start > 0) display.fillTriangle(0, BAND_Y + 10, 6, BAND_Y + 4, 6, BAND_Y + 16, GxEPD_BLACK);
}

void drawPage() {
  display.fillScreen(GxEPD_WHITE);
  drawHeader();

  display.drawRect(BOX_X, BOX_Y, BOX_S, BOX_S, GxEPD_BLACK);
  const int16_t inset = (BOX_S - CELL * BIG_SCALE) / 2;
  blitGlyph(KANA[cursor], BOX_X + inset, BOX_Y + inset, BIG_SCALE);

  drawDial();
  drawInfo();
  drawBand();
}

// 実測（4.2" GDEY042T81）: 部分更新 655ms / 全面書き換え 2.5s。
// 全面は打っている最中に挟むと 2.5 秒固まるので、手が止まってからにする。
void render(bool forceFull = false) {
  sleeping = false;  // hibernate していても GxEPD2 が自動で起こす

  bool canPartial = display.epd2.hasFastPartialUpdate;
  bool full = firstDraw || !canPartial || forceFull || partialCount >= 40;

  if (full) {
    display.setFullWindow();
    partialCount = 0;
  } else {
    display.setPartialWindow(0, 0, display.width(), display.height());
    partialCount++;
  }

  display.firstPage();
  do {
    drawPage();
  } while (display.nextPage());

  firstDraw = false;
  lastDrawMs = millis();
}

void blink(uint8_t r, uint8_t g, uint8_t b) {
  neopixelWrite(PIN_RGB_LED, r, g, b);
  delay(40);
  neopixelWrite(PIN_RGB_LED, 0, 0, 0);
}

// ---------------------------------------------------------------- 入力
void handleEncoder() {
  int d = takeDetents();
  if (!d) return;

  int step = swDown ? ROW_LEN : 1;  // 押しながら回すと行送り
  if (swDown) turnedWhileHeld = true;

  cursor = (cursor + d * step) % KANA_N;
  if (cursor < 0) cursor += KANA_N;

  dirty = true;
  lastInputMs = millis();
}

void printText() {
  String s;
  for (int i = 0; i < stackLen; i++) s += KANA[stackIdx[i]];
  Serial.println(s);
}

void handleButton() {
  bool down = (digitalRead(PIN_ENC_SW) == LOW);
  uint32_t now = millis();

  if (down && !swDown) {                 // 押した
    swDown = true;
    swDownMs = now;
    holdStage = 0;
    turnedWhileHeld = false;
    return;
  }

  if (down && swDown) {                  // 押しっぱなし
    if (turnedWhileHeld) return;         // 行送り中は長押し判定しない
    uint32_t held = now - swDownMs;
    if (holdStage == 0 && held > 700) {
      holdStage = 1;
      if (stackLen > 0) stackLen--;
      blink(24, 0, 0);
      printText();
      dirty = true;
      lastInputMs = now;
    } else if (holdStage == 1 && held > 2500) {
      holdStage = 2;
      stackLen = 0;
      firstDraw = true;                  // 全面で焼き直して残像を落とす
      blink(24, 12, 0);
      printText();
      dirty = true;
      lastInputMs = now;
    }
    return;
  }

  if (!down && swDown) {                 // 離した
    swDown = false;
    if (now - swDownMs < 30) return;     // チャタリング
    if (holdStage == 0 && !turnedWhileHeld && stackLen < MAX_CHARS) {
      stackIdx[stackLen++] = (int8_t)cursor;
      blink(0, 24, 0);
      printText();
      dirty = true;
      lastInputMs = now;
    }
  }
}

// ---------------------------------------------------------------- 本体
void setup() {
  Serial.begin(115200);

  pinMode(PIN_ENC_A, INPUT_PULLUP);
  pinMode(PIN_ENC_B, INPUT_PULLUP);
  pinMode(PIN_ENC_SW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_A), encISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_B), encISR, CHANGE);

  SPI.begin(PIN_EPD_SCK, -1, PIN_EPD_MOSI, PIN_EPD_CS);
  display.init(115200, true, 2, false);
  display.setRotation(0);  // 400 x 300 横長

  u8g2.begin(display);
  u8g2c.begin(glyphCanvas);

  neopixelWrite(PIN_RGB_LED, 0, 0, 0);

  render();
  display.hibernate();
  sleeping = true;
}

void loop() {
  handleEncoder();
  handleButton();

  uint32_t now = millis();

  // 回している間は描かず、手が止まってからまとめて 1 回だけ描く。
  // 4.2" の部分更新はおよそ 0.5 秒、全面書き換えは 4 秒ほどかかるため。
  if (dirty && (now - lastInputMs > 160)) {
    dirty = false;
    render();
  }

  // 残像がたまっていたら、手が止まっている隙に全面で焼き直す（2.5 秒かかる）
  if (!dirty && partialCount >= 12 && (now - lastInputMs > 3000)) {
    render(true);
  }

  // しばらく触らなければパネルを寝かせる
  if (!sleeping && !dirty && (now - lastDrawMs > 4000)) {
    display.hibernate();
    sleeping = true;
  }

  delay(2);
}
