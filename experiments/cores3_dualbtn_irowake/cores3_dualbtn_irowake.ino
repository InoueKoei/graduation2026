// cores3_dualbtn_irowake.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3-Lite × Unit Dual Button 用 ふりわけゲーム「いろわけ」
//
//   まん中の筒をボールが落ちてくる。いちばん下のボール（白い輪）の色のボタンを押すと、
//   その色の箱へ飛んでいって「ドン」。
//     - 赤ボタン   … 赤いボールを 赤の箱へ
//     - 青ボタン   … 青いボールを 青の箱へ
//     - 両方同時   … 赤青まだらのボール（スコア PURPLE_FROM から登場）を 弾けさせる
//   色ちがいを押す／ゲート（筒の下の線）まで落とすとミス。3回でおわり。
//   入れるほど だんだん速く・つまってくる。
//   タイトルでボタンを長押し → 設定（音量 0〜10：赤＝ちいさく／青＝おおきく、長押しで保存して戻る）
//
// 接続: Unit Dual Button を PORT.A へ（CoreS3-Lite は PORT.B/C が無いので PORT.A を GPIO として使う）
//   PORT.A … 黄 = G2 = 赤ボタン / 白 = G1 = 青ボタン（押すと LOW）
//   ※ ユニット内で 5V を 10k/20k で分圧しているので、離したときは約 3.3V（直結で安全）
//   ※ 赤と青が逆なら PIN_RED / PIN_BLUE を入れ替え、箱の左右は SWAP_SIDES で。
//   ユニットが無くても、画面の左半分＝左の箱の色・右半分＝右の箱の色 のタッチで遊べる。
//
// 必要ライブラリ: M5Unified / M5GFX（CoreS3-Lite の新液晶 ILI9342E は M5GFX 0.2.27 以上）
// -----------------------------------------------------------------------------
#include <M5Unified.h>
#include <Preferences.h>

// ---- 調整ノブ ---------------------------------------------------------------
static constexpr int      PIN_RED     = 2;      // PORT.A 黄
static constexpr int      PIN_BLUE    = 1;      // PORT.A 白
static constexpr bool     SWAP_SIDES  = false;  // true で 赤の箱＝右 / 青の箱＝左
static constexpr uint32_t CHORD_MS    = 130;    // これ以内のずれなら「同時押し」
static constexpr int      PURPLE_FROM = 20;     // まだらボールが出はじめるスコア
static constexpr uint32_t LONG_MS     = 700;    // 長押し（タイトル→設定／設定→もどる）
static constexpr int      VOL_DEFAULT = 7;      // 音量 0〜10（初期値）

static constexpr int SW = 320, SH = 240;
M5Canvas canvas(&M5.Display);
Preferences prefs;

// ※ 型は最初の関数より前に置く（Arduino の自動プロトタイプが型より先に入るため）
struct Ball  { float y; uint8_t c; bool on; };
struct Fly   { float x0, y0, x1, y1, t; uint8_t c, to, kind; bool on; };   // kind: 0=正解 1=まちがい 2=落下
struct Spark { float x, y, vx, vy, life, life0; uint8_t r, g, b; bool on; };
struct Key { int pin; bool held; uint32_t tChange; };

// ---- 色（ボタンのビットと同じ並び：赤=1 青=2 両方=3）--------------------------
enum : uint8_t { C_RED = 1, C_BLUE = 2, C_BOTH = 3, C_GREY = 4 };
const uint8_t RGB_RED[3]  = {255,  80,  80};
const uint8_t RGB_BLUE[3] = { 70, 150, 255};
const uint8_t RGB_GREY[3] = {110, 110, 120};
const uint8_t* rgbOf(uint8_t c) { return c == C_RED ? RGB_RED : (c == C_BLUE ? RGB_BLUE : RGB_GREY); }

// ---- 盤面 -------------------------------------------------------------------
static constexpr int TUBE_X = SW / 2, TUBE_HW = 19, GATE_Y = 168;
static constexpr int BALL_R = 13;
static constexpr int BIN_W = 96, BIN_TOP = 196, BIN_BOTTOM = 236;
int binX(uint8_t c) { bool left = (c == C_RED) != SWAP_SIDES; return left ? 64 : SW - 64; }


