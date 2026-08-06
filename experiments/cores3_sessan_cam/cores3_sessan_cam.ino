// cores3_sessan_cam.ino
// -----------------------------------------------------------------------------
// M5Stack CoreS3（無印・カメラ搭載機）を「Sessan 用のワイヤレスカメラ」にする。
// カメラ映像を MJPEG でストリーム配信するだけの端末。判定は Mac 側ブラウザの
// Sessan（MediaPipe Holistic）が行う。
//
//   CoreS3 (WiFi) ──MJPEG(/stream)──> Mac ブラウザの Sessan ──> かな入力
//
//   ■ 画面表示（このスケッチは映像を自機に映さない。状態だけ表示）
//       ・WiFi 接続先の IP と配信 URL
//       ・STREAMING / 実測 fps / 接続クライアント有無
//
// ※ カメラは「無印 CoreS3」のみ搭載。CoreS3 SE はカメラ非搭載で動きません。
// 必要ライブラリ: M5CoreS3（esp_camera / img_converters / esp_http_server は
//                Arduino-ESP32 コアに同梱）
//
// 使い方は同じフォルダの SESSAN_CAM.md を参照。
// -----------------------------------------------------------------------------
#include "M5CoreS3.h"
#include "esp_camera.h"
#include "img_converters.h"      // frame2jpg()
#include "esp_http_server.h"
#include <WiFi.h>

// ---- WiFi（自分の環境に合わせて書き換える）---------------------------------
const char* WIFI_SSID = "あなたのSSID";
const char* WIFI_PASS = "あなたのパスワード";

// ---- 画質・配信の調整ノブ ---------------------------------------------------
// 解像度: MediaPipe が指と顔を同時に拾いやすいよう VGA(640x480) を既定に。
//   フレームレートを上げたい/電波が弱いときは FRAMESIZE_QVGA に落とす。
#define STREAM_FRAMESIZE  FRAMESIZE_VGA
// JPEG 品質（frame2jpg は 1〜100、大きいほど高画質＝重い）
#define JPEG_QUALITY      80
// CoreS3 の RGB565 はバイト順が入れ替わっている。配信色が変なら 0/1 を切り替える。
// （cam_effects の CAM_BSWAP と同じ知見。既定 1 でおおむね正しい色になる）
#define CAM_BSWAP         1

// ---- 状態 -------------------------------------------------------------------
bool     wifiOk       = false;
httpd_handle_t httpd  = nullptr;
volatile uint32_t streamFrames = 0;   // 配信した累計フレーム（fps 算出用）
volatile bool     clientOn     = false;
int W, H;

// ---- MJPEG 配信ハンドラ -----------------------------------------------------
static const char* STREAM_CT       = "multipart/x-mixed-replace;boundary=frame";
static const char* STREAM_BOUNDARY = "\r\n--frame\r\n";
static const char* STREAM_PART     = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

// RGB565 のバイト順を入れ替える（frame2jpg に正しい色で渡すため）
static inline void bswap565(uint16_t* p, size_t n) {
  for (size_t i = 0; i < n; i++) p[i] = __builtin_bswap16(p[i]);
}

static esp_err_t stream_handler(httpd_req_t* req) {
  httpd_resp_set_type(req, STREAM_CT);
  // ブラウザ（別オリジン）の canvas から画素を読めるように CORS を許可
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-cache");

  clientOn = true;
  char part[72];

  while (true) {
    if (!CoreS3.Camera.get()) { delay(2); continue; }
    camera_fb_t* fb = CoreS3.Camera.fb;

#if CAM_BSWAP
    if (fb->format == PIXFORMAT_RGB565)
      bswap565((uint16_t*)fb->buf, fb->len / 2);
#endif

    uint8_t* jpg = nullptr;
    size_t   jpglen = 0;
    bool ok = frame2jpg(fb, JPEG_QUALITY, &jpg, &jpglen);
    CoreS3.Camera.free();
    if (!ok) { if (jpg) free(jpg); continue; }

    size_t hlen = snprintf(part, sizeof(part), STREAM_PART, (unsigned)jpglen);
    esp_err_t e = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (e == ESP_OK) e = httpd_resp_send_chunk(req, part, hlen);
    if (e == ESP_OK) e = httpd_resp_send_chunk(req, (const char*)jpg, jpglen);
    free(jpg);

    if (e != ESP_OK) break;   // クライアントが切断した
    streamFrames++;
  }

  clientOn = false;
  return ESP_OK;
}

