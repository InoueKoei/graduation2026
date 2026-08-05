import { CONFIG } from './config.js';
import { serial } from './serial.js';

// ESP32からMPU-6050の加速度を取り続ける係。
// 切断・MPU無しのときはマウス位置が傾きになる(自動フォールバック)。
export class SensorFeed {
  constructor() {
    this.ax = 0; this.ay = 0; this.az = 1;
    this.mpuOk = false;
    this.connected = false;
    this.simActive = false;
    this.simTilt = { x: 0, y: 0 };

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
    }
  }

  async _poll() {
    // 有線(Web Serial)が繋がっていれば最優先で使う
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
      const d = await res.json();
      this._apply(d);
      this.connected = true;
      this.simActive = false;
      this._failCount = 0;
    } catch (_) {
      this._failCount++;
      this._endpointIdx = (this._endpointIdx + 1) % CONFIG.endpoints.length;
      if (this._failCount >= 3) {
        this.connected = false;
        this.simActive = true;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  get usingSim() {
    return this.simActive || (this.connected && !this.mpuOk);
  }

  // 画面座標系の傾き(-1..1)
  get tilt() {
    if (this.usingSim) return { x: this.simTilt.x, y: this.simTilt.y };
    let x = this.ax, y = this.ay;
    if (CONFIG.swapXY) [x, y] = [y, x];
    if (CONFIG.invertX) x = -x;
    if (CONFIG.invertY) y = -y;
    return { x, y };
  }

  // 揺れの生値: |a|の1gからのズレ
  get rawShake() {
    if (this.usingSim) return 0;
    return Math.abs(Math.hypot(this.ax, this.ay, this.az) - 1);
  }
}
