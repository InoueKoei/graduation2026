// cores3_cam_effects.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3（無印・カメラ搭載機）用 カメラ加工＋スナップ／アルバム デモ
//
//   ■ ライブ画面
//       1タップ   … 撮影（加工後を保存＋WiFiでローカルサーバへ自動アップロード）
//       2タップ   … エフェクト切替（そのまま／グレー／リソ／線画／ポスタライズ）
//       長押し0.7秒 … アルバムを開く
//   ■ アルバム
//       1タップ … 次の写真へ
//       2タップ … 戻る（quit）
//
//   ※ タップ回数は約320msの時間窓でまとめて判定するので、1タップの反応は
//     少しだけ遅れて確定します（多重タップ判定のため）。
//   ※ 保存はPSRAM上に最新12枚。電源を切ると消えます（SD保存は下部メモ参照）。
//
// ※ カメラは「無印 CoreS3」のみ搭載。CoreS3 SE はカメラ非搭載で動きません。
// 必要ライブラリ: M5CoreS3
// -----------------------------------------------------------------------------
#include "M5CoreS3.h"
#include "esp_camera.h"
#include <string.h>
#include <WiFi.h>
#include <HTTPClient.h>

// ---- WiFi / アップロード先（自分の環境に合わせて書き換える）-----------------
const char* WIFI_SSID  = "あなたのSSID";
const char* WIFI_PASS  = "あなたのパスワード";
// Mac のローカルIP。ターミナルで `ipconfig getifaddr en0` で確認できる
const char* UPLOAD_URL = "http://192.168.x.x:8080/upload";
bool wifiOk = false;

// esp_camera の RGB565 はバイト順が入れ替わっている。色がおかしければ 0 に。
#define CAM_BSWAP 1
#if CAM_BSWAP
  #define RD(v) __builtin_bswap16(v)
  #define WR(v) __builtin_bswap16(v)
#else
  #define RD(v) (v)
  #define WR(v) (v)
#endif

// ---- エフェクト -------------------------------------------------------------
const char* MODE_NAME[] = {
  "0 そのまま", "1 グレー", "2 リソ(2値ディザ)", "3 線画(輪郭)", "4 ポスタライズ"
};
const int NMODES = sizeof(MODE_NAME) / sizeof(MODE_NAME[0]);
int mode = 2;

const uint8_t BAYER[16] = { 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 };
uint8_t*  lumaBuf = nullptr;
uint16_t  PAPER, INK;

// ---- 状態 -------------------------------------------------------------------
enum { LIVE, ALBUM } state = LIVE;

// ---- スナップショット（PSRAM）---------------------------------------------
static constexpr int MAX_SHOTS = 12;
uint16_t* shots[MAX_SHOTS];
int shotW[MAX_SHOTS], shotH[MAX_SHOTS];
int shotCount  = 0;
int albumIndex = 0;
bool wantSnap  = false;

// ---- タップ回数判定 ---------------------------------------------------------
static constexpr uint32_t TAP_WINDOW = 400;   // ms（多重タップの猶予。大きいほど打ちやすいが1タップ確定が遅くなる）
static constexpr uint32_t LONG_MS    = 700;   // ms（この時間押し続けたら長押し＝アルバムを開く）
int      tapCount   = 0;
uint32_t lastTapMs  = 0;
uint32_t pressStart = 0;
bool     pressing   = false;
bool     longFired  = false;

// ---- 一時メッセージ ---------------------------------------------------------
const char* msg = nullptr;
uint32_t    msgUntil = 0;
void flash(const char* s, uint32_t ms = 700) { msg = s; msgUntil = millis() + ms; }

int W, H;

