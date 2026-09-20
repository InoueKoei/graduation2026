// cores3_tilt_breakout.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3 用 ゲーム「かたむきタイルくずし」
//
//   本体を左右に傾けてパドルを動かし、ボールでブロックを全部くずす。
//     - 傾ける      … パドルが左右に動く（加速度センサ）
//     - タップ      … ボールを発射 / ゲームオーバー・クリア後はリスタート
//   ブロックを壊す・跳ね返るたびに音が鳴る。ボールを下に落とすとミス（3機）。
//
//   ※ 描画は 320x240 のオフスクリーン(M5Canvas)に毎フレーム描いて一括転送。
//
// 追加センサ不要。CoreS3 内蔵の 液晶 / IMU / タッチ / スピーカー だけで動く。
// 必要ライブラリ: M5Unified（M5GFX を含む）
// -----------------------------------------------------------------------------
#include <M5Unified.h>

static constexpr int SW = 320, SH = 240;
M5Canvas canvas(&M5.Display);

// ---- ブロック ---------------------------------------------------------------
static constexpr int COLS = 10, ROWS = 5;
static constexpr int MARGIN = 8, GAP = 4, TOP = 28;
static constexpr int BW = (SW - 2 * MARGIN - (COLS - 1) * GAP) / COLS;  // 26
static constexpr int BH = 12;
bool alive[ROWS][COLS];
int  bricksLeft = 0;

const uint8_t PAL[ROWS][3] = {
  {255, 90, 90}, {255,180, 40}, {255,240,120}, {110,235,140}, {110,180,255},
};

// ---- パドル / ボール --------------------------------------------------------
static constexpr float PW = 54, PH = 7;
static constexpr float PADDLE_Y = 224;
float paddleCX = SW / 2;

static constexpr float BALL_R = 4;
float bx, by, bvx, bvy;
float speed = 3.2f;

// ---- 状態 -------------------------------------------------------------------
enum { READY, PLAY, OVER, WIN } state = READY;
int lives = 3;
int score = 0;

// ---- 小物 -------------------------------------------------------------------
static inline int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
static inline float frnd(float a, float b) { return a + (b - a) * (rand() / (float)RAND_MAX); }
void beep(float freq, int ms) { M5.Speaker.tone(freq, ms); }

void resetBricks() {
  bricksLeft = 0;
  for (int r = 0; r < ROWS; r++)
    for (int c = 0; c < COLS; c++) { alive[r][c] = true; bricksLeft++; }
}
void ballOnPaddle() { bx = paddleCX; by = PADDLE_Y - BALL_R - 1; bvx = 0; bvy = 0; }

void newGame() {
  lives = 3; score = 0; speed = 3.2f;
  resetBricks(); ballOnPaddle(); state = READY;
}
void launchBall() {
  float ang = frnd(-2.2f, -0.95f);          // 上向き（-π/2 付近）
  bvx = cosf(ang) * speed; bvy = sinf(ang) * speed;
  state = PLAY;
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Imu.begin();
  M5.Speaker.begin();
  M5.Speaker.setVolume(200);

  canvas.setPsram(true);
  canvas.setColorDepth(16);
  canvas.createSprite(SW, SH);
  canvas.setTextColor(TFT_WHITE);
  canvas.setTextDatum(top_left);

  newGame();
}

