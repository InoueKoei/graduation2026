// cores3_tetris.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3 用 「かたむきテトリス」
//
//   標準 10x20 のテトリス。7種のミノ・ライン消し・レベル・NEXT 表示つき。
//     - 本体を左右に傾ける   … ミノを左右へ移動（押し続けで連続移動）
//     - 盤をタップ           … 回転（時計回り）
//     - 盤を押しっぱなし      … ソフトドロップ（速く落ちる）
//     - 右上の ‖ ボタン       … 一時停止（中断）
//     - PAUSE 中             … 「つづける」/「やめる（タイトルへ）」
//     - タイトル             … タップでスタート
//
//   ※ 傾きの左右が逆なら INVERT_X を切り替える。効きは TILT_TH で調整。
//
// 追加センサ不要。CoreS3 内蔵の 液晶 / IMU / タッチ / スピーカー だけで動く。
// 必要ライブラリ: M5Unified（M5GFX を含む）
// -----------------------------------------------------------------------------
#include <M5Unified.h>

static constexpr int SW = 320, SH = 240;
M5Canvas canvas(&M5.Display);

// ---- 盤面 -------------------------------------------------------------------
static constexpr int COLS = 10, ROWS = 20, CELL = 11;
static constexpr int BX = 8, BY = 8;                 // 盤の左上（110x220）
static constexpr int BOARDR = BX + COLS * CELL;      // 盤の右端 x
int board[ROWS][COLS];                               // 0=空, 1..7=色

// ---- 画面ボタン領域 ---------------------------------------------------------
static constexpr int PB_X = SW-40, PB_Y = 6, PB_W = 32, PB_H = 24;      // 一時停止
static constexpr int RS_X = 60, RS_Y = 96,  RS_W = 200, RS_H = 34;      // RESUME
static constexpr int QT_X = 60, QT_Y = 140, QT_W = 200, QT_H = 34;      // QUIT
static inline bool inRect(int px,int py,int x,int y,int w,int h){ return px>=x&&px<x+w&&py>=y&&py<y+h; }

// ---- ミノ定義（7種 × 4回転 × 4ブロック の (col,row)）------------------------
// 0=I 1=J 2=L 3=O 4=S 5=T 6=Z
const int8_t SHAPE[7][4][4][2] = {
  {{{0,1},{1,1},{2,1},{3,1}},{{2,0},{2,1},{2,2},{2,3}},{{0,2},{1,2},{2,2},{3,2}},{{1,0},{1,1},{1,2},{1,3}}}, // I
  {{{0,0},{0,1},{1,1},{2,1}},{{1,0},{2,0},{1,1},{1,2}},{{0,1},{1,1},{2,1},{2,2}},{{1,0},{1,1},{0,2},{1,2}}}, // J
  {{{2,0},{0,1},{1,1},{2,1}},{{1,0},{1,1},{1,2},{2,2}},{{0,1},{1,1},{2,1},{0,2}},{{0,0},{1,0},{1,1},{1,2}}}, // L
  {{{1,0},{2,0},{1,1},{2,1}},{{1,0},{2,0},{1,1},{2,1}},{{1,0},{2,0},{1,1},{2,1}},{{1,0},{2,0},{1,1},{2,1}}}, // O
  {{{1,0},{2,0},{0,1},{1,1}},{{1,0},{1,1},{2,1},{2,2}},{{1,1},{2,1},{0,2},{1,2}},{{0,0},{0,1},{1,1},{1,2}}}, // S
  {{{1,0},{0,1},{1,1},{2,1}},{{1,0},{1,1},{2,1},{1,2}},{{0,1},{1,1},{2,1},{1,2}},{{1,0},{0,1},{1,1},{1,2}}}, // T
  {{{0,0},{1,0},{1,1},{2,1}},{{2,0},{1,1},{2,1},{1,2}},{{0,1},{1,1},{1,2},{2,2}},{{1,0},{0,1},{1,1},{0,2}}}, // Z
};
uint16_t COLORCODE[8];