// ルート: 人が開いたとき用の簡易ページ（プレビュー＋stream への案内）
static esp_err_t index_handler(httpd_req_t* req) {
  httpd_resp_set_type(req, "text/html; charset=utf-8");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  String ip = WiFi.localIP().toString();
  String html =
    "<!doctype html><meta charset=utf-8><title>Sessan CAM</title>"
    "<body style='font-family:sans-serif;background:#111;color:#eee;text-align:center'>"
    "<h3>Sessan CoreS3 CAM</h3>"
    "<p>Sessan の映像ソースにこの URL を貼ってください:</p>"
    "<p><code>http://" + ip + "/stream</code></p>"
    "<img src='/stream' style='max-width:100%;border:1px solid #444'>"
    "</body>";
  return httpd_resp_send(req, html.c_str(), html.length());
}

void startServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port     = 80;
  config.ctrl_port       = 32768;
  config.max_open_sockets = 3;
  config.stack_size      = 8192;
  if (httpd_start(&httpd, &config) != ESP_OK) return;

  httpd_uri_t idx    = { .uri = "/",       .method = HTTP_GET, .handler = index_handler,  .user_ctx = nullptr };
  httpd_uri_t stream = { .uri = "/stream", .method = HTTP_GET, .handler = stream_handler, .user_ctx = nullptr };
  httpd_register_uri_handler(httpd, &idx);
  httpd_register_uri_handler(httpd, &stream);
}

// ---- 画面（状態のみ） -------------------------------------------------------
void drawStatus() {
  static uint32_t lastMs = 0, lastFrames = 0;
  static int fps = 0;
  uint32_t now = millis();
  if (now - lastMs >= 1000) {
    fps = (int)(streamFrames - lastFrames);
    lastFrames = streamFrames;
    lastMs = now;
  }

  CoreS3.Display.fillScreen(TFT_BLACK);
  CoreS3.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  CoreS3.Display.setTextDatum(top_left);
  CoreS3.Display.drawString("Sessan CoreS3 CAM", 8, 8);

  CoreS3.Display.setTextColor(wifiOk ? TFT_GREEN : TFT_RED, TFT_BLACK);
  CoreS3.Display.drawString(wifiOk ? "WiFi OK" : "WiFi NG", 8, 34);

  CoreS3.Display.setTextColor(TFT_CYAN, TFT_BLACK);
  String ip = wifiOk ? WiFi.localIP().toString() : String("---");
  CoreS3.Display.drawString("http://" + ip, 8, 60);
  CoreS3.Display.drawString("      /stream", 8, 82);

  CoreS3.Display.setTextColor(clientOn ? TFT_YELLOW : TFT_DARKGREY, TFT_BLACK);
  CoreS3.Display.drawString(clientOn ? "STREAMING" : "待機中 (未接続)", 8, 112);
  if (clientOn) {
    CoreS3.Display.setTextColor(TFT_WHITE, TFT_BLACK);
    CoreS3.Display.drawString(String(fps) + " fps", 8, 134);
  }

  CoreS3.Display.setTextColor(TFT_DARKGREY, TFT_BLACK);
  CoreS3.Display.setTextDatum(bottom_left);
  CoreS3.Display.drawString("Mac の Sessan で上の URL を指定", 8, H - 8);
}

void setup() {
  auto cfg = M5.config();
  CoreS3.begin(cfg);
  W = CoreS3.Display.width();
  H = CoreS3.Display.height();
  CoreS3.Display.setFont(&fonts::lgfxJapanGothic_16);

  if (!CoreS3.Camera.begin()) {
    CoreS3.Display.setTextDatum(middle_center);
    CoreS3.Display.setTextColor(TFT_WHITE);
    CoreS3.Display.drawString("カメラ初期化に失敗", W / 2, H / 2);
    CoreS3.Display.drawString("(SE はカメラ非搭載)", W / 2, H / 2 + 22);
    while (true) delay(1000);
  }
  // 配信用に解像度を上げる（自機には映さないので大きめでよい）
  CoreS3.Camera.sensor->set_framesize(CoreS3.Camera.sensor, STREAM_FRAMESIZE);
  // 鏡像・上下反転が必要なら（映像の向きが変なら）ここを 1 に:
  // CoreS3.Camera.sensor->set_hmirror(CoreS3.Camera.sensor, 1);
  // CoreS3.Camera.sensor->set_vflip(CoreS3.Camera.sensor, 1);

  // WiFi 接続（最大10秒）。5GHz は不可（ESP32 は 2.4GHz のみ）
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 10000) delay(200);
  wifiOk = (WiFi.status() == WL_CONNECTED);
  Serial.printf("WiFi %s  IP=%s\n", wifiOk ? "OK" : "NG", WiFi.localIP().toString().c_str());

  if (wifiOk) startServer();
  drawStatus();
}

void loop() {
  CoreS3.update();
  static uint32_t last = 0;
  if (millis() - last >= 500) { drawStatus(); last = millis(); }  // 状態を定期更新
  delay(10);
}
