import { CONFIG } from './config.js';
import { serial } from './serial.js';

// ESP32からMPU-6050の加速度を取り続ける係。
// 有線(Web Serial) > WiFi > マウス の順に自動で拾う。
export class SensorFeed {
  constructor() {
    this.ax = 0; this.ay = 0; this.az = 1;
    this.mpuOk = false;
    this.connected = false;
    this.simActive = false;
    this.simTilt = { x: 0, y: 0 };

    // 上下の「振り」検出用: 姿勢のゆっくりした変化を基準にして、
    // そこからの急なズレだけを取り出す(ハイパスフィルタ)
    this.gBase = 1;
    this.jerk = 0;      // + = 上へ振った, - = 下へ振った

    this._endpointIdx = 0;
    this._failCount = 0;
  }

  start() {
    this._poll();
    setInterval(() => this._poll(), CONFIG.pollMs);
  }

  _apply(d) {
    if (typeof d.ax === 'number') {
      this.ax = d.ax; this.ay = d.ay; this.az = d.az;
      this.mpuOk = !!d.mpu;
      // 合成加速度の大きさ。静止していれば重力の1gだけ。
      // 上へ振れば1gを超え、落とすように下げれば1gを下回る。
      const mag = Math.hypot(this.ax, this.ay, this.az);
      this.gBase += (mag - this.gBase) * 0.04;   // ゆっくり追う基準
      this.jerk = mag - this.gBase;              // 急な差分だけ残る
    }
  }

  async _poll() {
    if (serial.active) {
      if (serial.latest) {
        this._apply(serial.latest);
        this.connected = true; this.simActive = false; this._failCount = 0;
      }
      return;
    }
    const url = CONFIG.endpoints[this._endpointIdx];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.pollMs * 3);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      this._apply(await res.json());
      this.connected = true;
      this.simActive = false;
      this._failCount = 0;
    } catch (_) {
      this._failCount++;
      this._endpointIdx = (this._endpointIdx + 1) % CONFIG.endpoints.length;
      if (this._failCount >= 3) { this.connected = false; this.simActive = true; }
    } finally {
      clearTimeout(timer);
    }
  }

  get usingSim() {
    return this.simActive || (this.connected && !this.mpuOk);
  }

  get tilt() {
    if (this.usingSim) return { x: this.simTilt.x, y: this.simTilt.y };
    let x = this.ax, y = this.ay;
    if (CONFIG.swapXY) [x, y] = [y, x];
    if (CONFIG.invertX) x = -x;
    if (CONFIG.invertY) y = -y;
    // 不感帯: わずかな手ぶれでは動かさない(閾値を引いて滑らかに繋ぐ)
    const dz = CONFIG.tiltDead;
    const cut = (v) => (Math.abs(v) < dz ? 0 : v - Math.sign(v) * dz);
    return { x: cut(x), y: cut(y) };
  }

  get rawShake() {
    if (this.usingSim) return 0;
    return Math.abs(Math.hypot(this.ax, this.ay, this.az) - 1);
  }
}
