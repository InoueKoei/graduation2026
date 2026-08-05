import { CONFIG } from './config.js';

// 同じ動きデータ(state)を、4つの抽象で描き分ける小さなビュー群。
// state = { tilt:{x,y}, roll, mag, shake, t }
//   roll  : 傾きの向き(rad)  mag: 傾きの強さ(0..1)  shake: 揺れの余韻(0..1)

const ink = () => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
const muted = () => getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();

class View {
  constructor(cell) {
    this.canvas = document.createElement('canvas');
    cell.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    new ResizeObserver(() => this._fit(cell)).observe(cell);
    this._fit(cell);
  }
  _fit(cell) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = Math.max(1, cell.clientWidth);
    this.h = Math.max(1, cell.clientHeight);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
  }
  _begin() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    return c;
  }
}

// ─── 水平: 傾きで回る一本の地平線 ───────────────────
export class Horizon extends View {
  draw(s) {
    const c = this._begin();
    const cx = this.w / 2, cy = this.h / 2;
    const L = Math.hypot(this.w, this.h);   // 画面を必ず貫く長さ
    // 傾きベクトルと直交する線 = 水面
    const a = s.roll + Math.PI / 2;
    // 揺れでわずかに震える
    const jx = (Math.random() - 0.5) * s.shake * 6;
    const jy = (Math.random() - 0.5) * s.shake * 6;
    c.strokeStyle = ink();
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * L + jx, cy + Math.sin(a) * L + jy);
    c.lineTo(cx - Math.cos(a) * L + jx, cy - Math.sin(a) * L + jy);
    c.stroke();
    // 水面下をごく薄く染めて上下をわからせる
    c.save();
    c.translate(cx, cy);
    c.rotate(a);
    c.fillStyle = ink();
    c.globalAlpha = 0.05 + s.mag * 0.06;
    c.fillRect(-L, 0, L * 2, L);
    c.restore();
  }
}

// ─── 錘: 重力に引かれる点と、その軌跡 ─────────────────
export class Plumb extends View {
  constructor(cell) {
    super(cell);
    this.trail = [];
  }
  draw(s) {
    const c = this._begin();
    const cx = this.w / 2, cy = this.h / 2;
    const R = Math.min(this.w, this.h) * 0.36;
    const x = cx + s.tilt.x * R;
    const y = cy + s.tilt.y * R;

    this.trail.push({ x, y });
    if (this.trail.length > CONFIG.trailLength) this.trail.shift();

    // 軌跡: 古いほど薄く
    c.strokeStyle = ink();
    c.lineWidth = 1;
    for (let i = 1; i < this.trail.length; i++) {
      c.globalAlpha = (i / this.trail.length) * 0.5;
      c.beginPath();
      c.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
      c.lineTo(this.trail[i].x, this.trail[i].y);
      c.stroke();
    }
    c.globalAlpha = 1;

    // 中心の座と錘
    c.fillStyle = muted();
    c.beginPath(); c.arc(cx, cy, 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = ink();
    c.beginPath(); c.arc(x, y, 5 + s.shake * 6, 0, Math.PI * 2); c.fill();
  }
}

// ─── 環: 静けさで細く整い、揺れで太く荒れる円 ─────────────
export class Ring extends View {
  constructor(cell) {
    super(cell);
    this.phase = Math.random() * 100;
  }
  draw(s, dt) {
    const c = this._begin();
    const cx = this.w / 2, cy = this.h / 2;
    const R = Math.min(this.w, this.h) * 0.3;
    this.phase += dt * (0.6 + s.shake * 5);

    c.strokeStyle = ink();
    c.lineWidth = 1 + s.shake * 10;
    c.beginPath();
    const N = 90;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      // 揺れに応じて輪郭が波立つ(3つの正弦の重ね)
      const wob =
        Math.sin(th * 3 + this.phase * 2.1) * 0.5 +
        Math.sin(th * 5 - this.phase * 1.3) * 0.3 +
        Math.sin(th * 8 + this.phase * 3.7) * 0.2;
      const r = R * (1 + wob * s.shake * 0.35);
      const x = cx + Math.cos(th) * r;
      const y = cy + Math.sin(th) * r;
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.closePath();
    c.stroke();
  }
}

// ─── 場: 重力方向へ一斉になびく短いストロークの草原 ──────────
export class Field extends View {
  draw(s) {
    const c = this._begin();
    const N = CONFIG.fieldGrid;
    const stepX = this.w / (N + 1);
    const stepY = this.h / (N + 1);
    const len = Math.min(stepX, stepY) * (0.12 + s.mag * 0.62);
    const a = s.roll;

    c.strokeStyle = ink();
    c.lineWidth = 1.5;
    c.lineCap = 'round';
    for (let i = 1; i <= N; i++) {
      for (let j = 1; j <= N; j++) {
        const x = stepX * i, y = stepY * j;
        if (s.mag < 0.03) {
          // 完全な静止: 点の格子に還る
          c.beginPath(); c.arc(x, y, 1.2, 0, Math.PI * 2);
          c.fillStyle = ink(); c.fill();
        } else {
          c.beginPath();
          c.moveTo(x - Math.cos(a) * len * 0.2, y - Math.sin(a) * len * 0.2);
          c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
          c.stroke();
        }
      }
    }
  }
}
