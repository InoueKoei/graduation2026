// cores3_fluid.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3 用 加速度センサ・デモ「揺れる水」
//
//   本体を傾けると、IMU の加速度が重力になって水（粒子）が流れ・溜まり・跳ねる。
//   画面をなぞると、その場所の水をかき混ぜられる。
//
// 位置ベース(PBD)の簡易粒子法。粒子どうしを最小間隔まで押し合うことで
// 非圧縮っぽい「液体」の見た目を出している。近傍探索は空間グリッドで高速化。
//
// 追加センサ不要。CoreS3 内蔵の 液晶 / IMU / タッチ だけで動く。
// 必要ライブラリ: M5Unified
// -----------------------------------------------------------------------------
#include <M5Unified.h>

// ---- パラメータ -------------------------------------------------------------
static constexpr int   N        = 260;    // 粒子数
static constexpr float H_RAD    = 10.0f;   // 相互作用（＝最小間隔）半径
static constexpr float DRAW_R   = 6.0f;    // 描画半径（H_RADより気持ち大きく＝溶け合う）
static constexpr float GRAV     = 0.30f;   // 重力の強さ
static constexpr float DAMP     = 0.98f;   // 減衰
static constexpr float STIFF    = 0.30f;   // 押し合いの強さ
static constexpr int   ITERS    = 2;       // 押し合いの反復回数
static constexpr float VMAX     = 8.0f;    // 速度上限（暴走防止）

// ---- 空間グリッド（近傍探索用）---------------------------------------------
static constexpr int   CS       = (int)H_RAD;   // セル一辺
static constexpr int   GC_MAX   = 320 / CS + 2;
static constexpr int   GR_MAX   = 240 / CS + 2;
int   head[GC_MAX * GR_MAX];
int   nxt[N];
int   GC, GR;

// ---- 粒子 -------------------------------------------------------------------
float px[N], py[N], vx[N], vy[N], ppx[N], ppy[N];

M5Canvas canvas(&M5.Display);
int      W, H;
uint16_t BG, WATER, FOAM;

uint16_t lerp565(uint16_t a, uint16_t b, float t) {
  int ar = (a >> 11) & 0x1F, ag = (a >> 5) & 0x3F, ab = a & 0x1F;
  int br = (b >> 11) & 0x1F, bg = (b >> 5) & 0x3F, bb = b & 0x1F;
  return (int(ar + (br - ar) * t) << 11) | (int(ag + (bg - ag) * t) << 5) | int(ab + (bb - ab) * t);
}

inline int cellOf(float x, float y) {
  int cx = constrain((int)(x / CS), 0, GC - 1);
  int cy = constrain((int)(y / CS), 0, GR - 1);
  return cy * GC + cx;
}

void buildGrid() {
  for (int c = 0; c < GC * GR; c++) head[c] = -1;
  for (int i = 0; i < N; i++) {
    int c = cellOf(px[i], py[i]);
    nxt[i] = head[c];
    head[c] = i;
  }
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  W = M5.Display.width();
  H = M5.Display.height();
  GC = W / CS + 1;
  GR = H / CS + 1;

  BG    = M5.Display.color565(  8,  14,  22);
  WATER = M5.Display.color565( 56, 140, 200);
  FOAM  = M5.Display.color565(220, 240, 255);

  canvas.setColorDepth(16);
  if (!canvas.createSprite(W, H)) { canvas.setColorDepth(8); canvas.createSprite(W, H); }

  // 中央に水のかたまりを置く
  randomSeed(micros());
  int cols = 20;
  for (int i = 0; i < N; i++) {
    px[i] = W / 2 - cols * 4 + (i % cols) * 8 + random(-2, 2);
    py[i] = 30 + (i / cols) * 8 + random(-2, 2);
    vx[i] = vy[i] = 0;
  }
}

void loop() {
  M5.update();

  // --- 重力（傾き）---
  float ax = 0, ay = 0, az = 0;
  M5.Imu.getAccel(&ax, &ay, &az);
  float gx = ax * GRAV;   // 流れが逆なら符号を反転
  float gy = ay * GRAV;

  // --- タッチでかき混ぜ ---
  bool stir = false; float sx = 0, sy = 0;
  auto t = M5.Touch.getDetail();
  if (t.isPressed()) { stir = true; sx = t.x; sy = t.y; }

  // --- 速度を進める＆位置を仮更新 ---
  for (int i = 0; i < N; i++) {
    vx[i] = (vx[i] + gx) * DAMP;
    vy[i] = (vy[i] + gy) * DAMP;
    if (stir) {
      float dx = px[i] - sx, dy = py[i] - sy;
      float d2 = dx * dx + dy * dy;
      if (d2 < 40 * 40 && d2 > 1) {
        float inv = 1.0f / sqrtf(d2);
        vx[i] += dx * inv * 2.5f;
        vy[i] += dy * inv * 2.5f;
      }
    }
    vx[i] = constrain(vx[i], -VMAX, VMAX);
    vy[i] = constrain(vy[i], -VMAX, VMAX);
    ppx[i] = px[i]; ppy[i] = py[i];
    px[i] += vx[i];
    py[i] += vy[i];
  }

  // --- 近傍探索 → 押し合い（非圧縮性）---
  buildGrid();
  for (int it = 0; it < ITERS; it++) {
    for (int i = 0; i < N; i++) {
      int cx = constrain((int)(px[i] / CS), 0, GC - 1);
      int cy = constrain((int)(py[i] / CS), 0, GR - 1);
      for (int oy = -1; oy <= 1; oy++) {
        int ny = cy + oy; if (ny < 0 || ny >= GR) continue;
        for (int ox = -1; ox <= 1; ox++) {
          int nx = cx + ox; if (nx < 0 || nx >= GC) continue;
          for (int j = head[ny * GC + nx]; j != -1; j = nxt[j]) {
            if (j <= i) continue;
            float dx = px[j] - px[i], dy = py[j] - py[i];
            float d2 = dx * dx + dy * dy;
            if (d2 < H_RAD * H_RAD && d2 > 0.0001f) {
              float d = sqrtf(d2);
              float push = (H_RAD - d) * STIFF * 0.5f;
              float ux = dx / d, uy = dy / d;
              px[i] -= ux * push; py[i] -= uy * push;
              px[j] += ux * push; py[j] += uy * push;
            }
          }
        }
      }
      // 壁
      if (px[i] < DRAW_R)     px[i] = DRAW_R;
      if (px[i] > W - DRAW_R) px[i] = W - DRAW_R;
      if (py[i] < DRAW_R)     py[i] = DRAW_R;
      if (py[i] > H - DRAW_R) py[i] = H - DRAW_R;
    }
  }

  // --- 実際の移動量から速度を作り直す（安定）---
  for (int i = 0; i < N; i++) {
    vx[i] = px[i] - ppx[i];
    vy[i] = py[i] - ppy[i];
  }

  // --- 描画（速い粒子ほど白く＝しぶき）---
  canvas.fillScreen(BG);
  for (int i = 0; i < N; i++) {
    float sp = sqrtf(vx[i] * vx[i] + vy[i] * vy[i]);
    float f = constrain(sp / 6.0f, 0.0f, 1.0f);
    canvas.fillCircle((int)px[i], (int)py[i], (int)DRAW_R, lerp565(WATER, FOAM, f * 0.7f));
  }
  canvas.pushSprite(0, 0);
}
