// 8x2 の時計 — stamps3_lcd_clock
//
// M5Stamp S3A + ACM0802C-NLW-BBH。配線は stamps3_lcd0802 と同じ。
//
//   09/16ｽｲ      上段: 月/日 + 曜日（3 マス右寄せ）
//   01:52 ﾊﾚ      下段: 時:分 + 天気（2 マス）
//
// 時刻は ESP32 が millis() で持つ。PC は同期を投げるだけなので、
// ケーブルを抜いても時計は動き続ける（RTC が無いので少しずつずれる。PC が繋がっていれば直る）。
//
// Serial のプロトコル（115200、行単位）:
//   S<epoch>   時刻合わせ。epoch はローカル時刻の秒（PC 側で時差を足しておく）
//   W<0-4>     天気 0=ハレ 1=クモ 2=アメ 3=ユキ 4=カミ
//   M<text>    上段にメッセージ（UTF-8）。出したままになる。次の M か C で入れ替わる
//   C          メッセージを消して日付に戻す
//   A<n>       n 回点滅して知らせる（文字と内蔵 LED）
//   ?          いまの状態を返す
//
// ボード: ESP32S3 Dev Module / USB CDC On Boot: Enabled / Flash 8MB

#include <Arduino.h>
#include <LiquidCrystal.h>
#include <time.h>
#include "kana.h"

#define PIN_LCD_RS 1
#define PIN_LCD_EN 5
#define PIN_LCD_D4 3
#define PIN_LCD_D5 7
#define PIN_LCD_D6 9
#define PIN_LCD_D7 13
#define PIN_BTN     0
#define PIN_RGB_LED 21

LiquidCrystal lcd(PIN_LCD_RS, PIN_LCD_EN, PIN_LCD_D4, PIN_LCD_D5, PIN_LCD_D6, PIN_LCD_D7);

// ---------------------------------------------------------------- 文字
// CGROM は A00。0xA1-0xDF が JIS X 0201 の半角カナ。濁点 0xDE は独立した 1 文字なので
// 「ｹﾞﾂ」は 3 マス、「ｽｲ」は 2 マス。曜日によって幅が変わるため右寄せで吸収する。
//
// 日 ﾆﾁ(2) / 月 ｹﾞﾂ(3) / 火 ｶﾖ(2) / 水 ｽｲ(2) / 木 ﾓｸ(2) / 金 ｷﾝ(2) / 土 ﾄﾞﾖ(3)
// 土曜は ﾄﾞﾖｳ だと 4 マスで入らないので ﾄﾞﾖ に詰めてある。
static const uint8_t WDAY[7][4] = {
  {2, 0xC6, 0xC1, 0},          // 日 ﾆﾁ
  {3, 0xB9, 0xDE, 0xC2},       // 月 ｹﾞﾂ
  {2, 0xB6, 0xD6, 0},          // 火 ｶﾖ
  {2, 0xBD, 0xB2, 0},          // 水 ｽｲ
  {2, 0xD3, 0xB8, 0},          // 木 ﾓｸ
  {2, 0xB7, 0xDD, 0},          // 金 ｷﾝ
  {3, 0xC4, 0xDE, 0xD6},       // 土 ﾄﾞﾖ
};
#define WDAY_CELLS 3           // 右寄せで確保する幅

// 天気はどれも 2 マスに収まるものを選んである（ｸﾓﾘ は 3 マスなので ｸﾓ）
static const uint8_t WX[5][2] = {
  {0xCA, 0xDA},   // ハレ
  {0xB8, 0xD3},   // クモ
  {0xB1, 0xD2},   // アメ
  {0xD5, 0xB7},   // ユキ
  {0xB6, 0xD0},   // カミ（雷）
};
#define WX_N 5

// ---------------------------------------------------------------- 状態
static uint32_t baseEpoch  = 0;      // 最後に同期したローカル時刻（秒）
static uint32_t baseMillis = 0;
static bool     synced     = false;
static int      wx         = 0;
static uint32_t lastShown  = 0;      // 表示中の分。変わったときだけ描き直す

// メッセージ。出ているあいだは上段が日付からこれに置き換わる（下段の時計は残る）。
// 消えると困る用途（「待ってる」など）があるので、時間では消さない。次の M か C で入れ替わる。
static uint8_t  msg[8];
static int      msgLen    = 0;
static bool     msgActive = false;

static char line[64];
static int  lineLen = 0;

void led(uint8_t r, uint8_t g, uint8_t b) {
#if __has_include(<esp32-hal-rgb-led.h>)
  neopixelWrite(PIN_RGB_LED, r, g, b);
#endif
}

uint32_t nowEpoch() { return baseEpoch + (millis() - baseMillis) / 1000; }

// 8 マスを 1 行ぶん書く。足りない分は空白で埋める（clear() は使わない。ちらつくので）
void writeRow(int row, const uint8_t *cells, int n) {
  lcd.setCursor(0, row);
  for (int i = 0; i < 8; i++) lcd.write(i < n ? cells[i] : (uint8_t)' ');
}

