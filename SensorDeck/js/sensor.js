import { CONFIG } from './config.js';
import { serial } from './serial.js';

// 取得・履歴・統計・CSV記録を一手に引き受ける係。
// 診断ツールなので偽データは作らない: 切断中は欠測(null)としてチャートに穴が開く。
export class SensorFeed {
  constructor() {
    this.latest = null;          // 直近の生データ
    this.connected = false;
    this.endpoint = '--';
    this.latencyMs = null;

    this.history = [];           // {t, temp, hum, ax, ay, az}
    this.recording = false;
    this.recRows = [];

    this._endpointIdx = 0;
    this._results = [];          // 直近の成否(成功率用)
  }

  start() {
    this._poll();
    setInterval(() => this._poll(), CONFIG.pollMs);
  }

  async _poll() {
    // 有線(Web Serial)が繋がっていれば最優先で使う
    if (serial.active) {
      const d = serial.latest;
      if (d && typeof d.humidity === 'number') {
        this.latencyMs = 0;
        this.latest = d;
        this.connected = true;
        this.endpoint = 'USB (有線)';
        this._pushResult(true);
        this._pushSample(d);
      }
      return;
    }
    const url = CONFIG.endpoints[this._endpointIdx];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.pollMs * 3);
    const t0 = performance.now();
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      const d = await res.json();
      if (typeof d.humidity !== 'number') throw new Error(d.error || 'bad data');
      this.latencyMs = performance.now() - t0;
      this.latest = d;
      this.connected = true;
      this.endpoint = new URL(url).host;
      this._pushResult(true);
      this._pushSample(d);
    } catch (_) {
      this.connected = false;
      this._pushResult(false);
      this._endpointIdx = (this._endpointIdx + 1) % CONFIG.endpoints.length;
    } finally {
      clearTimeout(timer);
    }
  }

  _pushResult(ok) {
    this._results.push(ok);
    if (this._results.length > 100) this._results.shift();
  }

  get successRate() {
    if (this._results.length === 0) return null;
    return this._results.filter(Boolean).length / this._results.length;
  }

  _pushSample(d) {
    const shtOk = d.sht !== false;
    const mpuOk = !!d.mpu;
    const s = {
      t: Date.now(),
      // センサーが死んでる間の値(0.0等)は偽データなので欠測扱いにする
      temp: shtOk ? d.temp : null,
      hum:  shtOk ? d.humidity : null,
      ax: mpuOk ? (d.ax ?? null) : null,
      ay: mpuOk ? (d.ay ?? null) : null,
      az: mpuOk ? (d.az ?? null) : null,
      sht: shtOk, mpu: mpuOk,
    };
    this.history.push(s);
    const cutoff = Date.now() - CONFIG.windowSec * 1000 - 2000;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();
    if (this.recording) {
      this.recRows.push([
        new Date(s.t).toISOString(), s.temp, s.hum, s.ax, s.ay, s.az,
      ]);
    }
  }

  // 窓内のmin/max
  minmax(key) {
    let lo = Infinity, hi = -Infinity;
    for (const s of this.history) {
      const v = s[key];
      if (v == null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return lo <= hi ? [lo, hi] : null;
  }

  startRec() { this.recRows = []; this.recording = true; }

  stopRecAndDownload() {
    this.recording = false;
    if (this.recRows.length === 0) return 0;
    const head = 'time,temp,humidity,ax,ay,az\n';
    const body = this.recRows.map(r => r.join(',')).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sensordeck_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    return this.recRows.length;
  }
}