void update() {
  // 傾き → パドル位置（加速度の左右成分。逆なら ax の符号を反転、効きは gain で調整）
  float ax, ay, az;
  M5.Imu.getAccel(&ax, &ay, &az);
  float gain = 290.0f;                    // 感度（手に馴染む値で確定）
  float target = SW / 2 - ax * gain;      // 傾きの向きを反転
  paddleCX += (target - paddleCX) * 0.6f;                 // 少しだけ滑らかに
  paddleCX = clampi((int)paddleCX, (int)(PW / 2), (int)(SW - PW / 2));

  if (state == READY) { ballOnPaddle(); return; }
  if (state != PLAY) return;

  bx += bvx; by += bvy;

  // 壁
  if (bx < BALL_R)        { bx = BALL_R;        bvx = -bvx; beep(320, 18); }
  if (bx > SW - BALL_R)   { bx = SW - BALL_R;   bvx = -bvx; beep(320, 18); }
  if (by < BALL_R)        { by = BALL_R;        bvy = -bvy; beep(320, 18); }

  // 下に落ちた → ミス
  if (by > SH + BALL_R) {
    lives--;
    beep(90, 220);
    if (lives <= 0) { state = OVER; beep(70, 400); }
    else { ballOnPaddle(); state = READY; }
    return;
  }

  // パドル
  if (bvy > 0 && by + BALL_R >= PADDLE_Y && by < PADDLE_Y + PH &&
      bx >= paddleCX - PW / 2 - BALL_R && bx <= paddleCX + PW / 2 + BALL_R) {
    by = PADDLE_Y - BALL_R - 1;
    float off = (bx - paddleCX) / (PW / 2);               // -1..1: 当たった位置で角度を変える
    float ang = -1.5708f + off * 1.05f;                   // 上向きから左右へ
    bvx = cosf(ang) * speed; bvy = sinf(ang) * speed;
    if (bvy > -0.6f) bvy = -0.6f * speed;                 // ほぼ水平になり過ぎない保険
    beep(240, 20);
  }

  // ブロック（1フレーム1個まで）
  for (int r = 0; r < ROWS && state == PLAY; r++)
    for (int c = 0; c < COLS; c++) {
      if (!alive[r][c]) continue;
      int rx = MARGIN + c * (BW + GAP);
      int ry = TOP + r * (BH + GAP);
      if (bx + BALL_R > rx && bx - BALL_R < rx + BW &&
          by + BALL_R > ry && by - BALL_R < ry + BH) {
        alive[r][c] = false; bricksLeft--; score += (ROWS - r) * 10;
        if (bx > rx && bx < rx + BW) bvy = -bvy; else bvx = -bvx;   // 上下面 or 側面
        speed *= 1.012f;                                            // 少しずつ速く
        float m = sqrtf(bvx * bvx + bvy * bvy);                     // 向きは保ったまま速さだけ更新
        if (m > 0.001f) { bvx = bvx / m * speed; bvy = bvy / m * speed; }
        beep(500 + (ROWS - r) * 90, 22);                            // 上の段ほど高い音
        if (bricksLeft <= 0) { state = WIN; beep(700,90); beep(900,90); beep(1200,140); }
        r = ROWS; break;                                            // 1個で抜ける
      }
    }
}

void draw() {
  canvas.fillScreen(TFT_BLACK);

  // ブロック
  for (int r = 0; r < ROWS; r++)
    for (int c = 0; c < COLS; c++) {
      if (!alive[r][c]) continue;
      int rx = MARGIN + c * (BW + GAP);
      int ry = TOP + r * (BH + GAP);
      canvas.fillRect(rx, ry, BW, BH, canvas.color565(PAL[r][0], PAL[r][1], PAL[r][2]));
    }

  // パドル・ボール
  canvas.fillRoundRect((int)(paddleCX - PW / 2), (int)PADDLE_Y, (int)PW, (int)PH, 3, TFT_WHITE);
  canvas.fillCircle((int)bx, (int)by, (int)BALL_R, TFT_WHITE);

  // HUD（スコア・残機）
  canvas.setTextColor(TFT_WHITE);
  canvas.drawString("SCORE", 6, 4);
  canvas.drawNumber(score, 54, 4);
  for (int i = 0; i < lives; i++)
    canvas.fillCircle(SW - 12 - i * 14, 9, 4, canvas.color565(120, 200, 255));

  // 案内
  canvas.setTextDatum(middle_center);
  if (state == READY) canvas.drawString("TILT TO AIM  -  TAP TO LAUNCH", SW / 2, SH / 2 + 34);
  if (state == OVER || state == WIN) {
    canvas.fillRect(0, SH / 2 - 34, SW, 70, TFT_BLACK);            // 読みやすいよう黒帯
    canvas.setTextSize(3);
    canvas.setTextColor(state == WIN ? canvas.color565(120, 235, 150) : canvas.color565(255, 90, 90));
    canvas.drawString(state == WIN ? "GAME CLEAR" : "GAME OVER", SW / 2, SH / 2 - 6);
    canvas.setTextSize(1);
    canvas.setTextColor(TFT_WHITE);
    canvas.drawString("TAP TO RETRY", SW / 2, SH / 2 + 22);
  }
  canvas.setTextDatum(top_left);

  canvas.pushSprite(0, 0);
}

void loop() {
  M5.update();
  auto t = M5.Touch.getDetail();
  if (t.wasPressed()) {
    if      (state == READY)              launchBall();
    else if (state == OVER || state == WIN) newGame();
  }
  update();
  draw();
}
