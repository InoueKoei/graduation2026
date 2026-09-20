// 8x2 キャラクタ液晶 — stamps3_lcd0802
//
// M5Stamp S3A (2.54mm ピンヘッダ版) + ACM0802C-NLW-BBH（青地に白抜き 8文字x2行）。
// HD44780 互換（ST7066 系）の 4bit モード、読み出しなし。
//
// Serial に UTF-8 で送った文字がそのまま液晶に出る。16 文字ぶんの窓が右へ流れていく。
//   カタカナ     : そのまま出る（CGROM は A00 = JIS X 0201 の半角カナ）
//   ひらがな     : カタカナに寄せて出る（液晶にひらがなの字形が無いため）
//   BS / DEL     : 1 文字消す（濁点付きは 2 バイトまとめて消す）
//   改行         : 確定。Serial に 1 行吐く。画面は残したまま（読めるように）で、
//                  次の文字が来たときに消えて新しい行が始まる
//   G0 のボタン  : 全消去
//
// ライブラリ: LiquidCrystal（Arduino IDE に最初から入っている）
// ボード: ESP32S3 Dev Module / USB CDC On Boot: Enabled / Flash 8MB

#include <Arduino.h>
#include <LiquidCrystal.h>

// ---------------------------------------------------------------- 配線
// StampS3 で 2.54mm ピッチのピンヘッダが挿さるのは G1/G3/G5/G7/G9/G13/G15 と
// G0(BTN) / G43(U0TXD) / G44(U0RXD)。4bit なので 6 本で足り、G15 が 1 本余る。
//
// ACM0802C の 14 ピン（2 列 x 7 行。ブレッドボードに直挿しできない）:
//   1:Vss(GND) 2:Vdd(+5V) 3:Vo(コントラスト) 4:RS 5:R/W 6:E 7-10:DB0-3 11-14:DB4-7
//
// Vdd は必ず 5V。3.3V ではバックライト（Vf≈4.6V）が点かず、
// コントラストに必要な Vdd-Vo=4.2〜4.6V も作れない。Vo は GND 直結でよい。
// 一方ロジックの Vih は min 2.2V なので、3.3V の GPIO で直接叩いてよい（規格内）。
// R/W は GND に直結する。H にすると LCD が DB を 5V で駆動して S3 の GPIO を壊す。
#define PIN_LCD_RS 1
#define PIN_LCD_EN 5   // G3 は ESP32-S3 のストラッピングピン。リセット直後に浮くので E には使わない
#define PIN_LCD_D4 3   // 浮いても E が立たなければ何も起きないデータ線を回してある
#define PIN_LCD_D5 7
#define PIN_LCD_D6 9
#define PIN_LCD_D7 13

#define PIN_BTN     0   // StampS3 内蔵ボタン（押すと LOW）。押したまま USB を挿すとダウンロードモードになる
#define PIN_RGB_LED 21  // StampS3 内蔵 WS2812

#define LCD_COLS 8
#define LCD_ROWS 2
#define WINDOW  (LCD_COLS * LCD_ROWS)  // 画面に見えている文字数 = 16

LiquidCrystal lcd(PIN_LCD_RS, PIN_LCD_EN, PIN_LCD_D4, PIN_LCD_D5, PIN_LCD_D6, PIN_LCD_D7);

