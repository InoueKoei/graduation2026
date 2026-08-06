import { CONFIG } from './config.js';

// 折れ線チャート(canvas)。2px線・ヘアライン格子・十字ホバー+ツールチップ・
// 複数系列は線の末尾に直接ラベル(dataviz流)。
const css = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class LineChart {
  // series: [{key, label, colorVar}], opts: {unit, fixedRange?}
  constructor(holder, series, opts = {}) {
    this.holder = holder;
    this.series = series;
    this.opts = opts;
    this.canvas = document.createElement('canvas');
    this.tip = document.createElement('div');
    this.tip.className = 'tip';
    holder.appendChild(this.canvas);
    holder.appendChild(this.tip);
    this.ctx = this.canvas.getContext('2d');
    this.samples = [];
    this.hoverX = null;

    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hoverX = e.clientX - r.left;
      this._hoverY = e.clientY - r.top;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverX = null;
      this.tip.style.display = 'none';
    });
    new ResizeObserver(() => this._fit()).observe(holder);
    this._fit();
  }

  _fit() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = Math.max(1, this.holder.clientWidth);
    this.h = Math.max(1, this.holder.clientHeight);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
  }

  draw(samples) {
    this.samples = samples;
    const c = this.ctx;
    const dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);

    const padL = 38, padR = 46, padT = 8, padB = 18;
    const pw = this.w - padL - padR, ph = this.h - padT - padB;
    if (pw <= 0 || ph <= 0) return;

    const now = Date.now();
    const t0 = now - CONFIG.windowSec * 1000;
    const x = (t) => padL + ((t - t0) / (now - t0)) * pw;

    // Yレンジ
    let lo = Infinity, hi = -Infinity;
    if (this.opts.fixedRange) [lo, hi] = this.opts.fixedRange;
    else {
      for (const s of samples) for (const sr of this.series) {
        const v = s[sr.key];
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (lo > hi) { lo = 0; hi = 1; }
      const pad = Math.max((hi - lo) * 0.15, 0.5);
      lo -= pad; hi += pad;
    }
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * ph;

    // 格子(ヘアライン)とY目盛
    c.strokeStyle = css('--grid');
    c.fillStyle = css('--muted');
    c.lineWidth = 1;
    c.font = '10px system-ui, sans-serif';
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    const ticks = 3;
    for (let i = 0; i <= ticks; i++) {
      const v = lo + ((hi - lo) * i) / ticks;
      const yy = Math.round(y(v)) + 0.5;
      c.beginPath(); c.moveTo(padL, yy); c.lineTo(padL + pw, yy); c.stroke();
      c.fillText(v.toFixed(Math.abs(hi - lo) < 5 ? 1 : 0), padL - 6, yy);
    }
    // X目盛(相対秒)
    c.textAlign = 'center';
    c.textBaseline = 'top';
    for (const sec of [-120, -90, -60, -30, 0]) {
      if (-sec > CONFIG.windowSec) continue;
      const xx = x(now + sec * 1000);
      c.fillText(sec === 0 ? 'now' : `${sec}s`, xx, padT + ph + 5);
    }

    // 系列(2px線・欠測で線を切る)
    const gap = CONFIG.pollMs * 4;
    for (const sr of this.series) {
      c.strokeStyle = css(sr.colorVar);
      c.lineWidth = 2;
      c.lineJoin = 'round';
      c.beginPath();
      let pen = false, prevT = 0;
      for (const s of samples) {
        const v = s[sr.key];
        if (v == null) { pen = false; continue; }
        if (s.t - prevT > gap) pen = false;
        const xx = x(s.t), yy = y(v);
        pen ? c.lineTo(xx, yy) : c.moveTo(xx, yy);
        pen = true; prevT = s.t;
      }
      c.stroke();

      // 末尾の直接ラベル(複数系列のとき)
      if (this.series.length > 1) {
        let last = null;
        for (let i = samples.length - 1; i >= 0; i--) {
          if (samples[i][sr.key] != null) { last = samples[i]; break; }
        }
        if (last) {
          const xx = x(last.t), yy = y(last[sr.key]);
          c.fillStyle = css(sr.colorVar);
          c.beginPath(); c.arc(xx, yy, 4, 0, Math.PI * 2); c.fill();
          c.fillStyle = css('--ink-2');
          c.textAlign = 'left';
          c.textBaseline = 'middle';
          c.font = '600 10px system-ui, sans-serif';
          c.fillText(sr.label, xx + 8, yy);
        }
      }
    }

    this._drawHover(x, y, padL, padT, pw, ph);
  }

  _drawHover(x, y, padL, padT, pw, ph) {
    if (this.hoverX == null || this.samples.length === 0) return;
    // 最近傍サンプル
    let best = null, bestD = Infinity;
    for (const s of this.samples) {
      const d = Math.abs(x(s.t) - this.hoverX);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best || bestD > 40) { this.tip.style.display = 'none'; return; }

    const c = this.ctx;
    const xx = x(best.t);
    // 縦ヘアライン
    c.strokeStyle = css('--baseline');
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(Math.round(xx) + 0.5, padT);
    c.lineTo(Math.round(xx) + 0.5, padT + ph);
    c.stroke();
    // マーカー(8px + 2pxサーフェスリング)
    let rows = '';
    for (const sr of this.series) {
      const v = best[sr.key];
      if (v == null) continue;
      c.fillStyle = css(sr.colorVar);
      c.strokeStyle = css('--surface');
      c.lineWidth = 2;
      c.beginPath(); c.arc(xx, y(v), 4, 0, Math.PI * 2); c.fill(); c.stroke();
      rows += `<div><span class="sw" style="background:${css(sr.colorVar)}"></span>${sr.label} <b>${v.toFixed(2)}${this.opts.unit || ''}</b></div>`;
    }
    const time = new Date(best.t).toLocaleTimeString('ja-JP');
    this.tip.innerHTML = `<div style="margin-bottom:2px">${time}</div>${rows}`;
    this.tip.style.display = 'block';
    const left = Math.min(xx + 12, this.w - this.tip.offsetWidth - 4);
    this.tip.style.left = left + 'px';
    this.tip.style.top = Math.max(4, (this._hoverY ?? 0) - this.tip.offsetHeight - 10) + 'px';
  }
}