static constexpr int MAX_BALL = 16, MAX_FLY = 12, MAX_SPARK = 260;
Ball  balls[MAX_BALL];
Fly   flies[MAX_FLY];
Spark sparks[MAX_SPARK];

// ---- 状態 -------------------------------------------------------------------
enum { TITLE, CONFIG, PLAY, OVER } state = TITLE;
int volLevel = VOL_DEFAULT;
int score = 0, lives = 3, combo = 0, best = 0;
bool newBest = false;
int binCount[3];
float binPulse[3], spawnAcc = 0, flash = 0;
uint32_t overMs = 0, bothHeldSince = 0;
uint8_t pendMask = 0; uint32_t pendMs = 0;   // 同時押しの待ち合わせ

// ---- 小物 -------------------------------------------------------------------
static inline float frnd(float a, float b) { return a + (b - a) * (rand() / (float)RAND_MAX); }
void don()  { M5.Speaker.tone(frnd(110, 170), 90, 0); }                 // 花火の「ドン」
void buzz() { M5.Speaker.tone(90, 220, 0); }
void note(int n) {                                                     // コンボで音が上がる
  static const float SCALE[] = {523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760};
  M5.Speaker.tone(SCALE[n < 9 ? n : 9], 45, 1);
}

void addSpark(float x, float y, const uint8_t* rgb, float spMax) {
  for (auto& s : sparks) if (!s.on) {
    float a = frnd(0, 6.2832f), sp = frnd(0.5f, spMax), life = frnd(16, 34);
    bool w = (rand() % 5 == 0);
    s = { x, y, cosf(a) * sp, sinf(a) * sp - 1.0f, life, life,
          (uint8_t)(w ? 255 : rgb[0]), (uint8_t)(w ? 255 : rgb[1]), (uint8_t)(w ? 255 : rgb[2]), true };
    return;
  }
}

// ---- 入力 -------------------------------------------------------------------
// 押した瞬間にすぐ反応し、そのあと 25ms は ばたつきを無視する
Key kRed{PIN_RED, false, 0}, kBlue{PIN_BLUE, false, 0};
bool keyPressed(Key& k, uint32_t now) {
  bool raw = digitalRead(k.pin) == LOW;
  if (raw != k.held && now - k.tChange >= 25) { k.held = raw; k.tChange = now; return raw; }
  return false;
}

// タッチ代用：左半分＝左の箱の色、右半分＝右の箱の色（2本指で同時押し）
uint8_t touchInput(uint8_t& heldMask) {
  uint8_t leftC = binX(C_RED) < SW / 2 ? C_RED : C_BLUE, edges = 0;
  for (int i = 0, n = M5.Touch.getCount(); i < n; i++) {
    auto d = M5.Touch.getDetail(i);
    uint8_t c = d.x < SW / 2 ? leftC : (C_BOTH ^ leftC);
    if (d.isPressed())  heldMask |= c;
    if (d.wasPressed()) edges |= c;
  }
  return edges;
}

// ---- ゲーム -----------------------------------------------------------------
Ball* target() {
  Ball* t = nullptr;
  for (auto& b : balls) if (b.on && (!t || b.y > t->y)) t = &b;
  return t;
}

void launch(float y, uint8_t c, uint8_t to, uint8_t kind) {
  for (auto& f : flies) if (!f.on) {
    float x1 = kind == 2 ? TUBE_X : binX(to), y1 = kind == 2 ? SH + BALL_R * 2 : BIN_TOP + 12;
    f = { (float)TUBE_X, y, x1, y1, 0, c, to, kind, true };
    return;
  }
}

void gameOver() {
  state = OVER; overMs = millis(); pendMask = 0;
  newBest = score > best;
  if (newBest) { best = score; prefs.putUInt("best", best); }
}

void miss() {
  lives--; combo = 0; flash = 1; buzz();
  if (lives <= 0) gameOver();
}

