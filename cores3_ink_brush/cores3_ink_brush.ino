// cores3_ink_brush.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3 用 タイポグラフィ・デモ「墨で書く」
//
//   画面を指でなぞると、その筆跡に沿って文章が1文字ずつ置かれていく。
//   ゆっくり動かすと大きく（筆圧が強いように）、速く動かすと小さく。
//   本体を振ると、書いたものが消える（振ると消える墨板）。
//
// 追加センサ不要。CoreS3 内蔵の 液晶 / タッチ / IMU だけで動く。
// 必要ライブラリ: M5Unified
// -----------------------------------------------------------------------------
#include <M5Unified.h>

// なぞると現れる文章（1文字ずつ順番に置かれる）
const char* PHRASE[] = {
  "ふ","で","の","あ","と","に","こ","と","ば","が","の","こ","る"
};
const int PHRASE_N = sizeof(PHRASE) / sizeof(PHRASE[0]);

static constexpr float SPACING = 22.0f;  // 何 px ごとに1文字置くか

M5Canvas  canvas(&M5.Display);
int       W, H;
uint16_t  PAPER, INK, VERMILION;

int   idx = 0;             // 次に置く文字
float prevX, prevY;
bool  prevValid = false;
float carry = 0.0f;        // 前フレームからの距離の繰り越し
uint32_t startMs;

void clearBoard() {
  canvas.fillScreen(PAPER);
  idx = 0;
  prevValid = false;
  carry = 0.0f;
}

// (x,y) に文字を1つ押す。speed が小さいほど大きく描く
void stamp(float x, float y, float speed) {
  float size = constrain(3.0f - speed / 12.0f, 1.0f, 3.2f);
  // 5文字に1つは朱で
  canvas.setTextColor((idx % 5 == 4) ? VERMILION : INK);
  canvas.setTextSize(size);
  canvas.drawString(PHRASE[idx % PHRASE_N], (int)x, (int)y);
  canvas.setTextSize(1.0f);
  idx++;
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  W = M5.Display.width();
  H = M5.Display.height();

  PAPER     = M5.Display.color565(244, 240, 228);
  INK       = M5.Display.color565( 28,  26,  24);
  VERMILION = M5.Display.color565(200,  58,  42);

  canvas.setColorDepth(16);
  if (!canvas.createSprite(W, H)) { canvas.setColorDepth(8); canvas.createSprite(W, H); }
  canvas.setFont(&fonts::lgfxJapanGothic_24);
  canvas.setTextDatum(middle_center);

  clearBoard();
  startMs = millis();
}

void loop() {
  M5.update();

  // --- 振ったら消す ---
  float ax, ay, az;
  if (M5.Imu.getAccel(&ax, &ay, &az)) {
    if (sqrtf(ax * ax + ay * ay + az * az) > 2.2f) clearBoard();
  }

  // --- なぞって文字を置く ---
  auto t = M5.Touch.getDetail();
  if (t.isPressed()) {
    float cx = t.x, cy = t.y;
    if (!prevValid) {           // 触れ始め
      stamp(cx, cy, 0.0f);
      prevX = cx; prevY = cy; prevValid = true; carry = 0.0f;
    } else {
      float dx = cx - prevX, dy = cy - prevY;
      float seg = sqrtf(dx * dx + dy * dy);
      if (seg > 0.001f) {
        float ux = dx / seg, uy = dy / seg;
        carry += seg;
        // SPACING ごとに補間しながらスタンプ
        while (carry >= SPACING) {
          carry -= SPACING;
          prevX += ux * SPACING;
          prevY += uy * SPACING;
          stamp(prevX, prevY, seg);   // seg が大きい＝速い＝小さい文字
        }
        prevX = cx; prevY = cy;
      }
    }
  } else {
    prevValid = false;
  }

  canvas.pushSprite(0, 0);

  // 起動直後だけ操作ヒント（画面に直接、墨には残さない）
  if (millis() - startMs < 4000) {
    M5.Display.setFont(&fonts::lgfxJapanGothic_16);
    M5.Display.setTextDatum(bottom_center);
    M5.Display.setTextColor(INK, PAPER);
    M5.Display.drawString("なぞって書く / 振って消す", W / 2, H - 4);
  }
}
