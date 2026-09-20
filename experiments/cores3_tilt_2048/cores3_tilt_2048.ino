// cores3_tilt_2048.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3 用 パズル「かたむき 2048」
//
//   盤を左右・上下に傾けると、その向きへタイルが滑って同じ数字が合体する。
//     - 傾ける（4方向） … タイルをスライド（1回の傾けで1手。戻すと次が撃てる）
//     - タップ          … ゲームオーバー後にリスタート
//   合体で数字が倍に。動けなくなったら GAME OVER。2048 を作れたら GAME CLEAR。
//
//   ※ 傾きの向きが合わない時は INVERT_X / INVERT_Y を切り替える。
//
// 追加センサ不要。CoreS3 内蔵の 液晶 / IMU / タッチ / スピーカー だけで動く。
// 必要ライブラリ: M5Unified（M5GFX を含む）
// -----------------------------------------------------------------------------
#include <M5Unified.h>
#include <string.h>

static constexpr int SW = 320, SH = 240;
M5Canvas canvas(&M5.Display);

// ---- 盤面レイアウト ---------------------------------------------------------
static constexpr int TILE = 48, GAP = 6;
static constexpr int BOARD = 4 * TILE + 5 * GAP;          // 222
static constexpr int BX = (SW - BOARD) / 2;               // 49
static constexpr int BY = (SH - BOARD) / 2;               // 9

int  g[4][4];
int  score = 0;
bool won = false;
enum { PLAY, OVER } state = PLAY;

// ---- 傾き操作の調整ノブ -----------------------------------------------------
// 傾きの向きが逆なら true にする（左右／上下 別々に）
static constexpr bool  INVERT_X = false;
static constexpr bool  INVERT_Y = false;
static constexpr float TH   = 0.35f;   // この傾き量で1手発火
static constexpr float FLAT = 0.18f;   // ここまで戻すと次の手が撃てる
bool armed = true;

enum { DIR_L, DIR_R, DIR_U, DIR_D };

// ---- 小物 -------------------------------------------------------------------
static inline float frnd(float a, float b) { return a + (b - a) * (rand() / (float)RAND_MAX); }
void beep(float f, int ms) { M5.Speaker.tone(f, ms); }

// タイル色（クラシック 2048 配色）。txt=文字色（濃い数字は白）
uint16_t tileColor(int v, uint16_t& txt) {
  txt = (v >= 8) ? TFT_WHITE : canvas.color565(90, 82, 74);
  switch (v) {
    case 2:    return canvas.color565(238, 228, 218);
    case 4:    return canvas.color565(237, 224, 200);
    case 8:    return canvas.color565(242, 177, 121);
    case 16:   return canvas.color565(245, 149, 99);
    case 32:   return canvas.color565(246, 124, 95);
    case 64:   return canvas.color565(246, 94, 59);
    case 128:  return canvas.color565(237, 207, 114);
    case 256:  return canvas.color565(237, 204, 97);
    case 512:  return canvas.color565(237, 200, 80);
    case 1024: return canvas.color565(237, 197, 63);
    case 2048: return canvas.color565(237, 194, 46);
    default:   return canvas.color565(237, 194, 46);      // 2048 超も金色
  }
}

void addRandom() {
  int empt[16][2], n = 0;
  for (int r = 0; r < 4; r++) for (int c = 0; c < 4; c++) if (!g[r][c]) { empt[n][0] = r; empt[n][1] = c; n++; }
  if (!n) return;
  int k = rand() % n;
  g[empt[k][0]][empt[k][1]] = (rand() % 10 == 0) ? 4 : 2;
}

void newGame() {
  memset(g, 0, sizeof(g));
  score = 0; won = false; state = PLAY;
  addRandom(); addRandom();
}

// 盤の変形（他方向を「左詰め」に帰着させる）
void transpose()   { for (int r = 0; r < 4; r++) for (int c = r + 1; c < 4; c++) { int t = g[r][c]; g[r][c] = g[c][r]; g[c][r] = t; } }
void reverseRows() { for (int r = 0; r < 4; r++) { for (int c = 0; c < 2; c++) { int t = g[r][c]; g[r][c] = g[r][3 - c]; g[r][3 - c] = t; } } }