void judge(uint8_t mask) {
  Ball* t = target();
  if (!t) return;
  if (t->c == mask) {
    note(combo++);
    if (mask == C_BOTH) {                                   // まだら：その場で大きく弾ける
      for (int i = 0; i < 36; i++) addSpark(TUBE_X, t->y, i & 1 ? RGB_RED : RGB_BLUE, 3.8f);
      M5.Speaker.tone(frnd(80, 100), 140, 0);
      score += 3;
    } else {
      launch(t->y, t->c, mask, 0);
      score += 1;
    }
  } else {
    // まちがい：押した色の箱へ飛んでいって煙になる（両方押しなら そのまま落ちる）
    launch(t->y, t->c, mask, mask == C_BOTH ? 2 : 1);
    miss();
  }
  t->on = false;
}

void spawn() {
  for (auto& b : balls) if (!b.on) {
    uint8_t c = (score >= PURPLE_FROM && rand() % 100 < 14) ? C_BOTH : (rand() & 1 ? C_RED : C_BLUE);
    b = { (float)-BALL_R, c, true };
    return;
  }
}

void newGame() {
  for (auto& b : balls)  b.on = false;
  for (auto& f : flies)  f.on = false;
  for (auto& s : sparks) s.on = false;
  for (int i = 0; i < 3; i++) { binCount[i] = 0; binPulse[i] = 0; }
  score = 0; lives = 3; combo = 0; flash = 0; pendMask = 0;
  spawnAcc = 1e6f;                                          // 最初の1個はすぐ出す
  state = PLAY;
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Speaker.begin();

  pinMode(PIN_RED,  INPUT_PULLUP);   // ユニットが無いときは「離している」扱いになる
  pinMode(PIN_BLUE, INPUT_PULLUP);

  prefs.begin("irowake", false);
  best = prefs.getUInt("best", 0);
  volLevel = prefs.getUInt("vol", VOL_DEFAULT);
  M5.Speaker.setVolume(volLevel * 25);

  canvas.setPsram(true);
  canvas.setColorDepth(16);
  canvas.createSprite(SW, SH);
}

void updatePlay(float dt, uint8_t edges, uint32_t now) {
  // 同時押しの待ち合わせ：まだらが相手のときだけ、片方を CHORD_MS 待つ
  if (pendMask) {
    if (edges & ~pendMask)              { judge(pendMask | edges); pendMask = 0; }
    else if (now - pendMs > CHORD_MS)   { judge(pendMask); pendMask = 0; }
    edges = 0;
  }
  if (edges) {
    Ball* t = target();
    if (edges != C_BOTH && t && t->c == C_BOTH) { pendMask = edges; pendMs = now; }
    else judge(edges);
  }
  if (state != PLAY) return;

  // だんだん速く・つまってくる
  float v   = fminf(3.6f, 1.0f + score * 0.025f);
  float gap = fmaxf(22.0f, 64.0f - score * 0.7f);
  spawnAcc += v * dt;
  if (spawnAcc >= BALL_R * 2 + gap) { spawnAcc = spawnAcc > 1e5f ? 0 : spawnAcc - (BALL_R * 2 + gap); spawn(); }

  for (auto& b : balls) if (b.on) {
    b.y += v * dt;
    if (b.y >= GATE_Y) {                                    // ゲートまで落ちた
      launch(b.y, C_GREY, 0, 2);
      b.on = false; pendMask = 0;
      miss();
      if (state != PLAY) return;
    }
  }
}

void updateFx(float dt) {
  for (auto& f : flies) if (f.on) {
    f.t += dt / (f.kind == 2 ? 22.0f : 16.0f);
    if (f.t < 1) continue;
    f.on = false;
    if (f.kind == 0) {
      for (int i = 0; i < 18; i++) addSpark(f.x1, f.y1, rgbOf(f.c), 3.0f);
      binCount[f.c]++; binPulse[f.c] = 1;
      don();
    } else if (f.kind == 1) {
      for (int i = 0; i < 12; i++) addSpark(f.x1, f.y1, RGB_GREY, 1.6f);
    }
  }
  for (auto& s : sparks) if (s.on) {
    s.vy += 0.05f * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
    if (s.life <= 0) s.on = false;
  }
  for (int i = 0; i < 3; i++) binPulse[i] = fmaxf(0, binPulse[i] - 0.08f * dt);
  flash = fmaxf(0, flash - 0.06f * dt);
}