// ---- 現在/次のミノ・状態 ----------------------------------------------------
int curType, curRot, curX, curY;
int nextType;
int score = 0, lines = 0, level = 1;
enum { TITLE, PLAY, PAUSED, OVER } state = TITLE;

uint32_t lastDrop = 0;
// 操作
static constexpr bool  INVERT_X = true;              // ← 左右を反転（今回の修正）
static constexpr float TILT_TH = 0.28f;
static constexpr uint32_t DAS_DELAY = 220, DAS_REPEAT = 90;
int lastDir = 0; uint32_t dasNext = 0;
bool pressing = false, softHold = false; uint32_t pressStart = 0;

void beep(float f, int ms){ M5.Speaker.tone(f, ms); }

// ---- ゲームロジック ---------------------------------------------------------
bool collide(int type, int rot, int px, int py){
  for (int k = 0; k < 4; k++){
    int bx = px + SHAPE[type][rot][k][0];
    int by = py + SHAPE[type][rot][k][1];
    if (bx < 0 || bx >= COLS || by >= ROWS) return true;
    if (by >= 0 && board[by][bx]) return true;
  }
  return false;
}
void spawn(){
  curType = nextType; nextType = rand() % 7;
  curRot = 0; curX = 3; curY = 0;
  if (collide(curType, curRot, curX, curY)) { state = OVER; beep(180,180); beep(90,420); }
}
void newGame(){
  for (int r = 0; r < ROWS; r++) for (int c = 0; c < COLS; c++) board[r][c] = 0;
  score = 0; lines = 0; level = 1;
  nextType = rand() % 7; spawn();
  lastDrop = millis(); state = PLAY;
}
void lockPiece(){
  for (int k = 0; k < 4; k++){
    int bx = curX + SHAPE[curType][curRot][k][0];
    int by = curY + SHAPE[curType][curRot][k][1];
    if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS) board[by][bx] = curType + 1;
  }
  int cleared = 0;
  for (int r = ROWS - 1; r >= 0; r--){
    bool full = true;
    for (int c = 0; c < COLS; c++) if (!board[r][c]) { full = false; break; }
    if (full){
      cleared++;
      for (int rr = r; rr > 0; rr--) for (int c = 0; c < COLS; c++) board[rr][c] = board[rr-1][c];
      for (int c = 0; c < COLS; c++) board[0][c] = 0;
      r++;
    }
  }
  if (cleared){
    const int pts[5] = {0,100,300,500,800};
    score += pts[cleared] * level;
    lines += cleared;
    int nl = 1 + lines / 10; if (nl != level) { level = nl; beep(1000,60); }
    if (cleared == 4){ beep(700,80); beep(1000,80); beep(1400,140); }
    else beep(560 + cleared * 120, 60);
  } else beep(210, 14);
  spawn();
}
void stepDown(){ if (!collide(curType, curRot, curX, curY + 1)) curY++; else lockPiece(); }
void rotate(){
  int nr = (curRot + 1) % 4;
  const int kicks[5] = {0, -1, 1, -2, 2};
  for (int i = 0; i < 5; i++)
    if (!collide(curType, nr, curX + kicks[i], curY)){ curRot = nr; curX += kicks[i]; beep(760, 10); return; }
}
void move(int dx){ if (!collide(curType, curRot, curX + dx, curY)) curX += dx; }

