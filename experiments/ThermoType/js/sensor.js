import { CONFIG } from './config.js';
import { serial } from './serial.js';

// ESP32(SHT40)から温湿度を取り続ける係。
// 接続が切れたら自動でシミュレーションモード（画面右下のスライダ操作）に落ちる。
export class SensorFeed {
  constructor() {
    this.temp = null;
    this.humidity = null;
    this.connected = false;
    this.simActive = false;
    this.simTemp = 25;
    this.simHum = 55;

    this._endpointIdx = 0;
    this._failCount = 0;
  }

  start() {
    this._poll();
    setInterval(() => this._poll(), CONFIG.pollMs);
  }

  _apply(d) {
    if (typeof d.humidity !== 'number') return false;
    this.temp = d.temp;
    this.humidity = d.humidity;
    return true;
  }

  async _poll() {
    // 有線(Web Serial)が繋がっていれば最優先で使う
    if (serial.active) {
      if (serial.latest && this._apply(serial.latest)) {
        this.connected = true; this.simActive = false; this._failCount = 0;
      }
      return;
    }
    const url = CONFIG.endpoints[this._endpointIdx];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.pollMs * 2);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      const d = await res.json();
      if (!this._apply(d)) throw new Error(d.error || 'bad data');
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

  // 現在使うべき温湿度（実測 or スライダ）
  get value() {
    if (this.simActive) return { temp: this.simTemp, humidity: this.simHum };
    return { temp: this.temp, humidity: this.humidity };
  }
}