// ---- 描画 -------------------------------------------------------------------
uint16_t col(const uint8_t* rgb, float k = 1) { return canvas.color565(rgb[0] * k, rgb[1] * k, rgb[2] * k); }

void drawBall(int x, int y, uint8_t c, int r = BALL_R) {
  if (c == C_BOTH) {                                         // 左半分＝赤・右半分＝青
    canvas.fillCircle(x, y, r, col(RGB_RED));
    canvas.setClipRect(x, y - r, r + 1, r * 2 + 1);
    canvas.fillCircle(x, y, r, col(RGB_BLUE));
    canvas.clearClipRect();
  } else {
    canvas.fillCircle(x, y, r, col(rgbOf(c)));
  }
  canvas.fillCircle(x - r / 3, y - r / 3, r / 4 + 1, canvas.color565(255, 255, 255));
}

void drawBin(uint8_t c) {
  int x = binX(c), p = (int)(binPulse[c] * 5);
  canvas.fillRoundRect(x - BIN_W / 2 - p, BIN_TOP - p, BIN_W + p * 2, BIN_BOTTOM - BIN_TOP + p, 8, col(rgbOf(c), 0.18f + binPulse[c] * 0.3f));
  canvas.drawRoundRect(x - BIN_W / 2 - p, BIN_TOP - p, BIN_W + p * 2, BIN_BOTTOM - BIN_TOP + p, 8, col(rgbOf(c)));
  canvas.setFont(&fonts::Font4);
  canvas.setTextDatum(middle_center);
  canvas.setTextColor(col(rgbOf(c)));
  canvas.drawNumber(binCount[c], x, (BIN_TOP + BIN_BOTTOM) / 2 + 1);
}

void drawPlay(uint32_t now) {
  canvas.fillScreen(canvas.color565(8 + 90 * flash, 10, 18));

  // 筒とゲート
  Ball* t = target();
  bool near = t && t->y > GATE_Y - 46;
  canvas.fillRoundRect(TUBE_X - TUBE_HW, -20, TUBE_HW * 2, GATE_Y + BALL_R + 22, 10, canvas.color565(18, 24, 40));
  canvas.drawRoundRect(TUBE_X - TUBE_HW, -20, TUBE_HW * 2, GATE_Y + BALL_R + 22, 10, canvas.color565(60, 72, 104));
  uint16_t gateCol = near && (now / 120) % 2 ? canvas.color565(255, 200, 60) : canvas.color565(120, 100, 60);
  canvas.fillRect(TUBE_X - TUBE_HW - 8, GATE_Y + BALL_R + 1, TUBE_HW * 2 + 16, 3, gateCol);

  drawBin(C_RED);
  drawBin(C_BLUE);

  // ボール
  for (auto& b : balls) if (b.on) drawBall(TUBE_X, (int)b.y, b.c);
  if (t) {
    canvas.drawCircle(TUBE_X, (int)t->y, BALL_R + 3, TFT_WHITE);
    if (t->c == C_BOTH) {
      canvas.setFont(&fonts::lgfxJapanGothicP_16);
      canvas.setTextDatum(middle_left);
      canvas.setTextColor(TFT_WHITE);
      canvas.drawString("りょうほう！", TUBE_X + TUBE_HW + 8, (int)t->y);
    }
  }

  // 飛んでいくボール（正解・まちがいは弧を描いて箱へ、落下はまっすぐ下へ）
  for (auto& f : flies) if (f.on) {
    float x = f.x0 + (f.x1 - f.x0) * f.t;
    float y = f.y0 + (f.y1 - f.y0) * f.t - (f.kind == 2 ? 0 : 48 * sinf(f.t * 3.1416f));
    drawBall((int)x, (int)y, f.kind == 2 ? (uint8_t)C_GREY : f.c, BALL_R - (int)(f.t * 3));
  }

  // 火花
  for (auto& s : sparks) if (s.on) {
    float k = s.life / s.life0;
    canvas.fillRect((int)s.x, (int)s.y, 2, 2, canvas.color565(s.r * k, s.g * k, s.b * k));
  }

  // HUD
  canvas.setFont(&fonts::Font2);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(TFT_WHITE);
  canvas.drawString("SCORE", 6, 4);
  canvas.drawNumber(score, 56, 4);
  for (int i = 0; i < lives; i++) canvas.fillCircle(SW - 12 - i * 18, 12, 6, TFT_WHITE);
  if (combo >= 3) {
    canvas.setTextDatum(top_right);
    canvas.setTextColor(canvas.color565(255, 220, 120));
    canvas.drawString(String("COMBO ") + combo, SW - 6, 24);
  }

  if (state == OVER) {
    canvas.fillRect(0, SH / 2 - 52, SW, 100, TFT_BLACK);
    canvas.setTextDatum(middle_center);
    canvas.setFont(&fonts::Font4);
    canvas.setTextColor(canvas.color565(255, 90, 90));
    canvas.drawString("GAME OVER", SW / 2, SH / 2 - 30);
    canvas.setFont(&fonts::Font2);
    canvas.setTextColor(TFT_WHITE);
    canvas.drawString(String("SCORE ") + score + "    BEST " + best, SW / 2, SH / 2 - 2);
    if (newBest) {
      canvas.setTextColor(canvas.color565(255, 220, 120));
      canvas.drawString("NEW RECORD!", SW / 2, SH / 2 + 16);
    }
    if (now - overMs > 800) {
      canvas.setFont(&fonts::lgfxJapanGothicP_16);
      canvas.setTextColor(canvas.color565(180, 180, 190));
      canvas.drawString("ボタンで もういちど", SW / 2, SH / 2 + 36);
    }
  }
}

