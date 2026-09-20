// cores3_kuji200.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3 用 運試し「くじの塔」
//
//   関門ごとに「N枚のカードから1枚」を引く。各関門ちょうど1枚だけが当たり。
//   当たれば次の関門へ、はずれたら終了。関門の構成:
//       第1〜3関門 … 2枚から1枚（当たり 1/2）
//       第4関門     … 12枚から1枚（当たり 1/12）
//   通算 = 1/2 × 1/2 × 1/2 × 1/12 = 1/96。全部当てて頂上に着けばゴール。
//
//   ※ どの関門も必ず1枚は当たりが入っている（＝選ぶ意味のある本物のくじ）。
//     はずすと「当たりがどこだったか」も見えるので悔しい。
//
//     - カードをタップ … そのカードを引く
//     - タップ         … クリア／ゲームオーバー後にリスタート
//
//   ▼ ちょうど 1/200 にしたい場合:
//     最終関門を 12→25 枚（下の CARDS を {2,2,2,25} に）すると 1/8×1/25=1/200。
//
// 追加センサ不要。CoreS3 内蔵の 液晶 / タッチ / スピーカー だけで動く。
// 必要ライブラリ: M5Unified（M5GFX を含む）
// -----------------------------------------------------------------------------
#include <M5Unified.h>

static constexpr int SW = 320, SH = 240;
M5Canvas canvas(&M5.Display);

// ---- 関門設定（各関門の「カード枚数」。当たりは常に1枚）--------------------
static constexpr int NGATES = 4;
const int CARDS[NGATES] = { 2, 2, 2, 12 };     // ←ここを {2,2,2,25} にすると通算 1/200

int DENOM[NGATES];                             // 突破後の通算「1/N」（起動時に計算）
int totalDenom = 1;

// ---- 状態 -------------------------------------------------------------------
enum { CHOOSING, REVEAL, CLEARED, OVER } state = CHOOSING;
int  gate = 0;
int  winner = 0;         // その関門の当たりカード番号
int  chosen = -1;        // 引いたカード番号
bool hit = false;
uint32_t revealAt = 0;

// ---- 火花（当たり／クリア演出）--------------------------------------------
struct Spark { float x, y, vx, vy; int life, life0; uint8_t r, g, b; bool on; };
static constexpr int MAX_SPARK = 180;
Spark sparks[MAX_SPARK];

static inline int clampi(int v,int lo,int hi){ return v<lo?lo:(v>hi?hi:v); }
static inline float frnd(float a,float b){ return a+(b-a)*(rand()/(float)RAND_MAX); }
void beep(float f,int ms){ M5.Speaker.tone(f,ms); }

void addSpark(float x,float y,uint8_t r,uint8_t g,uint8_t b){
  for (auto& s: sparks) if(!s.on){
    float a=frnd(0,6.2832f), sp=frnd(0.6f,3.4f); int life=(int)frnd(18,40);
    bool w=(rand()%5==0);
    s={x,y,cosf(a)*sp,sinf(a)*sp,life,life,(uint8_t)(w?255:r),(uint8_t)(w?255:g),(uint8_t)(w?255:b),true};
    return;
  }
}
void burst(float x,float y,uint8_t r,uint8_t g,uint8_t b,int n){ for(int i=0;i<n;i++) addSpark(x,y,r,g,b); }

// ---- カード配置（枚数に応じて 2枚=大 / それ以外=グリッド）------------------
void cardRect(int n, int i, int& x, int& y, int& w, int& h){
  if (n == 2){
    w = 120; h = 116; y = 92;
    x = (i == 0) ? 24 : 176;
    return;
  }
  // グリッド（最大4列）
  int cols = (n <= 4) ? n : 4;
  int rows = (n + cols - 1) / cols;
  int gap = 8;
  int areaX = 14, areaY = 76, areaW = SW - 28, areaH = SH - 76 - 26;
  w = (areaW - (cols - 1) * gap) / cols;
  h = (areaH - (rows - 1) * gap) / rows;
  int col = i % cols, row = i / cols;
  x = areaX + col * (w + gap);
  y = areaY + row * (h + gap);
}
int hitCard(int n, int px, int py){
  for (int i = 0; i < n; i++){ int x,y,w,h; cardRect(n,i,x,y,w,h);
    if (px>=x && px<x+w && py>=y && py<y+h) return i; }
  return -1;
}

void startGate(){ winner = rand() % CARDS[gate]; chosen = -1; state = CHOOSING; }
void newGame(){ gate = 0; for(auto&s:sparks)s.on=false; startGate(); }

void setup(){
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Speaker.begin();
  M5.Speaker.setVolume(180);

  canvas.setPsram(true);
  canvas.setColorDepth(16);
  canvas.createSprite(SW, SH);
  canvas.setFont(&fonts::lgfxJapanGothic_20);

  int acc = 1;
  for (int i = 0; i < NGATES; i++){ acc *= CARDS[i]; DENOM[i] = acc; }
  totalDenom = acc;                       // = 96

  newGame();
}

void pick(int idx){
  chosen = idx;
  hit = (idx == winner);
  beep(660, 18);
  int n = CARDS[gate];
  state = REVEAL;
  revealAt = millis() + (n == 2 ? 900 : 1100);
}

void afterReveal(){
  if (hit){
    int x,y,w,h; cardRect(CARDS[gate], chosen, x,y,w,h);
    burst(x + w/2, y + h/2, 120, 235, 150, 10);
    beep(880,40); beep(1180,60);
    gate++;
    if (gate >= NGATES){
      state = CLEARED;
      burst(SW/2, SH/2, 255, 200, 60, 44);
      beep(700,90); beep(950,90); beep(1250,140); beep(1600,180);
    } else startGate();
  } else {
    state = OVER;
    beep(200,160); beep(90,380);
  }
}

