import { CONFIG } from './config.js';
import { River } from './river.js';

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// 渓: 筆先が川を下る。傾けて岩を避けるだけ。
// 通った跡は一本の線として残り、死ぬと「書いた線」が作品になる。
export class Kei {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.river = new River();
    this._fit();
    new ResizeObserver(() => this._fit()).observe(canvas.parentElement);
    this.reset();
  }

  _fit() {
    const el = this.canvas.parentElement;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = Math.max(1, el.clientWidth);
    this.h = Math.max(1, el.clientHeight);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.by = this.h * CONFIG.brushY;
  }

  reset() {
    this.bx = this.w / 2;
    this.vx = 0;
    this.speed = CONFIG.speedStart;
    this.gapW = CONFIG.gapStart;
    this.dist = 0;
    this.time = 0;
    this.over = false;
    this.stroke = [];            // 画面上に残る軌跡(スクロールと一緒に流れる)
    this.river.reset(this.w, this.h);
    this.splash = 0;
  }

  // dt=秒, steer=-1..1(傾き)
  step(dt, steer) {
    if (this.over) {
      // 死んだあとも軌跡だけは流れて、線の全体が見えるようにする
      const scroll = this.speed * dt * 0.35;
      for (const p of this.stroke) p.y += scroll;
      this.splash = Math.min(1, this.splash + dt * 3);
      return;
    }
    this.time += dt;
    this.speed = Math.min(CONFIG.speedMax, CONFIG.speedStart + CONFIG.speedGain * this.time);
    this.gapW = Math.max(CONFIG.gapMin, CONFIG.gapStart - CONFIG.gapShrink * this.time);

    // 横移動: 傾きが「行きたい位置」を決め、速度上限つきで寄っていく
    const targetX = this.w / 2 + steer * (this.w / 2 - 30);
    const dx = targetX - this.bx;
    const wanted = Math.max(-CONFIG.steerSpeed, Math.min(CONFIG.steerSpeed, dx * CONFIG.steerEase));
    this.vx += (wanted - this.vx) * Math.min(1, 12 * dt);
    this.bx += this.vx * dt;
    this.bx = Math.max(14, Math.min(this.w - 14, this.bx));

    const scroll = this.speed * dt;
    this.dist += scroll;

    // 軌跡を記録(座標は画面上。スクロールで下へ流す)
    for (const p of this.stroke) p.y += scroll;
    this.stroke.push({ x: this.bx, y: this.by, v: Math.abs(this.vx) });
    if (this.stroke.length > CONFIG.strokeMax) this.stroke.shift();

    this.river.update(dt, scroll, this.w, this.h, this.gapW, this.speed);

    if (this.river.hits(this.bx, this.by, CONFIG.brushR)) this.over = true;
  }

  render() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);

    // 紙
    c.fillStyle = css('--paper');
    c.fillRect(0, 0, this.w, this.h);

    // 岩
    this.river.draw(c, this.w, css);

    // 軌跡: 速く振ったところは細く掠れ、ゆっくりのところは太い
    const ink = css('--ink');
    c.strokeStyle = ink;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (let i = 1; i < this.stroke.length; i++) {
      const a = this.stroke[i - 1], b = this.stroke[i];
      const t = i / this.stroke.length;
      const wide = 7 - Math.min(5.2, b.v * 0.011);
      c.globalAlpha = 0.10 + t * 0.85;
      c.lineWidth = Math.max(1.2, wide);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
    c.globalAlpha = 1;

    // 筆先
    if (!this.over) {
      c.fillStyle = ink;
      c.beginPath();
      c.arc(this.bx, this.by, CONFIG.brushR, 0, Math.PI * 2);
      c.fill();
    } else {
      // ぶつかった跡: 墨が飛ぶ
      c.fillStyle = ink;
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4;
        const r = this.splash * (14 + (i % 5) * 13);
        c.globalAlpha = (1 - this.splash) * 0.7;
        c.beginPath();
        c.arc(this.bx + Math.cos(a) * r, this.by + Math.sin(a) * r, 2 + (i % 3), 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    }
  }
}
