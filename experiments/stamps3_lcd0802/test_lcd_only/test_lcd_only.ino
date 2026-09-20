// 液晶単体の切り分け — test_lcd_only
//
// ACM0802C-NLW-BBH を StampS3A に繋いだだけの状態で焼く。
// G0 のボタンを押すたびにモードが変わる。
//
//   0 全黒ブロック : コントラストを合わせる的。Vo は GND 直結から試す（Vdd-Vo=5.0V で規格内）。
//                    半固定を使うなら GND 側の端から。中点では絶対に何も見えない
//   1 位置確認     : 上段 01234567 / 下段 ABCDEFGH。桁と行の対応を見る
//   2 CGROM 一覧   : 0x20 から 8 文字ずつ 1.5 秒おきに送る。半角カナが入っているか確かめる
//   3 カウンタ     : 連続動作の確認。化けたら配線かタイミング
//
// ライブラリ: LiquidCrystal（Arduino IDE に最初から入っている）
// ボード: ESP32S3 Dev Module / USB CDC On Boot: Enabled / Flash 8MB

#include <Arduino.h>
#include <LiquidCrystal.h>

#define PIN_LCD_RS 1
#define PIN_LCD_EN 5
#define PIN_LCD_D4 3
#define PIN_LCD_D5 7
#define PIN_LCD_D6 9
#define PIN_LCD_D7 13

#define PIN_BTN     0
#define PIN_RGB_LED 21

LiquidCrystal lcd(PIN_LCD_RS, PIN_LCD_EN, PIN_LCD_D4, PIN_LCD_D5, PIN_LCD_D6, PIN_LCD_D7);

enum { MODE_BLOCK = 0, MODE_POS, MODE_CGROM, MODE_COUNTER, MODE_N };
static int mode = MODE_BLOCK;

static uint8_t romBase = 0x20;   // 0x00-0x07 は CGRAM、0x08-0x1F は未定義なので 0x20 から
static uint32_t stepAt = 0;
static uint32_t counter = 0;

static bool btnPrev = true;
static uint32_t btnAt = 0;

void led(uint8_t r, uint8_t g, uint8_t b) {
#if __has_include(<esp32-hal-rgb-led.h>)
  neopixelWrite(PIN_RGB_LED, r, g, b);
#endif
}

void drawBlock() {
  for (int r = 0; r < 2; r++) {
    lcd.setCursor(0, r);
    for (int c = 0; c < 8; c++) lcd.write((uint8_t)0xFF);
  }
}

void drawPos() {
  lcd.setCursor(0, 0); lcd.print("01234567");
  lcd.setCursor(0, 1); lcd.print("ABCDEFGH");
}

void drawCgrom() {
  char head[16];
  snprintf(head, sizeof(head), "%02X-%02X   ", romBase, (uint8_t)(romBase + 7));
  lcd.setCursor(0, 0);
  for (int i = 0; i < 8; i++) lcd.write((uint8_t)head[i]);
  lcd.setCursor(0, 1);
  for (int i = 0; i < 8; i++) lcd.write((uint8_t)(romBase + i));

  Serial.printf("CGROM %02X-%02X\n", romBase, (uint8_t)(romBase + 7));
}

void drawCounter() {
  char b[16];
  lcd.setCursor(0, 0); lcd.print("count   ");
  snprintf(b, sizeof(b), "%8lu", (unsigned long)counter);
  lcd.setCursor(0, 1);
  for (int i = 0; i < 8; i++) lcd.write((uint8_t)b[i]);
}

void enterMode(int m) {
  mode = m;
  romBase = 0x20;
  counter = 0;
  stepAt = millis();
  lcd.clear();
  switch (mode) {
    case MODE_BLOCK:   led(8, 8, 8);  Serial.println("mode 0: 全黒ブロック（Vo は GND 直結から。半固定なら GND 側の端）"); drawBlock();   break;
    case MODE_POS:     led(0, 0, 20); Serial.println("mode 1: 位置確認");                                    drawPos();     break;
    case MODE_CGROM:   led(0, 20, 0); Serial.println("mode 2: CGROM 一覧");                                  drawCgrom();   break;
    case MODE_COUNTER: led(20, 8, 0); Serial.println("mode 3: カウンタ");                                    drawCounter(); break;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BTN, INPUT_PULLUP);

  delay(50);
  lcd.begin(8, 2);

  Serial.println();
  Serial.println("test_lcd_only — G0 のボタンでモードを送る");
  Serial.println("何も出ないときの順番: バックライトは点いているか →");
  Serial.println("  Vo は GND 直結か（半固定なら GND 側の端）→ Vdd は本当に 5V か → R/W は GND か");
  enterMode(MODE_BLOCK);
}

void loop() {
  bool btn = digitalRead(PIN_BTN);
  if (btnPrev && !btn && millis() - btnAt > 200) {
    btnAt = millis();
    enterMode((mode + 1) % MODE_N);
  }
  btnPrev = btn;

  uint32_t now = millis();
  if (mode == MODE_CGROM && now - stepAt > 1500) {
    stepAt = now;
    romBase += 8;
    if (romBase < 0x20) romBase = 0x20;   // 0xF8 の次に一周して 0x00 になったら戻す
    drawCgrom();
  } else if (mode == MODE_COUNTER && now - stepAt > 200) {
    stepAt = now;
    counter++;
    drawCounter();
  }

  delay(5);
}
