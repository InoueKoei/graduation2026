#pragma once
// 足に付けた IMU から、1歩ぶんの変位ベクトルを出す。
//
// 加速度のピークで歩数を数えるのではなく、「足が床に静止している区間（立脚期）」を検出して、
// そこで速度がゼロであることを拘束条件に使う（ZUPT: zero-velocity update）。
// 判定に使うのは ‖a‖ と ‖ω‖ という向きに依存しないスカラー量だけなので、
// センサの取り付け角のズレや左右のハード差が判定式に入ってこない。
//
// 左右で同じコードを使うため、機種依存のものはここに一切書かない。
// 呼び出し側が M5.Imu から読んだ値（加速度[g] / 角速度[dps]）を渡す。

#include <Arduino.h>
#include <math.h>

namespace foot {

// ---- しきい値 ----------------------------------------------------------
constexpr float    SAMPLE_HZ       = 200.0f;
constexpr uint32_t SAMPLE_US       = (uint32_t)(1000000.0f / SAMPLE_HZ);

constexpr float    STANCE_A_TOL    = 0.25f;   // | ‖a‖ − 1g | がこれ未満なら静止候補 [g]
constexpr float    STANCE_W_ENTER  = 50.0f;   // ‖ω‖ がこれ未満なら静止候補 [dps]
constexpr float    STANCE_W_EXIT   = 80.0f;   // 立脚から抜けるしきい値（ヒステリシス）[dps]
constexpr uint32_t STANCE_MIN_US   = 60000;   // 静止候補がこれだけ続いたら立脚確定 [us]

constexpr float    BIAS_GAIN       = 0.02f;   // 立脚中のジャイロバイアス再推定の追従係数
constexpr float    TILT_GAIN       = 0.02f;   // 立脚中に重力方向へロール・ピッチを引き戻す係数

constexpr float    G_MS2           = 9.80665f;
constexpr float    DEG2RAD         = 0.017453292519943295f;

// ---- 1歩ぶんの記録 -----------------------------------------------------
struct StepEvent {
  uint32_t seq;
  uint32_t t_us;        // 接地した時刻（デバイスの micros）
  float    dx, dy, dz;  // この1歩の変位（ナビ座標, m）
  float    x, y;        // 原点からの累積位置（ナビ座標, m）
  float    yaw;         // 接地時のヨー [rad]
  float    pitch_hs;    // 接地時のピッチ [rad]
  uint32_t stance_ms;   // 直前の立脚時間
  uint32_t swing_ms;    // この1歩の遊脚時間
  float    peak_a;      // 遊脚中の ‖a‖ の最大 [g]
  float    peak_w;      // 遊脚中の ‖ω‖ の最大 [dps]
};

// ---- クォータニオン（body -> nav）--------------------------------------
struct Quat {
  float w = 1, x = 0, y = 0, z = 0;

  void normalize() {
    float n = sqrtf(w*w + x*x + y*y + z*z);
    if (n > 1e-9f) { w /= n; x /= n; y /= n; z /= n; }
  }

  // body 座標のベクトルを nav 座標へ回す
  void rotate(float vx, float vy, float vz, float* ox, float* oy, float* oz) const {
    // t = 2 * (q_vec × v);  v' = v + w*t + q_vec × t
    float tx = 2.0f * (y*vz - z*vy);
    float ty = 2.0f * (z*vx - x*vz);
    float tz = 2.0f * (x*vy - y*vx);
    *ox = vx + w*tx + (y*tz - z*ty);
    *oy = vy + w*ty + (z*tx - x*tz);
    *oz = vz + w*tz + (x*ty - y*tx);
  }

  // 角速度[rad/s] で dt 秒ぶん積分する
  void integrate(float wx, float wy, float wz, float dt) {
    float hx = 0.5f * dt * wx, hy = 0.5f * dt * wy, hz = 0.5f * dt * wz;
    float nw = w - x*hx - y*hy - z*hz;
    float nx = x + w*hx + y*hz - z*hy;
    float ny = y + w*hy - x*hz + z*hx;
    float nz = z + w*hz + x*hy - y*hx;
    w = nw; x = nx; y = ny; z = nz;
    normalize();
  }