// 全行を左へ寄せて合体（score 加算・2048 判定）。戻り値は「合体が起きたか」
bool applyLeft() {
  bool merged = false;
  for (int r = 0; r < 4; r++) {
    int tmp[4], n = 0;
    for (int c = 0; c < 4; c++) if (g[r][c]) tmp[n++] = g[r][c];
    int out[4] = {0, 0, 0, 0}, oi = 0;
    for (int i = 0; i < n; i++) {
      if (i + 1 < n && tmp[i] == tmp[i + 1]) {
        int v = tmp[i] * 2; out[oi++] = v; score += v; merged = true;
        if (v >= 2048) won = true;
        i++;
      } else out[oi++] = tmp[i];
    }
    for (int c = 0; c < 4; c++) g[r][c] = out[c];
  }
  return merged;
}

// dir 方向へ1手。動いたら true
bool move(int dir) {
  int before[4][4]; memcpy(before, g, sizeof(g));
  if      (dir == DIR_U) { transpose(); }
  else if (dir == DIR_D) { transpose(); reverseRows(); }
  else if (dir == DIR_R) { reverseRows(); }
  bool merged = applyLeft();
  if      (dir == DIR_U) { transpose(); }
  else if (dir == DIR_D) { reverseRows(); transpose(); }
  else if (dir == DIR_R) { reverseRows(); }

  bool moved = (memcmp(before, g, sizeof(g)) != 0);
  if (moved) {
    addRandom();
    beep(merged ? 520 : 300, merged ? 30 : 16);
  }
  return moved;
}

bool movesLeft() {
  for (int r = 0; r < 4; r++) for (int c = 0; c < 4; c++) {
    if (!g[r][c]) return true;
    if (c < 3 && g[r][c] == g[r][c + 1]) return true;
    if (r < 3 && g[r][c] == g[r + 1][c]) return true;
  }
  return false;
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

void handleTilt() {
  float ax, ay, az;
  M5.Imu.getAccel(&ax, &ay, &az);
  float sx = INVERT_X ? -ax : ax;
  float sy = INVERT_Y ? -ay : ay;

  if (state != PLAY) return;

  if (armed) {
    int dir = -1;
    if (fabsf(sx) > fabsf(sy)) { if (sx > TH) dir = DIR_R; else if (sx < -TH) dir = DIR_L; }
    else                       { if (sy > TH) dir = DIR_D; else if (sy < -TH) dir = DIR_U; }
    if (dir >= 0) {
      move(dir);
      armed = false;
      if (!movesLeft()) { state = OVER; beep(90, 400); }
    }
  } else if (fabsf(sx) < FLAT && fabsf(sy) < FLAT) {
    armed = true;                                        // 水平に戻したら次の手を許可
  }
}

void draw() {
  canvas.fillScreen(canvas.color565(28, 26, 24));
  canvas.fillRoundRect(BX, BY, BOARD, BOARD, 8, canvas.color565(60, 56, 50));  // 盤の下地

  for (int r = 0; r < 4; r++)
    for (int c = 0; c < 4; c++) {
      int x = BX + GAP + c * (TILE + GAP);
      int y = BY + GAP + r * (TILE + GAP);
      int v = g[r][c];
      if (!v) { canvas.fillRoundRect(x, y, TILE, TILE, 6, canvas.color565(48, 44, 40)); continue; }
      uint16_t txt; uint16_t bg = tileColor(v, txt);
      canvas.fillRoundRect(x, y, TILE, TILE, 6, bg);
      canvas.setTextColor(txt);
      canvas.setTextDatum(middle_center);
      canvas.setTextSize(v >= 100 ? 2 : 3);
      canvas.drawNumber(v, x + TILE / 2, y + TILE / 2 + 1);
      canvas.setTextSize(1);
    }

  // HUD（スコア）
  canvas.setTextDatum(top_left);
  canvas.setTextColor(TFT_WHITE);
  canvas.drawString("SCORE", 6, 4);
  canvas.drawNumber(score, 54, 4);
  if (won) { canvas.setTextColor(canvas.color565(120, 235, 150)); canvas.setTextDatum(top_right); canvas.drawString("2048!", SW - 6, 4); }

  // オーバレイ
  if (state == OVER) {
    canvas.fillRect(0, SH / 2 - 34, SW, 70, TFT_BLACK);
    canvas.setTextDatum(middle_center);
    canvas.setTextSize(3);
    canvas.setTextColor(canvas.color565(255, 90, 90));
    canvas.drawString("GAME OVER", SW / 2, SH / 2 - 6);
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
  if (t.wasPressed() && state == OVER) newGame();
  handleTilt();
  draw();
}