void draw() {
  uint32_t e = nowEpoch();
  time_t t = (time_t)e;
  struct tm tmv;
  gmtime_r(&t, &tmv);   // baseEpoch にローカル時刻を入れてあるので gmtime でローカルの値が出る

  uint8_t top[8], bot[8];
  int n;

  // 上段: メッセージが出ていればそれ。無ければ MM/DD + 曜日を右寄せ
  if (msgActive) {
    writeRow(0, msg, msgLen);
  } else {
    n = 0;
    top[n++] = '0' + (tmv.tm_mon + 1) / 10;
    top[n++] = '0' + (tmv.tm_mon + 1) % 10;
    top[n++] = '/';
    top[n++] = '0' + tmv.tm_mday / 10;
    top[n++] = '0' + tmv.tm_mday % 10;
    {
      const uint8_t *w = WDAY[tmv.tm_wday % 7];
      int wlen = w[0];
      for (int i = 0; i < WDAY_CELLS - wlen; i++) top[n++] = ' ';   // 右寄せぶんの空白
      for (int i = 0; i < wlen; i++) top[n++] = w[1 + i];
    }
    writeRow(0, top, n);
  }

  // 下段: HH:MM + 天気
  n = 0;
  bot[n++] = '0' + tmv.tm_hour / 10;
  bot[n++] = '0' + tmv.tm_hour % 10;
  bot[n++] = synced ? ':' : ' ';   // 未同期のあいだはコロンを消して「合っていない」と分かるようにする
  bot[n++] = '0' + tmv.tm_min / 10;
  bot[n++] = '0' + tmv.tm_min % 10;
  bot[n++] = ' ';
  bot[n++] = WX[wx][0];
  bot[n++] = WX[wx][1];
  writeRow(1, bot, n);
}

void handleLine(const char *s) {
  if (s[0] == 'S') {
    baseEpoch  = (uint32_t)strtoul(s + 1, NULL, 10);
    baseMillis = millis();
    synced     = true;
    lastShown  = 0;                       // すぐ描き直す
    Serial.printf("synced %lu\n", (unsigned long)baseEpoch);
    led(0, 20, 0);
  } else if (s[0] == 'W') {
    int v = atoi(s + 1);
    if (v >= 0 && v < WX_N) { wx = v; lastShown = 0; Serial.printf("wx %d\n", v); }
    else Serial.printf("wx out of range: %d\n", v);
  } else if (s[0] == 'M') {
    // UTF-8 を CGROM のバイトに変換して 8 マスに詰める。
    // 濁点が 1 マス食うので、元の文字数ではなくマス数で切れる点に注意。
    msgLen    = kanaFromUtf8(s + 1, msg, 8);
    msgActive = (msgLen > 0);
    lastShown = 0;
    Serial.printf("msg %d マス\n", msgLen);
  } else if (s[0] == 'C') {
    msgActive = false;
    lastShown = 0;
    Serial.println("msg cleared");
  } else if (s[0] == 'A') {
    int n = atoi(s + 1);
    if (n < 1) n = 1;
    if (n > 8) n = 8;
    for (int i = 0; i < n; i++) {   // バックライトは配線が固定なので、文字と内蔵 LED で知らせる
      lcd.noDisplay(); led(40, 20, 0); delay(120);
      lcd.display();   led(0, 0, 0);  delay(180);
    }
    led(0, 8, 0);
    Serial.printf("alert %d\n", n);
  } else if (s[0] == '?') {
    Serial.printf("epoch %lu synced %d wx %d msg %d\n",
                  (unsigned long)nowEpoch(), synced ? 1 : 0, wx, msgActive ? msgLen : 0);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BTN, INPUT_PULLUP);
  led(0, 0, 8);

  delay(50);
  lcd.begin(8, 2);
  lcd.clear();

  Serial.println();
  Serial.println("stamps3_lcd_clock ready.");
  Serial.println("  S<epoch>  時刻合わせ（ローカル時刻の秒。PC 側で時差を足しておく）");
  Serial.println("  W<0-4>    0=ハレ 1=クモ 2=アメ 3=ユキ 4=カミ");
  Serial.println("  M<text>   上段にメッセージ（UTF-8）");
  Serial.println("  C         メッセージを消す");
  Serial.println("  A<n>      n 回点滅");
  Serial.println("  ?         状態を返す");
  Serial.println("同期するまでコロンが消えています。G0 でメッセージ消去／天気送り。");
  led(20, 8, 0);   // 未同期は橙
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (lineLen > 0) { line[lineLen] = 0; handleLine(line); lineLen = 0; }
    } else if (lineLen < (int)sizeof(line) - 1) {
      line[lineLen++] = c;
    }
  }

  // G0: メッセージが出ていれば消す。出ていなければ天気を送る（PC 無しで見た目を確かめる用）
  static bool prev = true;
  static uint32_t at = 0;
  bool btn = digitalRead(PIN_BTN);
  if (prev && !btn && millis() - at > 200) {
    at = millis();
    if (msgActive) { msgActive = false; Serial.println("msg cleared"); }
    else           { wx = (wx + 1) % WX_N; Serial.printf("wx %d\n", wx); }
    lastShown = 0;
  }
  prev = btn;

  // 分が変わったときだけ描く。毎周描くと点滅して見える
  uint32_t minute = nowEpoch() / 60;
  if (minute != lastShown) { lastShown = minute; draw(); }

  delay(20);
}