  // nav 座標側から微小回転を左から掛ける
  void applyNavCorrection(float ex, float ey, float ez) {
    float hx = 0.5f * ex, hy = 0.5f * ey, hz = 0.5f * ez;
    float nw = w - hx*x - hy*y - hz*z;
    float nx = x + hx*w + hy*z - hz*y;
    float ny = y - hx*z + hy*w + hz*x;
    float nz = z + hx*y - hy*x + hz*w;
    w = nw; x = nx; y = ny; z = nz;
    normalize();
  }

  float yaw()   const { return atan2f(2*(w*z + x*y), 1 - 2*(y*y + z*z)); }
  float pitch() const { float s = 2*(w*y - z*x); s = s > 1 ? 1 : (s < -1 ? -1 : s); return asinf(s); }
  float roll()  const { return atan2f(2*(w*x + y*z), 1 - 2*(x*x + y*y)); }
};

// ---- 本体 --------------------------------------------------------------
class FootTracker {
public:
  void begin() {
    _q = Quat();
    _initialized = false;
    _stance = true;
    _seq = 0;
    resetOrigin();
  }

  // 「構え」。位置とヨーの原点を打ち直す。ロール・ピッチは重力基準なので残す。
  void resetOrigin() {
    _x = _y = 0;
    _vx = _vy = _vz = 0;
    _px = _py = _pz = 0;
    // ヨーだけ 0 に落とす（現在の姿勢から yaw ぶんの回転を打ち消す）
    float yw = _q.yaw();
    float c = cosf(-yw * 0.5f), s = sinf(-yw * 0.5f);
    Quat r; r.w = c; r.x = 0; r.y = 0; r.z = s;
    _q = mul(r, _q);
    _q.normalize();
  }

  // 1 サンプル投入する。接地イベントが出たら true を返す。
  // ax..az [g], gx..gz [dps], t_us はサンプリング時刻
  bool update(float ax, float ay, float az, float gx, float gy, float gz, uint32_t t_us) {
    float a_mag = sqrtf(ax*ax + ay*ay + az*az);
    float w_mag = sqrtf(gx*gx + gy*gy + gz*gz);

    if (!_initialized) {
      // 最初のサンプルの重力方向で姿勢を初期化する
      alignToGravity(ax, ay, az);
      _initialized = true;
      _last_us = t_us;
      _state_since_us = t_us;
      _stance_start_us = t_us;
      return false;
    }

    float dt = (t_us - _last_us) * 1e-6f;
    _last_us = t_us;
    if (dt <= 0 || dt > 0.1f) dt = 1.0f / SAMPLE_HZ;   // 取りこぼし時の保険

    // --- 姿勢を進める（バイアス補正済みジャイロ）---
    float wx = (gx - _bias_x) * DEG2RAD;
    float wy = (gy - _bias_y) * DEG2RAD;
    float wz = (gz - _bias_z) * DEG2RAD;
    _q.integrate(wx, wy, wz, dt);

    // --- 静止候補かどうか ---
    bool quiet = (fabsf(a_mag - 1.0f) < STANCE_A_TOL) && (w_mag < STANCE_W_ENTER);

    bool produced = false;

    if (_stance) {
      // 立脚中：バイアスを取り直し、重力方向へロール・ピッチを引き戻す
      _bias_x += (gx - _bias_x) * BIAS_GAIN;
      _bias_y += (gy - _bias_y) * BIAS_GAIN;
      _bias_z += (gz - _bias_z) * BIAS_GAIN;
      levelToGravity(ax, ay, az, a_mag);

      if (w_mag > STANCE_W_EXIT) {           // 蹴り出し
        _stance = false;
        _stance_ms = (t_us - _stance_start_us) / 1000;
        _swing_start_us = t_us;
        _vx = _vy = _vz = 0;
        _px = _py = _pz = 0;
        _peak_a = _peak_w = 0;
      }
    } else {
      // 遊脚中：ナビ座標で重力を引いて 2 回積分する
      float nx, ny, nz;
      _q.rotate(ax, ay, az, &nx, &ny, &nz);
      float axm = nx * G_MS2;
      float aym = ny * G_MS2;
      float azm = (nz - 1.0f) * G_MS2;

      _px += _vx * dt + 0.5f * axm * dt * dt;
      _py += _vy * dt + 0.5f * aym * dt * dt;
      _pz += _vz * dt + 0.5f * azm * dt * dt;
      _vx += axm * dt;
      _vy += aym * dt;
      _vz += azm * dt;

      if (a_mag > _peak_a) _peak_a = a_mag;
      if (w_mag > _peak_w) _peak_w = w_mag;

      if (quiet) {
        if (_quiet_since_us == 0) _quiet_since_us = t_us;
        if (t_us - _quiet_since_us >= STANCE_MIN_US) {
          // --- 接地。ここで速度は 0 のはずなので、溜まった誤差を遊脚区間へ逆配分する ---
          float T = (t_us - _swing_start_us) * 1e-6f;
          // 速度誤差が 0 から線形に育ったとみなすと、位置誤差は v_err * T / 2
          _px -= _vx * T * 0.5f;
          _py -= _vy * T * 0.5f;
          _pz -= _vz * T * 0.5f;

          _x += _px;
          _y += _py;

          _last.seq       = ++_seq;
          _last.t_us      = t_us;
          _last.dx        = _px;
          _last.dy        = _py;
          _last.dz        = _pz;
          _last.x         = _x;
          _last.y         = _y;
          _last.yaw       = _q.yaw();
          _last.pitch_hs  = _q.pitch();
          _last.stance_ms = _stance_ms;
          _last.swing_ms  = (uint32_t)(T * 1000.0f);
          _last.peak_a    = _peak_a;
          _last.peak_w    = _peak_w;
          produced = true;

          _stance = true;
          _stance_start_us = t_us;
          _quiet_since_us = 0;
          _vx = _vy = _vz = 0;
        }
      } else {
        _quiet_since_us = 0;
      }
    }
    return produced;
  }