// ---- カード1枚を描く --------------------------------------------------------
void drawCard(int x,int y,int w,int h, bool revealed, bool isWinner, bool highlight, bool big){
  uint16_t bg = revealed ? (isWinner ? canvas.color565(28,90,48) : canvas.color565(88,30,30))
                         : canvas.color565(34,40,66);
  canvas.fillRoundRect(x,y,w,h, big?10:7, bg);
  uint16_t bd = highlight ? canvas.color565(255,220,90) : canvas.color565(90,96,120);
  canvas.drawRoundRect(x,y,w,h, big?10:7, bd);
  if (highlight) canvas.drawRoundRect(x+1,y+1,w-2,h-2, big?9:6, bd);

  canvas.setTextDatum(middle_center);
  int sz = big ? 3 : 2;
  if (!revealed){
    canvas.setTextColor(canvas.color565(150,170,220));
    canvas.setTextSize(sz); canvas.drawString("?", x+w/2, y+h/2); canvas.setTextSize(1);
  } else {
    canvas.setTextColor(isWinner ? canvas.color565(150,255,180) : canvas.color565(255,150,150));
    canvas.setTextSize(sz); canvas.drawString(isWinner ? "○" : "×", x+w/2, y+h/2 - (big?4:0)); canvas.setTextSize(1);
    if (big){
      canvas.setTextColor(TFT_WHITE);
      canvas.drawString(isWinner ? "当たり" : "はずれ", x+w/2, y+h/2+34);
    }
  }
}

void draw(){
  canvas.fillScreen(canvas.color565(12,14,22));

  // 火花
  for (auto& s: sparks) if(s.on){
    s.vy+=0.04f; s.x+=s.vx; s.y+=s.vy; s.life--;
    if(s.life<=0){ s.on=false; continue; }
    float f=(float)s.life/s.life0;
    canvas.fillRect((int)s.x,(int)s.y,2,2, canvas.color565(s.r*f,s.g*f,s.b*f));
  }

  // ヘッダー
  canvas.setTextDatum(top_left);
  canvas.setTextColor(TFT_WHITE);
  char h1[32]; snprintf(h1,sizeof(h1),"くじの塔  1/%d", totalDenom);
  canvas.drawString(h1, 8, 6);
  for (int i=0;i<NGATES;i++){
    uint16_t c = (i<gate) ? canvas.color565(120,235,150)
               : (i==gate && state==CHOOSING) || (i==gate && state==REVEAL) ? canvas.color565(255,220,90)
               : canvas.color565(70,74,92);
    canvas.fillCircle(SW-16-i*20, 16, 6, c);
  }

  if (state==CHOOSING || state==REVEAL){
    bool rv = (state==REVEAL);
    int n = CARDS[gate];

    canvas.setTextDatum(top_center);
    canvas.setTextColor(canvas.color565(200,210,255));
    char buf[56];
    snprintf(buf,sizeof(buf),"第%d関門  %d枚から1枚（当たり 1/%d）", gate+1, n, n);
    canvas.drawString(buf, SW/2, 40);
    canvas.setTextColor(canvas.color565(255,220,120));
    snprintf(buf,sizeof(buf),"成功で通算 1/%d", DENOM[gate]);
    canvas.drawString(buf, SW/2, 60);

    for (int i=0;i<n;i++){ int x,y,w,h; cardRect(n,i,x,y,w,h);
      drawCard(x,y,w,h, rv, (i==winner), (rv && i==chosen), (n==2));
    }

    if (!rv){
      canvas.setTextDatum(bottom_center);
      canvas.setTextColor(canvas.color565(170,180,205));
      canvas.drawString("引くカードをタップ", SW/2, SH-6);
    }
  }

  if (state==CLEARED){
    canvas.setTextDatum(middle_center);
    canvas.setTextColor(canvas.color565(255,225,90));
    canvas.setTextSize(2); canvas.drawString("GAME CLEAR", SW/2, SH/2-24); canvas.setTextSize(1);
    canvas.setTextColor(TFT_WHITE);
    char b[32]; snprintf(b,sizeof(b),"1/%d を突破！", totalDenom);
    canvas.drawString(b, SW/2, SH/2+8);
    canvas.setTextColor(canvas.color565(170,180,205));
    canvas.drawString("タップでもう一度", SW/2, SH/2+38);
  }
  if (state==OVER){
    canvas.setTextDatum(middle_center);
    canvas.setTextColor(canvas.color565(255,100,100));
    canvas.setTextSize(2); canvas.drawString("GAME OVER", SW/2, SH/2-24); canvas.setTextSize(1);
    canvas.setTextColor(TFT_WHITE);
    char b[40]; snprintf(b,sizeof(b),"第%d関門で脱落", gate+1);
    canvas.drawString(b, SW/2, SH/2+8);
    canvas.setTextColor(canvas.color565(170,180,205));
    canvas.drawString("タップでもう一度", SW/2, SH/2+38);
  }

  canvas.setTextSize(1);
  canvas.pushSprite(0,0);
}

void loop(){
  M5.update();
  auto t = M5.Touch.getDetail();
  if (t.wasPressed()){
    if (state==CHOOSING){
      int i = hitCard(CARDS[gate], t.x, t.y);
      if (i >= 0) pick(i);
    } else if (state==CLEARED || state==OVER) newGame();
  }
  if (state==REVEAL && millis()>=revealAt) afterReveal();
  draw();
}
