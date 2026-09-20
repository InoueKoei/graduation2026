// cores3_tilt_shooter.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3 用 アクション「かたむきシューティング」
//
//   本体を左右に傾けて自機を動かし、タップ（押しっぱなしで連射）で弾を撃つ。
//     - 傾ける          … 自機が左右に動く（加速度センサ）
//     - さわる／長押し  … 弾を発射（連射）
//     - タップ          … ゲームオーバー後にリスタート
//   敵を撃つと花火のように弾けて「ドン」。敵に下まで抜けられる／ぶつかるとミス（3機）。
//   時間とともにだんだん速く・多くなる。
//
//   ※ 傾きの向きが逆なら update の ax の符号を反転、効きは gain で調整。
//
// 追加センサ不要。CoreS3 内蔵の 液晶 / IMU / タッチ / スピーカー だけで動く。
// 必要ライブラリ: M5Unified（M5GFX を含む）
// -----------------------------------------------------------------------------
#include <M5Unified.h>

static constexpr int SW = 320, SH = 240;
M5Canvas canvas(&M5.Display);

// ---- 自機 -------------------------------------------------------------------
static constexpr float SHIP_W = 26, SHIP_H = 16, SHIP_Y = SH - 22;
float shipX = SW / 2;

// ---- 弾・敵・火花 -----------------------------------------------------------
struct Bullet { float x, y; bool on; };
struct Enemy  { float x, y, vx, vy; uint8_t r, g, b; bool on; };
struct Spark  { float x, y, vx, vy; int life, life0; uint8_t r, g, b; bool on; };

static constexpr int MAX_BULLET = 24, MAX_ENEMY = 28, MAX_SPARK = 260;
Bullet bullets[MAX_BULLET];
Enemy  enemies[MAX_ENEMY];
Spark  sparks[MAX_SPARK];

const uint8_t EPAL[][3] = {
  {255, 90, 90}, {255,170, 60}, {120,235,140}, {120,180,255}, {215,120,255}, {120,240,235},
};
const int NEPAL = sizeof(EPAL) / sizeof(EPAL[0]);

// ---- 状態 -------------------------------------------------------------------
enum { PLAY, OVER } state = PLAY;
int lives = 3, score = 0;
uint32_t startMs = 0, lastSpawn = 0, lastFire = 0;

// ---- 小物 -------------------------------------------------------------------
static inline int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
static inline float frnd(float a, float b) { return a + (b - a) * (rand() / (float)RAND_MAX); }
void beep(float f, int ms) { M5.Speaker.tone(f, ms); }

void addSpark(float x, float y, uint8_t r, uint8_t g, uint8_t b) {
  for (auto& s : sparks) if (!s.on) {
    float a = frnd(0, 6.2832f), sp = frnd(0.5f, 3.2f); int life = (int)frnd(16, 34);
    bool w = (rand() % 5 == 0);
    s = { x, y, cosf(a) * sp, sinf(a) * sp, life, life, (uint8_t)(w?255:r), (uint8_t)(w?255:g), (uint8_t)(w?255:b), true };
    return;
  }
}
void explode(float x, float y, uint8_t r, uint8_t g, uint8_t b) {
  for (int i = 0; i < 16; i++) addSpark(x, y, r, g, b);
  beep(frnd(110, 170), 90);
}

void fire() {
  for (auto& b : bullets) if (!b.on) { b = { shipX, SHIP_Y - SHIP_H / 2, true }; beep(880, 12); return; }
}
void spawnEnemy(float speed) {
  for (auto& e : enemies) if (!e.on) {
    const uint8_t* p = EPAL[rand() % NEPAL];
    e = { frnd(16, SW - 16), -12, frnd(-0.5f, 0.5f), speed, p[0], p[1], p[2], true };
    return;
  }
}

void newGame() {
  lives = 3; score = 0; state = PLAY;
  for (auto& b : bullets) b.on = false;
  for (auto& e : enemies) e.on = false;
  for (auto& s : sparks)  s.on = false;
  shipX = SW / 2;
  startMs = millis(); lastSpawn = startMs; lastFire = 0;
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Imu.begin();
  M5.Speaker.begin();
  M5.Speaker.setVolume(180);

  canvas.setPsram(true);
  canvas.setColorDepth(16);
  canvas.createSprite(SW, SH);

  newGame();
}

