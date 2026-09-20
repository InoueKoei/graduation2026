// cores3_ripple.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3 用 インタラクション・デモ「波紋 — さわると波立つ水面」
//
//   - 画面をさわる／なぞる … 触れた場所から波紋が広がり、画面の縁で反射する
//   - 本体を傾ける          … 低い側に雨粒がぽつぽつ落ちて波紋が生まれる
//   - 本体を振る            … 水面が一気に荒れる（にわか雨）
//   - さわった瞬間          … スピーカーが小さく「ぽちゃん」と鳴る
//
//   ※ 文字は出ない。触覚と反射だけの水面。
//
//   仕組み: height-field（波動方程式の差分法）。2枚の高さバッファを交互に使い、
//   近傍の平均から次の高さを求め、少しずつ減衰させて波が伝播・反射する。
//   fluid デモ（粒子法）とは別の方式で「波の面」を出している。
//   計算は 160x120 の格子で行い、2倍に拡大して 320x240 に表示する。
//
// 追加センサ不要。CoreS3 内蔵の 液晶 / タッチ / IMU / スピーカー だけで動く。
// 必要ライブラリ: M5Unified（M5GFX を含む）
// -----------------------------------------------------------------------------
#include <M5Unified.h>

// ---- 格子（表示の半分の解像度で計算し、2倍に拡大表示）-----------------------
static constexpr int GW = 160;   // 格子の幅  （表示 320 / 2）
static constexpr int GH = 120;   // 格子の高さ（表示 240 / 2）
static constexpr int N  = GW * GH;

int16_t* bufA = nullptr;         // 高さバッファ（交互に current / previous として使う）
int16_t* bufB = nullptr;
int16_t* cur  = nullptr;         // 今フレームの書き込み先
int16_t* prev = nullptr;         // 前フレーム
uint16_t* gridCol = nullptr;     // 160x120 の着色結果（これを2倍表示）

M5Canvas canvas(&M5.Display);    // 320x240 のオフスクリーン（ちらつき防止）

// ---- 波の効き具合 -----------------------------------------------------------
static constexpr int   DAMP_SHIFT = 6;    // 減衰。大きいほど波が長く残る（5=短命, 7=長命）
static constexpr int16_t SPLASH   = 900;  // タッチ1点あたりの波の高さ
static constexpr int16_t RAINDROP = 700;  // 雨粒の高さ

// ---- 入力状態 ---------------------------------------------------------------
uint32_t lastToneMs = 0;

static inline int clamp8(int v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

// 格子の1点に波を立てる。伝播で「近傍を読む」のは prev 側なので、外乱は prev に入れる
// （Hugo Elias 式の水面。dest=cur に入れると1フレームで打ち消されてしまう）
void drop(int gx, int gy, int16_t power) {
  if (gx < 2 || gy < 2 || gx >= GW - 2 || gy >= GH - 2) return;
  int i = gy * GW + gx;
  prev[i]      += power;
  prev[i - 1]  += power >> 1;
  prev[i + 1]  += power >> 1;
  prev[i - GW] += power >> 1;
  prev[i + GW] += power >> 1;
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);            // 320x240 横向き
  M5.Imu.begin();
  M5.Speaker.begin();
  M5.Speaker.setVolume(80);

  // バッファは PSRAM に確保（本体 SRAM を圧迫しない）
  bufA    = (int16_t*) heap_caps_calloc(N, sizeof(int16_t), MALLOC_CAP_SPIRAM);
  bufB    = (int16_t*) heap_caps_calloc(N, sizeof(int16_t), MALLOC_CAP_SPIRAM);
  gridCol = (uint16_t*)heap_caps_malloc(N * sizeof(uint16_t), MALLOC_CAP_SPIRAM);
  if (!bufA || !bufB || !gridCol) {
    M5.Display.setTextDatum(middle_center);
    M5.Display.drawString("メモリ確保に失敗", 160, 120);
    while (true) delay(1000);
  }
  cur = bufA; prev = bufB;

  canvas.setPsram(true);
  canvas.setColorDepth(16);
  canvas.createSprite(320, 240);

  M5.Display.fillScreen(TFT_BLACK);
}

