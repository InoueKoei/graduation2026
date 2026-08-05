import { CONFIG } from './config.js';
import { Fish } from './fish.js';
import { Poi } from './poi.js';

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export class Kingyo {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.poi = new Poi();
    this.ripples = [];
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
    this.bowl = {
      x: this.w * CONFIG.bowlX,
      y: this.h * CONFIG.bowlY,
      r: CONFIG.bowlR,
    };
    if (!this.fish) return;
  }

  reset() {
    this.fish = [];
    for (let i = 0; i < CONFIG.fishCount; i++) this.fish.push(new Fish(this.w, this.h));
    this.poi.reset();
    this.poi.x = this.w / 2;
    this.poi.y = this.h / 2;
    this.poiLeft = CONFIG.poiCount;
    this.score = 0;
    this.time = 0;
    this.over = false;
    this.ripples = [];
    this.msg = '';
    this.msgT = 0;
    this.breakDelay = 0;   // 破れてからポイを交換するまでの間
  }

  _say(text) { this.msg = text; this.msgT = 1.6; }

  nextPoi() {
    if (this.poiLeft <= 1) {
      this.poiLeft = 0;
      this.over = true;
    } else {
      this.poiLeft--;
      this.poi.reset();
      this._say('やぶれた');
    }
  }

  // dt=秒, target={x,y}, lifting=bool
  step(dt, target, lifting) {
    if (this.over) return;
    this.time += dt;
    if (this.msgT > 0) this.msgT -= dt;

    const wasBroken = this.poi.broken;
    const carried = this.fish.filter(f => f.caught && !f.scored);
    this.poi.update(dt, target, lifting, carried.length);

    // 破れた瞬間: 乗っていた魚を落とす
    if (this.poi.broken && !wasBroken) {
      for (const f of carried) {
        f.caught = false;
        f.panic = 1;
        f.a = Math.random() * Math.PI * 2;
      }
      this._ripple(this.poi.x, this.poi.y, 1);
      this.breakDelay = 0.7;
    }
    // 破れた紙を見せてから次のポイへ(setTimeoutだとリセットを跨いで発火するのでループ内で)
    if (this.breakDelay > 0) {
      this.breakDelay -= dt;
      if (this.breakDelay <= 0) this.nextPoi();
    }

    // すくう判定
    if (this.poi.canCatch()) {
      for (const f of this.fish) {
        if (f.caught || f.scored) continue;
        const d = Math.hypot(f.x - this.poi.x, f.y - this.poi.y);
        if (d < CONFIG.poiRadius - 8) {
          f.caught = true;
          f.offx = f.x - this.poi.x;
          f.offy = f.y - this.poi.y;
        }
      }
    }

    // 水中に戻すと魚は逃げる(=持ち上げきらないと取れない)
    if (this.poi.lift < 0.12) {
      for (const f of this.fish) {
        if (f.caught && Math.random() < dt * 1.4) {
          f.caught = false;
          f.panic = 1;
        }
      }
    }

    // 器に入れる: 持ち上げた状態で器の上へ
    if (this.poi.isOut) {
      const d = Math.hypot(this.poi.x - this.bowl.x, this.poi.y - this.bowl.y);
      if (d < this.bowl.r) {
        for (const f of this.fish) {
          if (f.caught && !f.scored) {
            f.scored = true;
            f.caught = false;
            this.score++;
            this._say('すくえた');
          }
        }
      }
    }

    for (const f of this.fish) f.update(dt, this.w, this.h, this.poi);

    // 水面の波紋: ポイの出入りで立つ
    if (Math.random() < Math.hypot(this.poi.vx, this.poi.vy) * dt * 0.006) {
      this._ripple(this.poi.x, this.poi.y, 0.4);
    }
    for (const r of this.ripples) { r.r += 60 * dt; r.a -= dt * 0.9; }
    this.ripples = this.ripples.filter(r => r.a > 0);

    // 全部すくったら勝ち
    if (this.fish.every(f => f.scored)) this.over = true;
  }

  _ripple(x, y, a) { this.ripples.push({ x, y, r: 6, a }); }

  render() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);

    // 水
    const g = c.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, css('--water-1'));
    g.addColorStop(1, css('--water-2'));
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);

    // 波紋
    c.strokeStyle = css('--ripple');
    c.lineWidth = 1;
    for (const r of this.ripples) {
      c.globalAlpha = Math.max(0, r.a) * 0.5;
      c.beginPath(); c.arc(r.x, r.y, r.r, 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;

    // 器(すくった金魚を入れる)
    const b = this.bowl;
    c.fillStyle = css('--bowl');
    c.globalAlpha = 0.55;
    c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
    c.strokeStyle = css('--bowl-rim');
    c.lineWidth = 2.5;
    c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.stroke();
    // 器の中の金魚
    const got = this.fish.filter(f => f.scored);
    c.fillStyle = css('--fish-red');
    for (let i = 0; i < got.length; i++) {
      const a = i * 1.9 + this.time * 0.6;
      const rr = b.r * 0.45 * (0.4 + (i % 3) * 0.25);
      c.beginPath();
      c.ellipse(b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr, 7, 3.6, a, 0, Math.PI * 2);
      c.fill();
    }

    // 魚 → ポイ の順(ポイが上に重なる)
    for (const f of this.fish) f.draw(c, css);
    this.poi.draw(c, css);
  }
}