// ---- 入力（PLAY 中）---------------------------------------------------------
void handleInput(){
  float ax, ay, az; M5.Imu.getAccel(&ax, &ay, &az);
  float h = INVERT_X ? -ax : ax;
  int dir = (h > TILT_TH) ? 1 : (h < -TILT_TH) ? -1 : 0;
  uint32_t now = millis();
  if (dir != lastDir){ if (dir != 0){ move(dir); dasNext = now + DAS_DELAY; } lastDir = dir; }
  else if (dir != 0 && now >= dasNext){ move(dir); dasNext = now + DAS_REPEAT; }

  auto t = M5.Touch.getDetail();
  if (t.wasPressed()){
    if (inRect(t.x, t.y, PB_X, PB_Y, PB_W, PB_H)){ state = PAUSED; pressing = false; beep(500,20); return; }
    pressing = (t.x < BOARDR);          // 盤エリアの押下だけ回転/落下に使う
    softHold = false; pressStart = now;
  }
  if (pressing && t.isPressed() && now - pressStart > 180) softHold = true;
  if (t.wasReleased()){
    if (pressing && !softHold && now - pressStart <= 180) rotate();
    pressing = false; softHold = false;
  }
}

// ---- 描画 -------------------------------------------------------------------
void cellRect(int bx, int by, uint16_t col){
  int x = BX + bx * CELL, y = BY + by * CELL;
  canvas.fillRect(x, y, CELL, CELL, col);
  canvas.drawRect(x, y, CELL, CELL, canvas.color565(0,0,0));
}
int ghostY(){ int gy = curY; while (!collide(curType, curRot, curX, gy + 1)) gy++; return gy; }

void drawTitle(){
  canvas.fillScreen(canvas.color565(10,12,18));
  canvas.setTextDatum(middle_center);
  canvas.setTextColor(canvas.color565(120,220,255));
  canvas.setTextSize(2); canvas.drawString("かたむきテトリス", SW/2, 70); canvas.setTextSize(1);
  canvas.setTextColor(TFT_WHITE);
  canvas.drawString("タップでスタート", SW/2, 120);
  canvas.setTextColor(canvas.color565(150,160,190));
  canvas.drawString("傾け=移動  タップ=回転  長押し=落下", SW/2, 160);
  canvas.drawString("右上の ‖ で中断", SW/2, 182);
}

void draw(){
  if (state == TITLE){ drawTitle(); canvas.pushSprite(0,0); return; }

  canvas.fillScreen(canvas.color565(10,12,18));
  canvas.fillRect(BX-2, BY-2, COLS*CELL+4, ROWS*CELL+4, canvas.color565(24,26,34));

  for (int r = 0; r < ROWS; r++) for (int c = 0; c < COLS; c++)
    if (board[r][c]) cellRect(c, r, COLORCODE[board[r][c]]);

  if (state == PLAY || state == PAUSED){
    int gy = ghostY();
    for (int k = 0; k < 4; k++){
      int bx = curX + SHAPE[curType][curRot][k][0];
      int by = gy   + SHAPE[curType][curRot][k][1];
      if (by >= 0){ int x=BX+bx*CELL, y=BY+by*CELL; canvas.drawRect(x,y,CELL,CELL, canvas.color565(70,74,90)); }
    }
    for (int k = 0; k < 4; k++){
      int bx = curX + SHAPE[curType][curRot][k][0];
      int by = curY + SHAPE[curType][curRot][k][1];
      if (by >= 0) cellRect(bx, by, COLORCODE[curType+1]);
    }
  }

  // 右パネル
  int px = BX + COLS*CELL + 14;
  canvas.setTextDatum(top_left);
  canvas.setTextColor(TFT_WHITE);
  canvas.drawString("SCORE", px, 40); canvas.drawNumber(score, px, 58);
  canvas.drawString("LINES", px, 84); canvas.drawNumber(lines, px, 102);
  canvas.drawString("LEVEL", px, 128); canvas.drawNumber(level, px, 146);
  canvas.drawString("NEXT", px, 172);
  for (int k = 0; k < 4; k++){
    int bx = SHAPE[nextType][0][k][0], by = SHAPE[nextType][0][k][1];
    int x = px + bx*CELL, y = 192 + by*CELL;
    canvas.fillRect(x, y, CELL, CELL, COLORCODE[nextType+1]);
    canvas.drawRect(x, y, CELL, CELL, canvas.color565(0,0,0));
  }

  // 一時停止ボタン（プレイ中）
  if (state == PLAY){
    canvas.fillRoundRect(PB_X, PB_Y, PB_W, PB_H, 5, canvas.color565(50,56,78));
    canvas.fillRect(PB_X+10, PB_Y+6, 4, 12, TFT_WHITE);
    canvas.fillRect(PB_X+18, PB_Y+6, 4, 12, TFT_WHITE);
  }

  // PAUSE メニュー
  if (state == PAUSED){
    canvas.fillRoundRect(44, 44, 232, 152, 12, canvas.color565(18,20,28));
    canvas.drawRoundRect(44, 44, 232, 152, 12, canvas.color565(90,96,120));
    canvas.setTextDatum(middle_center);
    canvas.setTextColor(TFT_WHITE);
    canvas.setTextSize(2); canvas.drawString("PAUSE", SW/2, 70); canvas.setTextSize(1);
    canvas.fillRoundRect(RS_X, RS_Y, RS_W, RS_H, 8, canvas.color565(30,110,60));
    canvas.setTextColor(TFT_WHITE); canvas.drawString("つづける", SW/2, RS_Y+RS_H/2);
    canvas.fillRoundRect(QT_X, QT_Y, QT_W, QT_H, 8, canvas.color565(120,40,40));
    canvas.drawString("やめる（タイトルへ）", SW/2, QT_Y+QT_H/2);
  }

  if (state == OVER){
    canvas.fillRect(BX-2, SH/2-30, COLS*CELL+4, 60, TFT_BLACK);
    canvas.setTextDatum(middle_center);
    canvas.setTextColor(canvas.color565(255,100,100));
    canvas.setTextSize(2); canvas.drawString("GAME", BX+COLS*CELL/2, SH/2-12);
    canvas.drawString("OVER", BX+COLS*CELL/2, SH/2+10); canvas.setTextSize(1);
    canvas.setTextColor(TFT_WHITE); canvas.setTextDatum(top_left);
    canvas.drawString("タップで", BX+COLS*CELL+14, SH/2-4);
    canvas.drawString("タイトルへ", BX+COLS*CELL+14, SH/2+14);
  }

  canvas.setTextSize(1);
  canvas.pushSprite(0, 0);
}