void drawTitle(uint32_t now, uint8_t heldMask) {
  canvas.fillScreen(canvas.color565(8, 10, 18));

  // タイトル：一字ずつ 赤・青 交互に
  const char* title[] = {"い", "ろ", "わ", "け"};
  canvas.setFont(&fonts::lgfxJapanGothicP_32);
  canvas.setTextDatum(middle_left);
  int w = 0;
  for (auto s : title) w += canvas.textWidth(s) + 6;
  int x = (SW - w + 6) / 2;
  for (int i = 0; i < 4; i++) {
    canvas.setTextColor(col(i & 1 ? RGB_BLUE : RGB_RED));
    canvas.drawString(title[i], x, 52);
    x += canvas.textWidth(title[i]) + 6;
  }

  canvas.setFont(&fonts::lgfxJapanGothicP_16);
  canvas.setTextDatum(middle_center);
  canvas.setTextColor(canvas.color565(200, 200, 210));
  canvas.drawString("おちてくる いろと おなじボタンを おそう", SW / 2, 96);
  canvas.drawString("まだらは りょうほう いっしょに", SW / 2, 116);

  // ボタンの状態（押すと光る）＝配線の確認にも使える
  for (uint8_t c : {C_RED, C_BLUE}) {
    int bx = binX(c) < SW / 2 ? SW / 2 - 52 : SW / 2 + 52;
    if (heldMask & c) canvas.fillCircle(bx, 160, 20, col(rgbOf(c)));
    else              canvas.drawCircle(bx, 160, 20, col(rgbOf(c)));
  }

  bool stuck = bothHeldSince && now - bothHeldSince > 1500;
  canvas.setTextColor(stuck ? canvas.color565(255, 200, 60) : canvas.color565(255, 255, 255));
  if (stuck) canvas.drawString("押しっぱなし？ PORT.A の配線を確認", SW / 2, 206);
  else if ((now / 500) % 2) canvas.drawString("ボタンを おして スタート", SW / 2, 206);

  canvas.setFont(&fonts::Font2);
  canvas.setTextColor(canvas.color565(130, 130, 145));
  canvas.setTextDatum(middle_left);
  canvas.drawString(String("BEST ") + best, 8, 228);
  canvas.setFont(&fonts::lgfxJapanGothicP_16);
  canvas.setTextDatum(middle_right);
  canvas.drawString("ながおしで せってい", SW - 8, 228);
}