// ---- 色ユーティリティ -------------------------------------------------------
static inline void rgb888(uint16_t px, int& r, int& g, int& b) {
  r = ((px >> 11) & 0x1F) << 3;
  g = ((px >> 5)  & 0x3F) << 2;
  b =  (px        & 0x1F) << 3;
}
static inline uint16_t to565(int r, int g, int b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
static inline int luma565(uint16_t px) {
  int r, g, b; rgb888(px, r, g, b);
  return (r * 77 + g * 150 + b * 29) >> 8;
}

void process(uint16_t* buf, int w, int h) {
  switch (mode) {
    case 0: break;
    case 1:
      for (int i = 0; i < w * h; i++) { int y = luma565(RD(buf[i])); buf[i] = WR(to565(y, y, y)); }
      break;
    case 2:
      for (int yy = 0; yy < h; yy++)
        for (int xx = 0; xx < w; xx++) {
          int i = yy * w + xx, y = luma565(RD(buf[i]));
          int thr = BAYER[(yy & 3) * 4 + (xx & 3)] * 16 + 8;
          buf[i] = WR(y > thr ? PAPER : INK);
        }
      break;
    case 3:
      if (!lumaBuf) break;
      for (int i = 0; i < w * h; i++) lumaBuf[i] = luma565(RD(buf[i]));
      for (int yy = 0; yy < h; yy++)
        for (int xx = 0; xx < w; xx++) {
          int i = yy * w + xx;
          if (xx == 0 || yy == 0 || xx == w - 1 || yy == h - 1) { buf[i] = WR(PAPER); continue; }
          uint8_t* L = lumaBuf + i;
          int gx = -L[-w-1] - 2*L[-1] - L[w-1] + L[-w+1] + 2*L[1] + L[w+1];
          int gy = -L[-w-1] - 2*L[-w] - L[-w+1] + L[w-1] + 2*L[w] + L[w+1];
          buf[i] = WR((abs(gx) + abs(gy)) > 90 ? INK : PAPER);
        }
      break;
    case 4:
      for (int i = 0; i < w * h; i++) {
        int r, g, b; rgb888(RD(buf[i]), r, g, b);
        r = (r >> 6) * 85; g = (g >> 6) * 85; b = (b >> 6) * 85;
        buf[i] = WR(to565(r, g, b));
      }
      break;
  }
}

// 加工後の1フレームを保存（満杯なら最古を捨てる）
void takeSnapshot(uint16_t* buf, int w, int h) {
  size_t bytes = (size_t)w * h * 2;
  if (shotCount >= MAX_SHOTS) {
    free(shots[0]);
    for (int i = 1; i < shotCount; i++) { shots[i-1] = shots[i]; shotW[i-1] = shotW[i]; shotH[i-1] = shotH[i]; }
    shotCount--;
  }
  uint16_t* p = (uint16_t*)heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM);
  if (!p) p = (uint16_t*)malloc(bytes);
  if (!p) { flash("メモリ不足", 900); return; }
  memcpy(p, buf, bytes);
  shots[shotCount] = p; shotW[shotCount] = w; shotH[shotCount] = h; shotCount++;
  flash("保存しました");
}

// 加工後フレームを生RGB565のままローカルサーバへPOST（変換はサーバ側でPNGに）
void uploadSnapshot(uint16_t* buf, int w, int h) {
  if (!wifiOk) { flash("WiFi未接続", 900); return; }
  HTTPClient http;
  http.begin(UPLOAD_URL);
  http.addHeader("Content-Type", "application/octet-stream");
  http.addHeader("X-Width",  String(w));
  http.addHeader("X-Height", String(h));
  http.addHeader("X-Bswap",  String(CAM_BSWAP));   // サーバ側でバイト順を吸収するため
  int code = http.POST((uint8_t*)buf, (size_t)w * h * 2);
  http.end();
  flash(code == 200 ? "送信OK" : "送信失敗", code == 200 ? 700 : 900);
}

// タップ回数に応じた動作
void dispatch(int taps) {
  if (state == LIVE) {
    if      (taps == 1) wantSnap = true;                       // 撮影は次フレームで実行
    else if (taps == 2) mode = (mode + 1) % NMODES;
    // 3タップ以上は無効（アルバムは長押しで開く）
  } else { // ALBUM
    if (taps == 1) albumIndex = (albumIndex + 1) % shotCount;
    else           state = LIVE;                                // 2タップ以上で戻る
  }
}

void drawOverlayMsg() {
  if (msg && millis() < msgUntil) {
    CoreS3.Display.setTextDatum(middle_center);
    CoreS3.Display.setTextColor(TFT_WHITE, TFT_BLACK);
    CoreS3.Display.drawString(msg, W / 2, H / 2);
  } else msg = nullptr;
}

void drawAlbum() {
  CoreS3.Display.pushImage(0, 0, shotW[albumIndex], shotH[albumIndex], shots[albumIndex]);
  CoreS3.Display.setTextDatum(top_left);
  CoreS3.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  CoreS3.Display.drawString(String("アルバム ") + (albumIndex + 1) + "/" + shotCount, 4, 4);
  CoreS3.Display.setTextDatum(bottom_left);
  CoreS3.Display.drawString("1タップ:次  2タップ:戻る", 4, H - 4);
}

