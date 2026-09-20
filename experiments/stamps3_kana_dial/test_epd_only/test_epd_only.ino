// test_epd_only — 電子ペーパー単体の動作確認
//
// M5Stamp S3 + WeAct Studio 4.2" Epaper Module 400x300。
// エンコーダは繋がなくていい。配線は つまみ字盤（../stamps3_kana_dial.ino）と同じ。
//
// やること:
//   1. 起動時に BUSY ピンの状態とパネルの素性を Serial に出す
//   2. 全面書き換えでテストページを描く（枠・原点・解像度・網点・書体・線幅）
//   3. 以後 5 秒おきに画面下のカウンタ枠だけを部分更新する
//   4. 12 回ごとに全面で焼き直す
//   毎回かかった ms を Serial に出すので、部分更新が効いているか数字で分かる
//
// 必要なライブラリ: GxEPD2 / Adafruit GFX Library（日本語フォントはここでは使わない）
// ボード: M5StampS3（または ESP32S3 Dev Module）/ USB CDC On Boot: Enabled

#include <Arduino.h>
#include <SPI.h>
#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold9pt7b.h>
#include <Fonts/FreeMonoBold12pt7b.h>

// ---------------------------------------------------------------- 配線（本編と同じ）
#define PIN_EPD_BUSY 44  // U0RXD
#define PIN_EPD_RST  43  // U0TXD
#define PIN_EPD_DC   7
#define PIN_EPD_CS   9
#define PIN_EPD_SCK  13  // モジュール側の SCL
#define PIN_EPD_MOSI 15  // モジュール側の SDA
#define PIN_RGB_LED  21

// ---------------------------------------------------------------- パネル
// どちらか一方を有効にする。まず 1（新しいロット）で試して、
// 真っ白のまま／変な模様なら 0 にして UC8176 版を試す。
#define PANEL_SSD1683 1

#if PANEL_SSD1683
GxEPD2_BW<GxEPD2_420_GDEY042T81, GxEPD2_420_GDEY042T81::HEIGHT>
    display(GxEPD2_420_GDEY042T81(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));
static const char* PANEL_NAME = "GDEY042T81 / SSD1683";
#else
GxEPD2_BW<GxEPD2_420, GxEPD2_420::HEIGHT>
    display(GxEPD2_420(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));
static const char* PANEL_NAME = "GDEW042T2 / UC8176";
#endif

// ---------------------------------------------------------------- カウンタ枠
#define BOX_X 16
#define BOX_Y 208
#define BOX_W 368
#define BOX_H 56

int      counter = 0;
uint32_t lastFullMs = 0;
uint32_t lastPartialMs = 0;

// ---------------------------------------------------------------- 部品
void checker(int16_t x, int16_t y, int16_t w, int16_t h, int16_t s) {
  for (int16_t j = 0; j < h; j += s) {
    for (int16_t i = 0; i < w; i += s) {
      if ((((i / s) + (j / s)) & 1) == 0) display.fillRect(x + i, y + j, s, s, GxEPD_BLACK);
    }
  }
}

void drawCounterBox() {
  char buf[64];

  display.fillRect(BOX_X, BOX_Y, BOX_W, BOX_H, GxEPD_WHITE);
  display.drawRect(BOX_X, BOX_Y, BOX_W, BOX_H, GxEPD_BLACK);

  display.setFont(&FreeMonoBold12pt7b);
  display.setTextColor(GxEPD_BLACK);
  snprintf(buf, sizeof(buf), "PARTIAL %02d", counter);
  display.setCursor(BOX_X + 16, BOX_Y + 30);
  display.print(buf);

  // 何回目かを棒でも出す。部分更新の残像が乗るとここが一番分かりやすい
  int n = counter % 12;
  for (int i = 0; i < n; i++) {
    display.fillRect(BOX_X + 180 + i * 15, BOX_Y + 14, 10, 22, GxEPD_BLACK);
  }
}