void update() {
  // 傾き → 自機（左右）
  float ax, ay, az;
  M5.Imu.getAccel(&ax, &ay, &az);
  float target = SW / 2 - ax * 290.0f;                 // 逆なら + に、効きは 290 を調整
  shipX += (target - shipX) * 0.6f;
  shipX = clampi((int)shipX, (int)(SHIP_W / 2), (int)(SW - SHIP_W / 2));

  if (state != PLAY) return;

  float elapsed = (millis() - startMs) / 1000.0f;
  float spd = 1.0f + elapsed * 0.035f; if (spd > 3.6f) spd = 3.6f;         // だんだん速く
  uint32_t interval = (uint32_t)(1000 - elapsed * 22); if (interval < 340) interval = 340;  // だんだん多く

  // 連射（押している間）
  auto t = M5.Touch.getDetail();
  if (t.isPressed() && millis() - lastFire > 165) { fire(); lastFire = millis(); }

  // 敵スポーン
  if (millis() - lastSpawn > interval) { spawnEnemy(spd); lastSpawn = millis(); }

  // 弾
  for (auto& b : bullets) if (b.on) { b.y -= 6.5f; if (b.y < -8) b.on = false; }

  // 敵
  for (auto& e : enemies) if (e.on) {
    e.x += e.vx; e.y += e.vy;
    if (e.x < 10 || e.x > SW - 10) e.vx = -e.vx;
    // 下まで抜けた → ミス
    if (e.y > SH + 12) { e.on = false; lives--; beep(90, 200); if (lives <= 0) { state = OVER; beep(70, 400); } continue; }
    // 自機に接触 → 撃破扱い＋ミス
    if (e.y + 10 > SHIP_Y - SHIP_H / 2 && fabsf(e.x - shipX) < SHIP_W / 2 + 8) {
      explode(e.x, e.y, e.r, e.g, e.b); e.on = false; lives--; beep(90, 240);
      if (lives <= 0) { state = OVER; beep(70, 400); }
      continue;
    }
  }

  // 弾×敵の当たり
  for (auto& b : bullets) if (b.on)
    for (auto& e : enemies) if (e.on) {
      float dx = b.x - e.x, dy = b.y - e.y;
      if (dx * dx + dy * dy < (11 * 11)) {
        explode(e.x, e.y, e.r, e.g, e.b);
        e.on = false; b.on = false; score += 10;
        break;
      }
    }

  // 火花
  for (auto& s : sparks) if (s.on) {
    s.vy += 0.03f; s.x += s.vx; s.y += s.vy; s.life--;
    if (s.life <= 0) s.on = false;
  }
}

void draw() {
  canvas.fillScreen(canvas.color565(8, 10, 18));                 // 夜空

  // 火花
  for (auto& s : sparks) if (s.on) {
    float f = (float)s.life / s.life0;
    int r = s.r * f, g = s.g * f, b = s.b * f;
    canvas.fillRect((int)s.x, (int)s.y, 2, 2, canvas.color565(r, g, b));
  }

  // 弾
  for (auto& b : bullets) if (b.on)
    canvas.fillRect((int)b.x - 1, (int)b.y - 4, 3, 8, canvas.color565(255, 240, 140));

  // 敵
  for (auto& e : enemies) if (e.on) {
    canvas.fillCircle((int)e.x, (int)e.y, 10, canvas.color565(e.r, e.g, e.b));
    canvas.fillCircle((int)e.x - 3, (int)e.y - 2, 2, TFT_WHITE);
    canvas.fillCircle((int)e.x + 3, (int)e.y - 2, 2, TFT_WHITE);
  }

  // 自機（上向き三角）
  canvas.fillTriangle((int)shipX, (int)(SHIP_Y - SHIP_H / 2),
                      (int)(shipX - SHIP_W / 2), (int)(SHIP_Y + SHIP_H / 2),
                      (int)(shipX + SHIP_W / 2), (int)(SHIP_Y + SHIP_H / 2),
                      canvas.color565(120, 220, 255));

  // HUD
  canvas.setTextDatum(top_left);
  canvas.setTextColor(TFT_WHITE);
  canvas.drawString("SCORE", 6, 4);
  canvas.drawNumber(score, 54, 4);
  for (int i = 0; i < lives; i++)
    canvas.fillTriangle(SW - 10 - i * 16, 6, SW - 18 - i * 16, 16, SW - 2 - i * 16, 16, canvas.color565(120, 220, 255));

  if (state == OVER) {
    canvas.fillRect(0, SH / 2 - 34, SW, 70, TFT_BLACK);
    canvas.setTextDatum(middle_center);
    canvas.setTextSize(3);
    canvas.setTextColor(canvas.color565(255, 90, 90));
    canvas.drawString("GAME OVER", SW / 2, SH / 2 - 6);
    canvas.setTextSize(1);
    canvas.setTextColor(TFT_WHITE);
    canvas.drawString("TAP TO RETRY", SW / 2, SH / 2 + 22);
    canvas.setTextDatum(top_left);
  }

  canvas.pushSprite(0, 0);
}

void loop() {
  M5.update();
  auto t = M5.Touch.getDetail();
  if (t.wasPressed() && state == OVER) newGame();
  update();
  draw();
}
