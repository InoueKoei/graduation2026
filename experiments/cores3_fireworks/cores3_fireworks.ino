// cores3_fireworks.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3 用 インタラクション・デモ「花火 — さわった場所で打ち上がる」
//
//   - 画面をさわる … その場所めがけて花火が打ち上がり、炸裂する
//   - 本体を傾ける … 火の粉が風に流される（傾けた向きへたなびく）
//   - 本体を振る   … 連発（フィナーレ）
//   - 炸裂の瞬間   … スピーカーが「ドン」と鳴る
//
//   ※ 文字は出ない。暗い夜空に火の粉が尾を引いて降る。
//
//   仕組み: 自前の 320x240 フレームバッファを毎フレーム少しずつ暗く（フェード）
//   することで火の粉が“残像の尾”を引く。粒は重力＋風の弾道で飛ぶ。
//   ripple（波の面）/ fluid（粒子の液体）とは別系統の「発光する弾道パーティクル」。
//
// 追加センサ不要。CoreS3 内蔵の 液晶 / タッチ / IMU / スピーカー だけで動く。
// 必要ライブラリ: M5Unified（M5GFX を含む）
// -----------------------------------------------------------------------------
#include <M5Unified.h>

static constexpr int SW = 320, SH = 240;
uint16_t* fb = nullptr;                 // 自前フレームバッファ（RGB565・残像フェード用）

// ---- パーティクル -----------------------------------------------------------
struct Spark { float x, y, vx, vy; int life, life0; uint8_t r, g, b; bool on; };
struct Rocket { float x, y, vx, vy; float targetY; uint8_t r, g, b; bool on; };

static constexpr int MAX_SPARK  = 900;
static constexpr int MAX_ROCKET = 8;
Spark  sparks[MAX_SPARK];
Rocket rockets[MAX_ROCKET];

static constexpr float GRAVITY = 0.055f;

// 炸裂色のパレット（1発ごとにどれかを選ぶ）
const uint8_t PAL[][3] = {
  {255,180, 40}, {255, 70, 70}, { 90,255,130}, { 90,160,255},
  {205, 90,255}, {255,120,200}, {120,255,240}, {255,240,180},
};
const int NPAL = sizeof(PAL) / sizeof(PAL[0]);

float windX = 0.0f;