void drawTestPage() {
  const int16_t W = display.width();
  const int16_t H = display.height();
  char buf[80];

  display.fillScreen(GxEPD_WHITE);
  display.drawRect(0, 0, W, H, GxEPD_BLACK);          // 四辺が全部見えるか
  display.fillRect(4, 4, 14, 14, GxEPD_BLACK);        // 原点（左上）

  display.setTextColor(GxEPD_BLACK);
  display.setFont(NULL);
  display.setTextSize(1);
  display.setCursor(24, 8);
  display.print("0,0");

  display.setFont(&FreeMonoBold12pt7b);
  snprintf(buf, sizeof(buf), "WeAct 4.2  %d x %d", W, H);
  display.setCursor(16, 44);
  display.print(buf);
  display.drawFastHLine(0, 52, W, GxEPD_BLACK);

  // 網点。1px 市松がつぶれずに出れば解像度は出ている
  checker(16, 64, 64, 64, 1);
  checker(92, 64, 64, 64, 2);
  checker(168, 64, 64, 64, 4);
  display.setFont(NULL);
  display.setCursor(16, 132);
  display.print("1px");
  display.setCursor(92, 132);
  display.print("2px");
  display.setCursor(168, 132);
  display.print("4px");

  // 線幅 1..4px
  for (int t = 1; t <= 4; t++) {
    display.fillRect(16, 146 + (t - 1) * 12, 216, t, GxEPD_BLACK);
    display.setCursor(238, 146 + (t - 1) * 12);
    display.print(t);
  }

  // 書体
  display.setFont(&FreeMonoBold9pt7b);
  display.setCursor(256, 76);
  display.print("ABCDEFGH");
  display.setCursor(256, 96);
  display.print("01234567");
  display.setFont(NULL);
  display.setTextSize(1);
  display.setCursor(256, 110);
  display.print("size1 abcdefgh");
  display.setTextSize(2);
  display.setCursor(256, 126);
  display.print("size2");
  display.setTextSize(1);

  // 斜線（描画の欠けを見る）
  display.drawLine(256, 150, 384, 190, GxEPD_BLACK);
  display.drawLine(256, 190, 384, 150, GxEPD_BLACK);
  display.drawCircle(320, 170, 20, GxEPD_BLACK);

  drawCounterBox();

  display.setFont(NULL);
  display.setTextSize(1);
  display.setCursor(16, 276);
  display.print(PANEL_NAME);
  snprintf(buf, sizeof(buf), "full %lu ms / partial %lu ms",
           (unsigned long)lastFullMs, (unsigned long)lastPartialMs);
  display.setCursor(16, 288);
  display.print(buf);
}

// ---------------------------------------------------------------- 更新
void fullUpdate() {
  uint32_t t0 = millis();
  display.setFullWindow();
  display.firstPage();
  do {
    drawTestPage();
  } while (display.nextPage());
  lastFullMs = millis() - t0;
  Serial.printf("full update   : %lu ms\n", (unsigned long)lastFullMs);
}

void partialUpdate() {
  uint32_t t0 = millis();
  display.setPartialWindow(BOX_X, BOX_Y, BOX_W, BOX_H);
  display.firstPage();
  do {
    drawCounterBox();
  } while (display.nextPage());
  lastPartialMs = millis() - t0;
  Serial.printf("partial update: %lu ms  (#%d)\n", (unsigned long)lastPartialMs, counter);
}

// ---------------------------------------------------------------- 本体
void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000) delay(10);  // USB-CDC が上がるのを少し待つ

  neopixelWrite(PIN_RGB_LED, 0, 0, 8);

  Serial.println();
  Serial.println("=== test_epd_only ===");
  Serial.printf("panel : %s\n", PANEL_NAME);
  Serial.printf("pins  : BUSY=%d RST=%d DC=%d CS=%d SCK=%d MOSI=%d\n",
                PIN_EPD_BUSY, PIN_EPD_RST, PIN_EPD_DC, PIN_EPD_CS, PIN_EPD_SCK, PIN_EPD_MOSI);

  // init の前に BUSY を覗く。ここが常に 0 のままだと、
  // だいたい配線違いか VCC が来ていない。
  pinMode(PIN_EPD_BUSY, INPUT);
  Serial.printf("BUSY before init: %d\n", digitalRead(PIN_EPD_BUSY));

  SPI.begin(PIN_EPD_SCK, -1, PIN_EPD_MOSI, PIN_EPD_CS);

  uint32_t t0 = millis();
  display.init(115200, true, 2, false);
  Serial.printf("init  : %lu ms\n", (unsigned long)(millis() - t0));

  display.setRotation(0);
  Serial.printf("size  : %d x %d\n", display.width(), display.height());
  Serial.printf("partial update      : %s\n", display.epd2.hasPartialUpdate ? "yes" : "no");
  Serial.printf("fast partial update : %s\n", display.epd2.hasFastPartialUpdate ? "yes" : "no");
  Serial.printf("BUSY after init : %d\n", digitalRead(PIN_EPD_BUSY));

  fullUpdate();
  display.hibernate();

  neopixelWrite(PIN_RGB_LED, 0, 8, 0);
  Serial.println("-- 5 秒おきに下の枠だけ部分更新します --");
}

void loop() {
  delay(5000);

  counter++;

  if (counter % 12 == 0) {
    Serial.println("(12 回たまったので全面で焼き直し)");
    fullUpdate();
  } else if (display.epd2.hasFastPartialUpdate) {
    partialUpdate();
  } else {
    // 部分更新が遅いパネルなので全面で。ここが選ばれたら残像が出やすい
    fullUpdate();
  }

  display.hibernate();  // 寝かせてから次で起きられるかも一緒に見る
}
