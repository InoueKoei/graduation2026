// cores3_typography_demo.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3 / CoreS3 SE 用 タイポグラフィ・デモ「文字を積もらせる」
//
//   - 画面をタップ  … その場所に文字が生まれて降る
//   - 本体を傾ける  … IMU の加速度を重力にして文字が流れる
//   - 本体を振る    … 溜まった文字が一気に散る
//   - 文字どうしは衝突して積もっていく（+ 効果音）
//
// 追加センサ不要。CoreS3 内蔵の 液晶 / タッチ / IMU / スピーカー だけで動く。
// 必要ライブラリ: M5Unified（ライブラリマネージャからインストール、M5GFX を含む）
// -----------------------------------------------------------------------------
#include <M5Unified.h>

// ---- 調整パラメータ ---------------------------------------------------------
static constexpr int   MAX_P     = 48;    // 画面に出せる文字の最大数
static constexpr float R         = 13.0f; // 文字の当たり判定の半径(px)
static constexpr float G         = 0.60f; // 重力の強さ
static constexpr float DAMP      = 0.99f; // 空気抵抗（1に近いほど滑る）
static constexpr float REST_WALL = 0.30f; // 壁に当たったときの反発
static constexpr float VMAX      = 12.0f; // 速度の上限（暴走防止）

// 積もらせる文字。フォント(efont)が対応していれば漢字・記号もOK
const char* KANA[] = {
  "あ","い","う","え","お","か","き","く","文","字",
  "積","も","る","ん","を","、","。","ア","イ","ウ"
};
const int KANA_N = sizeof(KANA) / sizeof(KANA[0]);

// ---- 1文字ぶんの状態 --------------------------------------------------------
struct Glyph {
  float x, y, vx, vy;
  const char* ch;
  uint16_t color;
};

Glyph      g[MAX_P];
int        count = 0;
M5Canvas   canvas(&M5.Display);   // ちらつき防止のオフスクリーン描画用
int        W, H;
uint16_t   PAPER, INK, VERMILION;
uint32_t   startMs;

// 文字を1つ生む。満杯なら一番古いものを押し出す
void spawn(float x, float y) {
  if (count >= MAX_P) {
    for (int i = 1; i < count; i++) g[i - 1] = g[i];
    count--;
  }
  Glyph& p = g[count++];
  p.x  = x;
  p.y  = y;
  p.vx = random(-100, 100) / 100.0f;
  p.vy = random(0, 80) / 100.0f;
  p.ch = KANA[random(KANA_N)];
  // 2割くらいを朱色に（版画の落款のようなアクセント）
  p.color = (random(100) < 18) ? VERMILION : INK;
  M5.Speaker.tone(720 + random(240), 55);
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);         // 横向き 320x240
  W = M5.Display.width();
  H = M5.Display.height();

  // 紙に墨、のような配色
  PAPER     = M5.Display.color565(244, 240, 228);
  INK       = M5.Display.color565( 32,  30,  28);
  VERMILION = M5.Display.color565(200,  58,  42);

  // フルスクリーンのスプライトを確保（PSRAM 前提。ダメなら8bitで再挑戦）
  canvas.setColorDepth(16);
  if (!canvas.createSprite(W, H)) {
    canvas.setColorDepth(8);
    canvas.createSprite(W, H);
  }
  canvas.setFont(&fonts::lgfxJapanGothic_24);
  canvas.setTextDatum(middle_center);

  randomSeed(micros());
  for (int i = 0; i < 12; i++) spawn(random((int)R, W - (int)R), random((int)R, H / 2));
  startMs = millis();
}

void loop() {
  M5.update();

  // --- 入力: タップで文字を追加 ---
  auto t = M5.Touch.getDetail();
  if (t.wasPressed()) spawn(t.x, t.y);

  // --- IMU: 傾きを重力に変換 ---
  float ax = 0, ay = 0, az = 0;
  M5.Imu.getAccel(&ax, &ay, &az);   // 単位は g。IMU 非搭載なら 0 のまま
  // 画面座標は「右が +x / 下が +y」。流れる向きが逆なら符号を入れ替える
  float gx =  ax * G;
  float gy =  ay * G;

  // --- 振ったら一気に散らす ---
  float mag = sqrtf(ax * ax + ay * ay + az * az);
  if (mag > 2.2f) {
    for (int i = 0; i < count; i++) {
      g[i].vx += random(-200, 200) / 100.0f;
      g[i].vy += random(-200, 200) / 100.0f;
    }
    M5.Speaker.tone(320, 90);
  }

  // --- 物理更新（重力・減衰・壁）---
  for (int i = 0; i < count; i++) {
    Glyph& p = g[i];
    p.vx = (p.vx + gx) * DAMP;
    p.vy = (p.vy + gy) * DAMP;
    p.vx = constrain(p.vx, -VMAX, VMAX);
    p.vy = constrain(p.vy, -VMAX, VMAX);
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < R)     { p.x = R;     p.vx *= -REST_WALL; }
    if (p.x > W - R) { p.x = W - R; p.vx *= -REST_WALL; }
    if (p.y < R)     { p.y = R;     p.vy *= -REST_WALL; }
    if (p.y > H - R) { p.y = H - R; p.vy *= -REST_WALL; }
  }

  // --- 文字どうしの衝突＝「積もり」---
  const float minD = 2 * R;
  for (int i = 0; i < count; i++) {
    for (int j = i + 1; j < count; j++) {
      float dx = g[j].x - g[i].x;
      float dy = g[j].y - g[i].y;
      float d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < minD * minD) {
        float d  = sqrtf(d2);
        float nx = dx / d, ny = dy / d;
        float overlap = (minD - d) * 0.5f;
        g[i].x -= nx * overlap; g[i].y -= ny * overlap;
        g[j].x += nx * overlap; g[j].y += ny * overlap;
        float relv = (g[j].vx - g[i].vx) * nx + (g[j].vy - g[i].vy) * ny;
        if (relv < 0) {
          float imp = relv * 0.5f;   // 反発係数
          g[i].vx += imp * nx; g[i].vy += imp * ny;
          g[j].vx -= imp * nx; g[j].vy -= imp * ny;
        }
      }
    }
  }

  // --- 描画 ---
  canvas.fillScreen(PAPER);
  for (int i = 0; i < count; i++) {
    canvas.setTextColor(g[i].color);
    canvas.drawString(g[i].ch, (int)g[i].x, (int)g[i].y);
  }
  // 起動直後の数秒だけ操作ヒントを出す
  if (millis() - startMs < 4000) {
    canvas.setFont(&fonts::lgfxJapanGothic_16);
    canvas.setTextDatum(bottom_center);
    canvas.setTextColor(INK);
    canvas.drawString("タップで追加 / 傾けて流す / 振って散らす", W / 2, H - 6);
    canvas.setFont(&fonts::lgfxJapanGothic_24);
    canvas.setTextDatum(middle_center);
  }
  canvas.pushSprite(0, 0);
}