void loop() {
  M5.update();

  // ── 入力: タッチ（押している間は連続で波紋を落とす＝なぞりに追従）──────────
  auto t = M5.Touch.getDetail();
  if (t.isPressed()) {
    drop(t.x / 2, t.y / 2, SPLASH);
    if (t.wasPressed() && millis() - lastToneMs > 60) {   // 触れた瞬間に「ぽちゃん」
      M5.Speaker.tone(180 + (rand() % 60), 40);
      lastToneMs = millis();
    }
  }

  // ── 入力: IMU（傾きで雨、振ると荒れる）──────────────────────────────────
  float ax, ay, az;
  M5.Imu.getAccel(&ax, &ay, &az);
  float tiltMag = sqrtf(ax * ax + ay * ay);          // 水平方向の傾き量
  float shake   = fabsf(sqrtf(ax * ax + ay * ay + az * az) - 1.0f); // 1g からのズレ

  if (shake > 0.5f) {                                 // 振り＝にわか雨
    int drops = (int)(shake * 10);
    for (int k = 0; k < drops && k < 24; k++)
      drop(4 + rand() % (GW - 8), 4 + rand() % (GH - 8), RAINDROP);
  } else if (tiltMag > 0.18f) {                       // 傾け＝低い側にぽつり
    if (rand() % 3 == 0) {
      // 傾いている向き（低い側）に寄せて落とす
      int cx = GW / 2 + (int)(ax * GW * 0.5f);
      int cy = GH / 2 + (int)(ay * GH * 0.5f);
      cx += (rand() % 40) - 20;
      cy += (rand() % 40) - 20;
      if (cx < 4) cx = 4; if (cx > GW - 4) cx = GW - 4;
      if (cy < 4) cy = 4; if (cy > GH - 4) cy = GH - 4;
      drop(cx, cy, RAINDROP);
    }
  }

  // ── 波の伝播（内部セルのみ。縁は 0 のまま＝壁で反射）──────────────────────
  for (int y = 1; y < GH - 1; y++) {
    int row = y * GW;
    for (int x = 1; x < GW - 1; x++) {
      int i = row + x;
      // 近傍4点の平均*2 - 自分（前フレーム値）→ 波動方程式の差分
      int v = ((prev[i - 1] + prev[i + 1] + prev[i - GW] + prev[i + GW]) >> 1) - cur[i];
      v -= v >> DAMP_SHIFT;                            // 減衰
      cur[i] = (int16_t)v;
    }
  }

  // ── 着色（左右・上下の傾き＝斜面を光源に見立ててきらめかせる）──────────────
  for (int y = 1; y < GH - 1; y++) {
    int row = y * GW;
    for (int x = 1; x < GW - 1; x++) {
      int i = row + x;
      int slope = (cur[i - 1] - cur[i + 1]) + (cur[i - GW] - cur[i + GW]); // 面の傾き
      int depth = cur[i];                              // 高さ（へこみ/盛り上がり）
      int r = clamp8( 12 + (slope >> 4) + (depth >> 6));
      int g = clamp8( 70 + (slope >> 3) + (depth >> 6));
      int b = clamp8(120 + (slope >> 2) + (depth >> 5));
      gridCol[i] = M5.Display.color565(r, g, b);
    }
  }
  // 縁の1pxは未計算なので、内側の色で埋めて枠のちらつきを防ぐ
  for (int x = 0; x < GW; x++) { gridCol[x] = gridCol[GW + x]; gridCol[(GH - 1) * GW + x] = gridCol[(GH - 2) * GW + x]; }
  for (int y = 0; y < GH; y++) { gridCol[y * GW] = gridCol[y * GW + 1]; gridCol[y * GW + GW - 1] = gridCol[y * GW + GW - 2]; }

  // ── 表示（160x120 を2倍に拡大してオフスクリーンへ→一括転送）──────────────
  canvas.pushImageRotateZoom(160, 120, 80, 60, 0.0f, 2.0f, 2.0f, GW, GH, gridCol);
  canvas.pushSprite(0, 0);

  // 次フレームへ: cur と prev を入れ替える
  int16_t* tmp = cur; cur = prev; prev = tmp;
}
