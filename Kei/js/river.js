import { CONFIG } from './config.js';

// 川: 岩の列を生成して流す係。
// 次の隙間は「筆先が横移動で届く範囲」に必ず収める = 理不尽な死が出ない。
export class River {
  constructor() {
    this.rows = [];        // {y, gapX, gapW}
    this.nextY = 0;
  }

  reset(w, h) {
    this.rows = [];
    this.lastGapX = w / 2;
    // 列は上へ向かって(yが減る方向へ)積んでいき、流れると下へ降りてくる。
    // 最初の列は筆先の十分手前に置く(出だしで詰まないように)
    this.nextY = h * CONFIG.brushY - 300;
    this._spawn(w, CONFIG.gapStart, CONFIG.speedStart, w / 2);  // 1列目は正面に置く
    while (this.nextY > -CONFIG.rowGap) this._spawn(w, CONFIG.gapStart, CONFIG.speedStart);
  }

  _spawn(w, gapW, speed, forceX) {
    // 1列進む間に横移動できる距離から、ずらせる幅を決める
    const travelTime = CONFIG.rowGap / Math.max(speed, 1);
    const reach = CONFIG.steerSpeed * travelTime * CONFIG.reachMargin;
    const half = gapW / 2;
    const lo = Math.max(half + 8, this.lastGapX - reach);
    const hi = Math.min(w - half - 8, this.lastGapX + reach);
    const gapX = forceX != null
      ? forceX
      : (lo >= hi ? (lo + hi) / 2 : lo + Math.random() * (hi - lo));
    this.rows.push({ y: this.nextY, gapX, gapW, passed: false });
    this.lastGapX = gapX;
    this.nextY -= CONFIG.rowGap;
  }

  // dt=秒。scroll=1フレームで流れる距離
  update(dt, scroll, w, h, gapW, speed) {
    for (const r of this.rows) r.y += scroll;
    this.nextY += scroll;
    while (this.nextY > -CONFIG.rowGap) this._spawn(w, gapW, speed);
    this.rows = this.rows.filter(r => r.y < h + 80);
  }

  // 筆先(bx,by,br)が岩に当たっているか。
  // 列は「隙間の外side全部が岩」の帯。縦に重なっていて、かつ隙間から出ていれば当たり。
  hits(bx, by, br) {
    const band = CONFIG.rockR * 0.8 + br * 0.7;
    for (const r of this.rows) {
      if (Math.abs(r.y - by) > band) continue;
      const half = r.gapW / 2;
      const insideGap = (bx - br * 0.7) > (r.gapX - half) && (bx + br * 0.7) < (r.gapX + half);
      if (!insideGap) return true;
    }
    return false;
  }

  draw(c, w, css) {
    const ink = css('--rock');
    c.fillStyle = ink;
    for (const r of this.rows) {
      const half = r.gapW / 2;
      // 左右の岩を、丸を並べて「岩肌」に見せる
      this._rockBand(c, 0, r.gapX - half, r.y, r.gapX * 0.017);
      this._rockBand(c, r.gapX + half, w, r.y, r.gapX * 0.013);
    }
  }

  _rockBand(c, x0, x1, y, seed) {
    const R = CONFIG.rockR;
    if (x1 - x0 < 4) return;
    const step = R * 0.95;
    for (let x = x0; x < x1; x += step) {
      const n = Math.sin((x + seed * 130) * 0.07) * 0.5 + Math.sin(x * 0.021 + seed) * 0.5;
      const rr = R * (0.62 + Math.abs(n) * 0.42);
      const oy = n * R * 0.42;
      c.beginPath();
      c.arc(Math.min(x, x1), y + oy, rr, 0, Math.PI * 2);
      c.fill();
    }
  }
}
