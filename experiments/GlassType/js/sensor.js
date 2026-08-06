import { CONFIG } from './config.js';
import { serial } from './serial.js';

// ESP32(SHT40)から温湿度を取り続ける係。
// 接続が切れたら自動でシミュレーションモード（SPACE長押し＝息）に落ちる。
export class SensorFeed {
  constructor() {
    this.temp = null;
    this.humidity = null;
    this.baseline = null;    // 「ふだんの湿度」(ゆっくり追従)
    this.connected = false;
    this.simActive = false;

    this._simHumidity = 55;
    this._simBase = 55;
    this._endpointIdx = 0;
    this._failCount = 0;
    this._spaceDown = false;

    addEventListener('keydown', (e) => {
      if (e.code === 'Space') { this._spaceDown = true; e.preventDefault(); }
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'Space') this._spaceDown = false;
    });
  }

  start() {
    this._poll();
    setInterval(() => this._poll(), CONFIG.pollMs);
  }

  _apply(d) {
    if (typeof d.humidity !== 'number') return false;
    this.temp = d.temp;
    this.humidity = d.humidity;
    if (this.baseline === null) this.baseline = d.humidity;
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

  // 毎フレーム呼ぶ。dt=秒
  update(dt) {
    if (this.simActive) {
      // SPACE長押しで湿度が92%へ吹き上がり、離すとゆっくり戻る
      const target = this._spaceDown ? 92 : this._simBase;
      const speed = this._spaceDown ? 2.5 : 0.35;
      this._simHumidity += (target - this._simHumidity) * Math.min(1, speed * dt);
      this.humidity = this._simHumidity;
      if (this.temp === null) this.temp = 25.0;
      if (this.baseline === null) this.baseline = this._simBase;
    }
    // ベースラインは湿度をゆっくり追いかける（環境変化に順応）
    if (this.humidity !== null && this.baseline !== null) {
      this.baseline += (this.humidity - this.baseline) * Math.min(1, dt / CONFIG.baselineTau);
    }
  }

  // いまどれくらい曇るべきか 0..1（ふだんとの差分だけを見る）
  get fogTarget() {
    if (this.humidity === null || this.baseline === null) return 0;
    const delta = this.humidity - this.baseline;
    const x = Math.max(0, Math.min(1, delta / CONFIG.deltaFull));
    return Math.pow(x, CONFIG.fogGamma); // カーブで滑らかに
  }
}