void setup(){
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Imu.begin();
  M5.Speaker.begin();
  M5.Speaker.setVolume(170);

  canvas.setPsram(true);
  canvas.setColorDepth(16);
  canvas.createSprite(SW, SH);
  canvas.setFont(&fonts::lgfxJapanGothic_16);

  COLORCODE[1] = canvas.color565(0,  230,230);
  COLORCODE[2] = canvas.color565(50, 90, 240);
  COLORCODE[3] = canvas.color565(240,150,20);
  COLORCODE[4] = canvas.color565(235,220,40);
  COLORCODE[5] = canvas.color565(60, 220,90);
  COLORCODE[6] = canvas.color565(180,60,220);
  COLORCODE[7] = canvas.color565(240,60,60);

  nextType = rand() % 7; spawn();        // 盤の初期化用（表示はタイトル）
  state = TITLE;
}

void loop(){
  M5.update();
  auto t = M5.Touch.getDetail();

  switch (state){
    case TITLE:
      if (t.wasPressed()) newGame();
      break;
    case OVER:
      if (t.wasPressed()) state = TITLE;
      break;
    case PAUSED:
      if (t.wasPressed()){
        if (inRect(t.x,t.y, RS_X,RS_Y,RS_W,RS_H)) { state = PLAY; lastDrop = millis(); beep(700,25); }
        else if (inRect(t.x,t.y, QT_X,QT_Y,QT_W,QT_H)) { state = TITLE; beep(300,25); }
      }
      break;
    case PLAY: {
      handleInput();
      uint32_t now = millis();
      uint32_t interval = softHold ? 45 : (uint32_t)max(90, 800 - (level - 1) * 65);
      if (now - lastDrop >= interval){ stepDown(); lastDrop = now; }
      break;
    }
  }
  draw();
}