// ---------------------------------------------------------------- 文字コード
// この液晶の CGROM は A00。0xA1-0xDF が JIS X 0201 の半角カナでそのまま並んでいる。
// 濁点 0xDE と半濁点 0xDF は独立した 1 文字なので、「ガ」は 0xB6 0xDE の 2 バイト、
// つまり画面の 2 マスを食う。8 文字しかない画面ではここが効いてくる。
//
// 表は U+30A1(ァ) から U+30FC(ー) まで。{ 本体, 濁点 } の順。濁点が要らないものは 0。
static const uint8_t KANA[][2] = {
  {0xA7,0},{0xB1,0},{0xA8,0},{0xB2,0},{0xA9,0},   // ァアィイゥ
  {0xB3,0},{0xAA,0},{0xB4,0},{0xAB,0},{0xB5,0},   // ウェエォオ
  {0xB6,0},{0xB6,0xDE},{0xB7,0},{0xB7,0xDE},      // カガキギ
  {0xB8,0},{0xB8,0xDE},{0xB9,0},{0xB9,0xDE},      // クグケゲ
  {0xBA,0},{0xBA,0xDE},{0xBB,0},{0xBB,0xDE},      // コゴサザ
  {0xBC,0},{0xBC,0xDE},{0xBD,0},{0xBD,0xDE},      // シジスズ
  {0xBE,0},{0xBE,0xDE},{0xBF,0},{0xBF,0xDE},      // セゼソゾ
  {0xC0,0},{0xC0,0xDE},{0xC1,0},{0xC1,0xDE},      // タダチヂ
  {0xAF,0},{0xC2,0},{0xC2,0xDE},                  // ッツヅ
  {0xC3,0},{0xC3,0xDE},{0xC4,0},{0xC4,0xDE},      // テデトド
  {0xC5,0},{0xC6,0},{0xC7,0},{0xC8,0},{0xC9,0},   // ナニヌネノ
  {0xCA,0},{0xCA,0xDE},{0xCA,0xDF},               // ハバパ
  {0xCB,0},{0xCB,0xDE},{0xCB,0xDF},               // ヒビピ
  {0xCC,0},{0xCC,0xDE},{0xCC,0xDF},               // フブプ
  {0xCD,0},{0xCD,0xDE},{0xCD,0xDF},               // ヘベペ
  {0xCE,0},{0xCE,0xDE},{0xCE,0xDF},               // ホボポ
  {0xCF,0},{0xD0,0},{0xD1,0},{0xD2,0},{0xD3,0},   // マミムメモ
  {0xAC,0},{0xD4,0},{0xAD,0},{0xD5,0},{0xAE,0},   // ャヤュユョ
  {0xD6,0},                                        // ヨ
  {0xD7,0},{0xD8,0},{0xD9,0},{0xDA,0},{0xDB,0},   // ラリルレロ
  {0xDC,0},{0xDC,0},                              // ヮワ
  {0xB2,0},{0xB4,0},                              // ヰヱ（イ・エで代用）
  {0xA6,0},{0xDD,0},                              // ヲン
  {0xB3,0xDE},                                     // ヴ
  {0xB6,0},{0xB9,0},                              // ヵヶ（カ・ケで代用）
  {0xDC,0xDE},{0xB2,0xDE},{0xB4,0xDE},{0xA6,0xDE},// ヷヸヹヺ
  {0xA5,0},{0xB0,0},                              // ・ー
};
static const uint16_t KANA_FIRST = 0x30A1;
static const uint16_t KANA_LAST  = 0x30FC;

static const int BUF_MAX = 240;
static uint8_t buf[BUF_MAX];
static int len = 0;
static bool dirty = true;
static bool pendingClear = false;   // 確定済み。次の 1 文字が来たら画面を空けてから積む

static uint32_t uniAcc = 0;         // UTF-8 の組み立て途中
static int uniNeed = 0;

static bool btnPrev = true;
static uint32_t btnAt = 0;

void led(uint8_t r, uint8_t g, uint8_t b) {
#if __has_include(<esp32-hal-rgb-led.h>)
  neopixelWrite(PIN_RGB_LED, r, g, b);
#endif
}

// 画面いっぱいの黒ブロック。コントラストを合わせるための的。
// 初期化が通っていれば必ず出るので、ここが出ない = 配線かコントラストの問題と切り分けられる。
void fillBlocks() {
  for (int r = 0; r < LCD_ROWS; r++) {
    lcd.setCursor(0, r);
    for (int c = 0; c < LCD_COLS; c++) lcd.write((uint8_t)0xFF);
  }
}

// clear() は 1.64ms かかるうえ画面がちらつくので、毎フレーム 16 マスを上書きするだけにする。
void render() {
  int start = (len > WINDOW) ? len - WINDOW : 0;
  uint8_t win[WINDOW];
  for (int i = 0; i < WINDOW; i++) {
    int idx = start + i;
    win[i] = (idx < len) ? buf[idx] : ' ';
  }
  lcd.setCursor(0, 0);
  for (int i = 0; i < LCD_COLS; i++) lcd.write(win[i]);
  lcd.setCursor(0, 1);
  for (int i = LCD_COLS; i < WINDOW; i++) lcd.write(win[i]);
}

void commit() {
  Serial.print("commit hex");
  for (int i = 0; i < len; i++) { Serial.print(' '); Serial.printf("%02X", buf[i]); }
  Serial.printf("  (%d マス)\n", len);
  // ここで len=0 にしてはいけない。シリアルモニタは行末の \n までを一塊で送ってくるので、
  // 同じループで読み切られて render() の前に消え、打った文字が 1 度も画面に出ない。
  // 画面は残し、次の文字が来たときに消す。
  pendingClear = true;
}

void push(uint8_t b) {
  if (pendingClear) { len = 0; pendingClear = false; }
  if (len < BUF_MAX) buf[len++] = b;
  dirty = true;
}