void setup() {
  auto cfg = M5.config();
  CoreS3.begin(cfg);
  W = CoreS3.Display.width();
  H = CoreS3.Display.height();
  CoreS3.Display.setFont(&fonts::lgfxJapanGothic_16);

  PAPER = CoreS3.Display.color565(240, 236, 222);
  INK   = CoreS3.Display.color565( 28,  40,  92);

  if (!CoreS3.Camera.begin()) {
    CoreS3.Display.setTextDatum(middle_center);
    CoreS3.Display.setTextColor(TFT_WHITE);
    CoreS3.Display.drawString("カメラ初期化に失敗", W / 2, H / 2);
    CoreS3.Display.drawString("(SE はカメラ非搭載)", W / 2, H / 2 + 22);
    while (true) delay(1000);
  }
  CoreS3.Camera.sensor->set_framesize(CoreS3.Camera.sensor, FRAMESIZE_QVGA);
  // CoreS3.Camera.sensor->set_hmirror(CoreS3.Camera.sensor, 1);
  // CoreS3.Camera.sensor->set_vflip(CoreS3.Camera.sensor, 1);

  lumaBuf = (uint8_t*)heap_caps_malloc(320 * 240, MALLOC_CAP_SPIRAM);
  if (!lumaBuf) lumaBuf = (uint8_t*)malloc(320 * 240);

  // WiFi 接続（最大8秒待つ。つながらなくてもローカル保存だけで動作）
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 8000) delay(200);
  wifiOk = (WiFi.status() == WL_CONNECTED);
  Serial.printf("WiFi %s  IP=%s\n", wifiOk ? "OK" : "NG", WiFi.localIP().toString().c_str());
  flash(wifiOk ? "WiFi接続OK" : "WiFi未接続(ローカルのみ)", 1500);
}

void loop() {
  CoreS3.update();

  // --- 入力: 短タップは回数で判定、長押しでアルバムを開く ---
  auto t = CoreS3.Touch.getDetail();
  if (t.wasPressed()) { pressing = true; longFired = false; pressStart = millis(); }
  if (pressing && !longFired && t.isPressed() && millis() - pressStart >= LONG_MS) {
    longFired = true;                       // このプレスはタップに数えない
    if (state == LIVE) {
      if (shotCount > 0) { state = ALBUM; albumIndex = shotCount - 1; }
      else flash("写真がありません", 900);
    }
  }
  if (t.wasReleased()) {
    pressing = false;
    if (!longFired) { tapCount++; lastTapMs = millis(); }   // 短タップだけ数える
  }
  if (tapCount > 0 && millis() - lastTapMs > TAP_WINDOW) { dispatch(tapCount); tapCount = 0; }

  if (state == LIVE) {
    if (CoreS3.Camera.get()) {
      uint16_t* buf = (uint16_t*)CoreS3.Camera.fb->buf;
      int w = CoreS3.Camera.fb->width, h = CoreS3.Camera.fb->height;
      process(buf, w, h);
      CoreS3.Display.pushImage(0, 0, w, h, buf);
      if (wantSnap) { takeSnapshot(buf, w, h); uploadSnapshot(buf, w, h); wantSnap = false; }  // 保存＋自動アップロード
      CoreS3.Display.setTextDatum(top_left);
      CoreS3.Display.setTextColor(TFT_WHITE, TFT_BLACK);
      CoreS3.Display.drawString(MODE_NAME[mode], 4, 4);
      CoreS3.Camera.free();
    }
  } else { // ALBUM: カメラは流すだけ（バッファ滞留防止）、表示はアルバム
    if (CoreS3.Camera.get()) CoreS3.Camera.free();
    drawAlbum();
  }

  // いま溜まっているタップ数を右上に表示（3で開く、が目で分かる）
  if (tapCount > 0) {
    String dots;
    for (int i = 0; i < tapCount && i < 5; i++) dots += "●";
    CoreS3.Display.setTextDatum(top_right);
    CoreS3.Display.setTextColor(TFT_YELLOW, TFT_BLACK);
    CoreS3.Display.drawString(dots, W - 4, 4);
  }

  drawOverlayMsg();
}
