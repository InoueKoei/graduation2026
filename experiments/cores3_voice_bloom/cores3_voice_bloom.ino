// cores3_voice_bloom.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3 用 タイポグラフィ・デモ「声で咲かせる」
//
//   内蔵マイクの音量に応じて、文字が画面の下から吹き上がる。
//   大きな声・息を吹きかける ほど、たくさん・大きく舞う。
//
// 追加センサ不要。CoreS3 内蔵の 液晶 / マイク だけで動く。
// ※ CoreS3 はマイクとスピーカーが排他なので、スピーカーは止めて使う。
// 必要ライブラリ: M5Unified
// -----------------------------------------------------------------------------
#include <M5Unified.h>

static constexpr int   MAX_P    = 120;
static constexpr int   MIC_LEN  = 256;
static constexpr int   MIC_RATE = 16000;

const char* KANA[] = {
  "こ","え","の","は","な","さ","く","ら","ゆ","れ","ひ","か","り"
};
const int KANA_N = sizeof(KANA) / sizeof(KANA[0]);

struct Petal {
  float x, y, vx, vy;
  float size;        // 文字の拡大率
  float life;        // 1.0 → 0.0 で消える
  const char* ch;
};

Petal     p[MAX_P];
int       count = 0;
M5Canvas  canvas(&M5.Display);
int       W, H;
uint16_t  PAPER, INK, SAKURA;
int16_t   micBuf[MIC_LEN];

// 565 の色を t=0→a, t=1→b で混ぜる（フェード用）
uint16_t lerp565(uint16_t a, uint16_t b, float t) {
  int ar = (a >> 11) & 0x1F, ag = (a >> 5) & 0x3F, ab = a & 0x1F;
  int br = (b >> 11) & 0x1F, bg = (b >> 5) & 0x3F, bb = b & 0x1F;
  int r = ar + (br - ar) * t;
  int gg = ag + (bg - ag) * t;
  int bl = ab + (bb - ab) * t;
  return (r << 11) | (gg << 5) | bl;
}

void emit(float level) {
  if (count >= MAX_P) return;
  Petal& q = p[count++];
  q.x    = random((int)(W * 0.2f), (int)(W * 0.8f));
  q.y    = H + 10;
  q.vx   = random(-60, 60) / 100.0f;
  q.vy   = -(1.5f + level * 7.0f) - random(0, 100) / 100.0f;  // 上向き
  q.size = 1.0f + level * 3.0f;
  q.life = 1.0f;
  q.ch   = KANA[random(KANA_N)];
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  W = M5.Display.width();
  H = M5.Display.height();

  PAPER = M5.Display.color565(244, 240, 228);
  INK   = M5.Display.color565( 32,  30,  28);
  SAKURA = M5.Display.color565(206,  90, 120);

  canvas.setColorDepth(16);
  if (!canvas.createSprite(W, H)) { canvas.setColorDepth(8); canvas.createSprite(W, H); }
  canvas.setFont(&fonts::lgfxJapanGothic_24);
  canvas.setTextDatum(middle_center);

  // マイクを使うためスピーカーを止めてからマイク開始
  M5.Speaker.end();
  M5.Mic.begin();

  randomSeed(micros());
}

void loop() {
  M5.update();

  // --- マイク音量を測る ---
  float level = 0.0f;
  if (M5.Mic.record(micBuf, MIC_LEN, MIC_RATE)) {
    uint64_t sum = 0;
    for (int i = 0; i < MIC_LEN; i++) sum += (int32_t)micBuf[i] * micBuf[i];
    float rms = sqrtf((float)sum / MIC_LEN);
    level = constrain(rms / 2500.0f, 0.0f, 1.0f);   // 感度: 分母を下げると敏感に
  }

  // 音量に比例して文字を放出
  int n = (int)(level * 6.0f);
  for (int i = 0; i < n; i++) emit(level);

  // --- 更新 ---
  for (int i = 0; i < count; i++) {
    p[i].vy += 0.045f;              // ゆるい重力で山なりに
    p[i].vx *= 0.99f;
    p[i].x  += p[i].vx;
    p[i].y  += p[i].vy;
    p[i].life -= 0.006f;
  }
  // 寿命切れ・画面外を除去
  int k = 0;
  for (int i = 0; i < count; i++) {
    if (p[i].life > 0.0f && p[i].y > -30) p[k++] = p[i];
  }
  count = k;

  // --- 描画 ---
  canvas.fillScreen(PAPER);
  for (int i = 0; i < count; i++) {
    float lf = p[i].life;
    uint16_t base = (i % 5 == 0) ? SAKURA : INK;
    canvas.setTextColor(lerp565(PAPER, base, lf));  // 消えぎわは紙に溶ける
    canvas.setTextSize(p[i].size);
    canvas.drawString(p[i].ch, (int)p[i].x, (int)p[i].y);
  }
  canvas.setTextSize(1.0f);

  // 下端に音量メーター
  int barW = (int)(level * W);
  canvas.fillRect(0, H - 4, barW, 4, SAKURA);
  canvas.pushSprite(0, 0);
}