// ---- 小物 -------------------------------------------------------------------
static inline int   clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
static inline float frnd(float a, float b) { return a + (b - a) * (rand() / (float)RAND_MAX); }
static inline uint16_t col565(int r, int g, int b) {
  r = clampi(r,0,255); g = clampi(g,0,255); b = clampi(b,0,255);
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
static inline void plot(int x, int y, uint16_t c) {
  if ((unsigned)x < SW && (unsigned)y < SH) fb[y * SW + x] = c;
}
static inline void plot2(int x, int y, uint16_t c) {   // 2x2 の少し大きい粒
  plot(x, y, c); plot(x + 1, y, c); plot(x, y + 1, c); plot(x + 1, y + 1, c);
}

// ---- 生成 -------------------------------------------------------------------
void addSpark(float x, float y, float vx, float vy, int life, uint8_t r, uint8_t g, uint8_t b) {
  for (int i = 0; i < MAX_SPARK; i++) if (!sparks[i].on) {
    sparks[i] = { x, y, vx, vy, life, life, r, g, b, true };
    return;
  }
}

// 炸裂: 中心から放射状に火の粉をばらまく＋「ドン」
void burst(float x, float y, uint8_t r, uint8_t g, uint8_t b) {
  int n = (int)frnd(70, 120);
  for (int k = 0; k < n; k++) {
    float ang = frnd(0, 6.2832f);
    float spd = frnd(0.4f, 3.6f);            // 遅い粒〜速い粒で球状の広がり
    int   life = (int)frnd(45, 100);
    // たまに白めの粒を混ぜて“きらめき”を出す
    bool spark = (rand() % 6 == 0);
    addSpark(x, y, cosf(ang) * spd, sinf(ang) * spd, life,
             spark ? 255 : r, spark ? 255 : g, spark ? 255 : b);
  }
  M5.Speaker.tone(frnd(110, 180), 170);      // 「ドン」。小型SPで痩せない帯域＋長めで大きく聞こえる
}

void launch(float targetX, float targetY) {
  for (int i = 0; i < MAX_ROCKET; i++) if (!rockets[i].on) {
    const uint8_t* p = PAL[rand() % NPAL];
    rockets[i] = { targetX, (float)(SH - 1), 0.0f, -frnd(4.2f, 5.2f),
                   targetY, p[0], p[1], p[2], true };
    return;
  }
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Imu.begin();
  M5.Speaker.begin();
  M5.Speaker.setVolume(255);   // 最大。CoreS3 のアンプ(AW88298)をフルに使う

  fb = (uint16_t*)heap_caps_malloc((size_t)SW * SH * 2, MALLOC_CAP_SPIRAM);
  if (!fb) {
    M5.Display.setTextDatum(middle_center);
    M5.Display.drawString("メモリ確保に失敗", SW / 2, SH / 2);
    while (true) delay(1000);
  }
  for (int i = 0; i < SW * SH; i++) fb[i] = 0;
  for (auto& s : sparks)  s.on = false;
  for (auto& r : rockets) r.on = false;

  M5.Display.startWrite();
  M5.Display.fillScreen(TFT_BLACK);
}

void loop() {
  M5.update();

  // ── 入力: タッチ＝その場所へ打ち上げ ────────────────────────────────────
  auto t = M5.Touch.getDetail();
  if (t.wasPressed()) launch(clampi(t.x, 8, SW - 8), clampi(t.y, 20, SH - 60));

  // ── 入力: IMU（傾き＝風 / 振り＝連発）──────────────────────────────────
  float ax, ay, az;
  M5.Imu.getAccel(&ax, &ay, &az);
  windX = ax * 0.12f;                                   // 傾けた向きへ火の粉がたなびく
  float shake = fabsf(sqrtf(ax*ax + ay*ay + az*az) - 1.0f);
  static uint32_t lastFinale = 0;
  if (shake > 0.6f && millis() - lastFinale > 400) {   // 振ったらフィナーレ
    int n = (int)frnd(3, 6);
    for (int k = 0; k < n; k++) launch(frnd(30, SW - 30), frnd(35, 130));
    lastFinale = millis();
  }

  // ── フレームバッファを少し暗く（火の粉が尾を引く残像フェード）────────────
  for (int i = 0; i < SW * SH; i++) {
    uint16_t p = fb[i];
    if (!p) continue;
    int r = (p >> 11) & 0x1F, g = (p >> 5) & 0x3F, b = p & 0x1F;
    r -= (r > 0);  g -= (g > 1) ? 2 : (g > 0); b -= (b > 0);   // ゆっくり減衰
    fb[i] = (r << 11) | (g << 5) | b;
  }

  // ── ロケット（上昇→頂点で炸裂）──────────────────────────────────────────
  for (auto& r : rockets) if (r.on) {
    r.vy += GRAVITY;
    r.x  += r.vx;
    r.y  += r.vy;
    plot2((int)r.x, (int)r.y, col565(r.r + 60, r.g + 60, r.b + 60)); // 明るい火種＋尾
    if (r.y <= r.targetY || r.vy >= -0.4f) {            // 目標高度か頂点で炸裂
      burst(r.x, r.y, r.r, r.g, r.b);
      r.on = false;
    }
  }

  // ── 火の粉（重力＋風の弾道、寿命で消える）────────────────────────────────
  for (auto& s : sparks) if (s.on) {
    s.vy += GRAVITY;
    s.vx += windX;
    s.vx *= 0.995f;                                     // 空気抵抗で少し落ち着く
    s.x  += s.vx;
    s.y  += s.vy;
    s.life--;
    if (s.life <= 0 || s.y >= SH || s.x < 0 || s.x >= SW) { s.on = false; continue; }
    float f = (float)s.life / s.life0;                  // 1→0（新しいほど明るい）
    float white = f > 0.75f ? (f - 0.75f) * 4.0f : 0.0f; // 生まれた直後は白く熱い
    int r = (s.r + (255 - s.r) * white) * f;
    int g = (s.g + (255 - s.g) * white) * f;
    int b = (s.b + (255 - s.b) * white) * f;
    uint16_t c = col565(r, g, b);
    if (f > 0.6f) plot2((int)s.x, (int)s.y, c); else plot((int)s.x, (int)s.y, c);
  }

  // ── 表示（自前バッファを一括転送）──────────────────────────────────────
  M5.Display.pushImage(0, 0, SW, SH, fb);
}
