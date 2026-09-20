// UTF-8 → HD44780 A00 CGROM（JIS X 0201 半角カナ）の変換。
//
// この液晶の CGROM は A00。0xA1-0xDF が半角カナでそのまま並んでいる。
// 濁点 0xDE / 半濁点 0xDF は独立した 1 文字なので、「ガ」は 2 バイト = 画面の 2 マス。
// 変換後の「マス数」は元の文字数と一致しない。数えるのは必ずマスのほう。
//
// ひらがなは CGROM に字形が無いので、カタカナに寄せる（Unicode 上でちょうど 0x60 違い）。

#pragma once
#include <Arduino.h>

// U+30A1(ァ) から U+30FC(ー) まで 92 文字。{ 本体, 濁点 }。濁点が要らないものは 0。
static const uint8_t KANA_TBL[][2] = {
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

// コードポイント 1 つを out に積む。積んだマス数を返す。
inline int kanaPutCodepoint(uint32_t cp, uint8_t *out, int room) {
  if (room <= 0) return 0;
  if (cp < 0x20) return 0;
  if (cp < 0x80) { out[0] = (uint8_t)cp; return 1; }

  switch (cp) {
    case 0x3000: out[0] = ' ';  return 1;   // 全角スペース
    case 0x3001: out[0] = 0xA4; return 1;   // 、
    case 0x3002: out[0] = 0xA1; return 1;   // 。
    case 0x300C: out[0] = 0xA2; return 1;   // 「
    case 0x300D: out[0] = 0xA3; return 1;   // 」
    case 0x309B: out[0] = 0xDE; return 1;   // ゛
    case 0x309C: out[0] = 0xDF; return 1;   // ゜
  }

  if (cp >= 0x3041 && cp <= 0x3096) cp += 0x60;          // ひらがな → カタカナ

  if (cp >= KANA_FIRST && cp <= KANA_LAST) {
    const uint8_t *e = KANA_TBL[cp - KANA_FIRST];
    out[0] = e[0];
    if (!e[1]) return 1;
    if (room < 2) return 1;                               // 濁点が入らないなら本体だけ
    out[1] = e[1];
    return 2;
  }
  if (cp >= 0xFF61 && cp <= 0xFF9F) { out[0] = (uint8_t)(cp - 0xFEC0); return 1; }  // 半角カナ直送り

  out[0] = '?';
  return 1;
}

// UTF-8 の文字列をまるごと変換する。積んだマス数を返す（元の文字数とは一致しない）。
inline int kanaFromUtf8(const char *s, uint8_t *out, int maxOut) {
  int n = 0;
  while (*s && n < maxOut) {
    uint8_t c = (uint8_t)*s++;
    uint32_t cp;
    int need;
    if      (c < 0x80)          { cp = c;        need = 0; }
    else if ((c & 0xE0) == 0xC0) { cp = c & 0x1F; need = 1; }
    else if ((c & 0xF0) == 0xE0) { cp = c & 0x0F; need = 2; }
    else if ((c & 0xF8) == 0xF0) { cp = c & 0x07; need = 3; }
    else continue;                                        // 不正な先頭バイトは捨てる
    bool ok = true;
    for (int i = 0; i < need; i++) {
      uint8_t k = (uint8_t)*s;
      if ((k & 0xC0) != 0x80) { ok = false; break; }      // 途中で切れている
      cp = (cp << 6) | (k & 0x3F);
      s++;
    }
    if (!ok) continue;
    n += kanaPutCodepoint(cp, out + n, maxOut - n);
  }
  return n;
}