void drawConfig(uint8_t heldMask) {
  canvas.fillScreen(canvas.color565(8, 10, 18));
  canvas.setFont(&fonts::lgfxJapanGothicP_24);
  canvas.setTextDatum(middle_center);
  canvas.setTextColor(TFT_WHITE);
  canvas.drawString("せってい", SW / 2, 30);

  canvas.setFont(&fonts::lgfxJapanGothicP_16);
  canvas.setTextColor(canvas.color565(200, 200, 210));
  canvas.drawString(volLevel ? "おんりょう" : "おんりょう（けしてある）", SW / 2, 74);

  // 10コマのバー
  for (int i = 0; i < 10; i++) {
    int x = SW / 2 - 125 + i * 25, h = 10 + i * 3, y = 130 - h;
    if (i < volLevel) canvas.fillRect(x, y, 20, h, canvas.color565(255, 220, 120));
    else              canvas.drawRect(x, y, 20, h, canvas.color565(70, 74, 96));
  }
  canvas.setFont(&fonts::Font4);
  canvas.setTextColor(TFT_WHITE);
  canvas.drawNumber(volLevel, SW / 2, 152);

  // 赤＝ちいさく・青＝おおきく（箱と同じ側に出す）
  canvas.setFont(&fonts::lgfxJapanGothicP_16);
  for (uint8_t c : {C_RED, C_BLUE}) {
    int bx = binX(c) < SW / 2 ? 50 : SW - 50;
    if (heldMask & c) canvas.fillCircle(bx, 140, 18, col(rgbOf(c)));
    else              canvas.drawCircle(bx, 140, 18, col(rgbOf(c)));
    canvas.setTextColor(col(rgbOf(c)));
    canvas.drawString(c == C_RED ? "ちいさく" : "おおきく", bx, 176);
  }

  canvas.setTextColor(canvas.color565(130, 130, 145));
  canvas.drawString("ながおしで ほぞんして もどる", SW / 2, 220);
}

void loop() {
  M5.update();
  uint32_t now = millis();
  static uint32_t last = now;
  float dt = fminf(3.0f, (now - last) / 16.667f);   // 60fps 換算のコマ数
  last = now;

  uint8_t edges = 0, held = 0;
  if (keyPressed(kRed,  now)) edges |= C_RED;
  if (keyPressed(kBlue, now)) edges |= C_BLUE;
  if (kRed.held)  held |= C_RED;
  if (kBlue.held) held |= C_BLUE;
  edges |= touchInput(held);
  bothHeldSince = (kRed.held && kBlue.held) ? (bothHeldSince ? bothHeldSince : now) : 0;

  // タイトルと設定用：離したときの「タップ」と、押し続けの「長押し」を分ける
  static uint8_t gMask = 0; static uint32_t gSince = 0; static bool gLong = false;
  uint8_t tap = 0, hold = 0;
  if (held) {
    if (!gMask) { gSince = now; gLong = false; }
    gMask |= held;
    if (!gLong && now - gSince >= LONG_MS) { gLong = true; hold = gMask; }
  } else if (gMask) {
    if (!gLong) tap = gMask;
    gMask = 0;
  }

  switch (state) {
    case TITLE:
      if (hold && hold != C_BOTH) state = CONFIG;     // 両方の押しっぱなしは配線の警告に回す
      else if (tap) newGame();
      drawTitle(now, held);
      break;
    case CONFIG:
      if (hold) { prefs.putUInt("vol", volLevel); state = TITLE; }
      else if (tap == C_RED || tap == C_BLUE) {
        volLevel = constrain(volLevel + (tap == C_BLUE ? 1 : -1), 0, 10);
        M5.Speaker.setVolume(volLevel * 25);
        don();                                            // その音量で試しに鳴らす
      }
      drawConfig(held);
      break;
    case PLAY:
      updatePlay(dt, edges, now);
      updateFx(dt);
      drawPlay(now);
      break;
    case OVER:
      if (edges && now - overMs > 800) newGame();
      updateFx(dt);
      drawPlay(now);
      break;
  }
  canvas.pushSprite(0, 0);
}