  const StepEvent& lastStep() const { return _last; }
  bool  isStance()  const { return _stance; }
  float yaw()       const { return _q.yaw(); }
  float pitch()     const { return _q.pitch(); }
  float roll()      const { return _q.roll(); }
  float x()         const { return _x; }
  float y()         const { return _y; }
  uint32_t steps()  const { return _seq; }

private:
  static Quat mul(const Quat& a, const Quat& b) {
    Quat r;
    r.w = a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z;
    r.x = a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y;
    r.y = a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x;
    r.z = a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w;
    return r;
  }

  // 測った重力方向が nav の +Z を向くように姿勢を作る（ヨーは 0）
  void alignToGravity(float ax, float ay, float az) {
    float n = sqrtf(ax*ax + ay*ay + az*az);
    if (n < 1e-6f) { _q = Quat(); return; }
    float ux = ax/n, uy = ay/n, uz = az/n;      // body での「上」
    // u を [0,0,1] に重ねる回転
    float cx = uy * 1.0f - uz * 0.0f;           // u × z
    float cy = uz * 0.0f - ux * 1.0f;
    float cz = 0.0f;
    float dot = uz;
    float s = sqrtf((1.0f + dot) * 2.0f);
    if (s < 1e-6f) { _q.w = 0; _q.x = 1; _q.y = 0; _q.z = 0; return; }
    _q.w = s * 0.5f;
    _q.x = cx / s;
    _q.y = cy / s;
    _q.z = cz / s;
    _q.normalize();
  }

  // 立脚中だけ、重力方向のズレぶんロール・ピッチを弱く引き戻す（ヨーは触らない）
  void levelToGravity(float ax, float ay, float az, float a_mag) {
    if (a_mag < 1e-6f) return;
    float nx, ny, nz;
    _q.rotate(ax / a_mag, ay / a_mag, az / a_mag, &nx, &ny, &nz);
    // nav に回した「上」が [0,0,1] からどれだけ傾いているか = 外積
    float ex =  ny;     // (nx,ny,nz) × (0,0,1)
    float ey = -nx;
    _q.applyNavCorrection(ex * TILT_GAIN, ey * TILT_GAIN, 0.0f);
  }

  Quat _q;
  bool _initialized = false;
  bool _stance = true;

  uint32_t _last_us = 0, _state_since_us = 0;
  uint32_t _stance_start_us = 0, _swing_start_us = 0, _quiet_since_us = 0;
  uint32_t _stance_ms = 0, _seq = 0;

  float _bias_x = 0, _bias_y = 0, _bias_z = 0;
  float _vx = 0, _vy = 0, _vz = 0;      // 遊脚中の速度 [m/s]
  float _px = 0, _py = 0, _pz = 0;      // 遊脚中の変位 [m]
  float _x = 0, _y = 0;                 // 原点からの累積位置 [m]
  float _peak_a = 0, _peak_w = 0;

  StepEvent _last{};
};

}  // namespace foot