// Unicode のコードポイント 1 つを、液晶の CGROM のバイトに置き換えて積む。
void emit(uint32_t cp) {
  if (cp == '\r') return;
  if (cp == '\n') { commit(); return; }
  if (cp == 0x08 || cp == 0x7F) {     // 濁点付きは 2 バイトまとめて消す
    if (len > 0) {
      bool wasMark = (buf[len - 1] == 0xDE || buf[len - 1] == 0xDF);
      len--;
      if (wasMark && len > 0) len--;
      dirty = true;
    }
    return;
  }
  if (cp < 0x20) return;
  if (cp < 0x80) { push((uint8_t)cp); return; }             // ASCII はそのまま

  if (cp == 0x3000) { push(' '); return; }                   // 全角スペース
  if (cp == 0x3001) { push(0xA4); return; }                  // 、
  if (cp == 0x3002) { push(0xA1); return; }                  // 。
  if (cp == 0x300C) { push(0xA2); return; }                  // 「
  if (cp == 0x300D) { push(0xA3); return; }                  // 」
  if (cp == 0x309B) { push(0xDE); return; }                  // ゛単体
  if (cp == 0x309C) { push(0xDF); return; }                  // ゜単体

  // ひらがなは液晶に字形が無いので、カタカナに寄せる（Unicode 上はちょうど 0x60 違い）
  if (cp >= 0x3041 && cp <= 0x3096) cp += 0x60;

  if (cp >= KANA_FIRST && cp <= KANA_LAST) {
    const uint8_t *e = KANA[cp - KANA_FIRST];
    push(e[0]);
    if (e[1]) push(e[1]);                                    // 濁点はもう 1 マス使う
    return;
  }

  // 半角カナで直接送られてきた場合（U+FF61-U+FF9F はそのまま 0xA1-0xDF に並んでいる）
  if (cp >= 0xFF61 && cp <= 0xFF9F) { push((uint8_t)(cp - 0xFEC0)); return; }

  push('?');                                                 // 出せない字
}

// Serial から来たバイトを UTF-8 として組み立てる。マルチバイトは分割して届きうる。
void feedByte(uint8_t c) {
  if (uniNeed > 0) {
    if ((c & 0xC0) == 0x80) {
      uniAcc = (uniAcc << 6) | (c & 0x3F);
      if (--uniNeed == 0) emit(uniAcc);
      return;
    }
    uniNeed = 0;   // 壊れたシーケンス。捨てて組み直す
  }
  if (c < 0x80)             { emit(c); }
  else if ((c & 0xE0) == 0xC0) { uniAcc = c & 0x1F; uniNeed = 1; }
  else if ((c & 0xF0) == 0xE0) { uniAcc = c & 0x0F; uniNeed = 2; }
  else if ((c & 0xF8) == 0xF0) { uniAcc = c & 0x07; uniNeed = 3; }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BTN, INPUT_PULLUP);
  led(0, 0, 8);

  delay(50);                  // Vdd が立ち上がりきるのを待つ
  lcd.begin(LCD_COLS, LCD_ROWS);

  // 起動直後の 1.2 秒は黒ブロック。電源を入れてすぐコントラストを見られるようにしてある。
  fillBlocks();
  delay(1200);

  lcd.clear();
  lcd.setCursor(0, 0); for (const char *p = "\xB1\xB2\xB3\xB4\xB5"; *p; p++) lcd.write((uint8_t)*p);  // アイウエオ
  lcd.setCursor(0, 1); lcd.print("  ready ");
  delay(1200);

  Serial.println();
  Serial.println("stamps3_lcd0802 ready. UTF-8 で送った文字がそのまま液晶に出ます。");
  Serial.println("カタカナはそのまま、ひらがなはカタカナに寄せて表示。");
  Serial.println("濁点は独立した 1 マスを使うので「ガ」は 2 マス。");
  Serial.println("BS/DEL = 1文字消す, 改行 = 確定, G0 のボタン = 全消去");
  led(0, 4, 0);
  dirty = true;
}

void loop() {
  bool fed = false;
  while (Serial.available()) { feedByte((uint8_t)Serial.read()); fed = true; }
  if (fed) led(0, 0, 20);

  bool btn = digitalRead(PIN_BTN);
  if (btnPrev && !btn && millis() - btnAt > 200) {
    btnAt = millis();
    len = 0;
    pendingClear = false;
    uniNeed = 0;
    dirty = true;
    Serial.println("cleared");
    led(20, 0, 0);
  }
  btnPrev = btn;

  if (dirty) { render(); dirty = false; }

  if (millis() - btnAt > 120 && !fed) led(0, 4, 0);
  delay(5);
}
