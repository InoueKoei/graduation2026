// 上から見た足跡トラックを描く。
//
// MVP でやるのは「軌跡が線として出る」ところまで。
// 立脚時間や接地衝撃で足形の色や濃さを変える演出は入れない（それはモードBの領分で、
// 先に混ぜると線が正しく出ているかを確かめにくくなる）。

const FOOT_LEN = 0.26;   // 足形グリフの実寸 m
const FOOT_W   = 0.095;

class View {
  constructor(canvas, track) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;
    this.scale = 120;            // px / m
    this.ox = 0; this.oy = 0;    // 画面中央が指すワールド座標
    this.autoFit = true;
    this._bindPan();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = devicePixelRatio || 1;
    this.w = innerWidth; this.h = innerHeight;
    this.cv.width = this.w * dpr;
    this.cv.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _bindPan() {
    let dragging = false, lx = 0, ly = 0;
    this.cv.addEventListener('pointerdown', e => {
      dragging = true; lx = e.clientX; ly = e.clientY;
      this.autoFit = false;
      this.cv.classList.add('drag');
      this.cv.setPointerCapture(e.pointerId);
    });
    this.cv.addEventListener('pointermove', e => {
      if (!dragging) return;
      this.ox -= (e.clientX - lx) / this.scale;
      this.oy += (e.clientY - ly) / this.scale;
      lx = e.clientX; ly = e.clientY;
    });
    const end = () => { dragging = false; this.cv.classList.remove('drag'); };
    this.cv.addEventListener('pointerup', end);
    this.cv.addEventListener('pointercancel', end);
    this.cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.autoFit = false;
      const k = Math.exp(-e.deltaY * 0.0015);
      this.scale = Math.min(600, Math.max(12, this.scale * k));
    }, { passive: false });
  }

  fit() {
    this.autoFit = true;
    const b = this.track.bounds();
    if (!b) { this.ox = 0; this.oy = 0; this.scale = 120; return; }
    const pad = 0.6;
    const w = (b.x1 - b.x0) + pad * 2, h = (b.y1 - b.y0) + pad * 2;
    this.ox = (b.x0 + b.x1) / 2;
    this.oy = (b.y0 + b.y1) / 2;
    this.scale = Math.min(600, Math.max(12,
      Math.min(this.w / Math.max(w, 0.5), (this.h - this._chrome()) / Math.max(h, 0.5))));
  }

  // 上のヘッダと下のバーに隠れるぶんを実測して、fit の余白に使う
  _chrome() {
    const bar = document.getElementById('bar');
    return (bar ? bar.offsetHeight : 56) + 76;
  }

  sx(x) { return this.w / 2 + (x - this.ox) * this.scale; }
  sy(y) { return this.h / 2 - (y - this.oy) * this.scale; }

  draw() {
    if (this.autoFit && this.track.contacts.length) this.fit();
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    this._grid(g);
    this._line(g);
    this._contacts(g);
    this._live(g);
    this._scaleBar(g);
  }

  _grid(g) {
    // 1m 方眼。細かすぎるときは間引く
    let step = 1;
    while (step * this.scale < 46) step *= 2;
    const x0 = Math.floor((this.ox - this.w / 2 / this.scale) / step) * step;
    const x1 = this.ox + this.w / 2 / this.scale;
    const y0 = Math.floor((this.oy - this.h / 2 / this.scale) / step) * step;
    const y1 = this.oy + this.h / 2 / this.scale;

    g.lineWidth = 1;
    g.strokeStyle = '#e6e2d8';
    g.beginPath();
    for (let x = x0; x <= x1; x += step) { g.moveTo(this.sx(x), 0); g.lineTo(this.sx(x), this.h); }
    for (let y = y0; y <= y1; y += step) { g.moveTo(0, this.sy(y)); g.lineTo(this.w, this.sy(y)); }
    g.stroke();

    // 原点（構えの位置）
    const ox = this.sx(0), oy = this.sy(0);
    g.strokeStyle = '#cbc6ba';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(ox - 11, oy); g.lineTo(ox + 11, oy);
    g.moveTo(ox, oy - 11); g.lineTo(ox, oy + 11);
    g.stroke();
  }

  _line(g) {
    const p = this.track.line();
    if (p.length < 2) return;
    g.strokeStyle = '#2b2a33';
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    p.forEach((q, i) => i ? g.lineTo(this.sx(q.x), this.sy(q.y)) : g.moveTo(this.sx(q.x), this.sy(q.y)));
    g.stroke();
  }

  _footPath(g, x, y, yaw, isLeft) {
    // 進行方向を +x とした足形。左右は横方向に反転させる。
    const pts = [
      [ 0.130,  0.000], [ 0.112,  0.036], [ 0.060,  0.047], [-0.020,  0.039],
      [-0.090,  0.041], [-0.130,  0.026], [-0.130, -0.026], [-0.090, -0.038],
      [-0.020, -0.034], [ 0.060, -0.042], [ 0.112, -0.033],
    ];
    const k = FOOT_LEN / 0.26, m = (FOOT_W / 0.095) * (isLeft ? 1 : -1);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    g.beginPath();
    pts.forEach(([px, py], i) => {
      const ax = px * k, ay = py * m;
      const wx = x + ax * c - ay * s;
      const wy = y + ax * s + ay * c;
      i ? g.lineTo(this.sx(wx), this.sy(wy)) : g.moveTo(this.sx(wx), this.sy(wy));
    });
    g.closePath();
  }

  _contacts(g) {
    const cs = this.track.contacts;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const isL = c.foot === 'L';
      const col = isL ? '#3b5b8c' : '#b4472f';
      const latest = i >= cs.length - 2;
      this._footPath(g, c.x, c.y, c.yaw, isL);
      g.fillStyle = latest ? col + '33' : col + '14';
      g.fill();
      g.strokeStyle = col;
      g.lineWidth = latest ? 1.6 : 1;
      g.stroke();
    }
  }

  _live(g) {
    for (const foot of ['L', 'R']) {
      const p = this.track.pose[foot];
      if (!p || p.x === undefined) continue;
      const isL = foot === 'L';
      const col = isL ? '#3b5b8c' : '#b4472f';
      const x = this.sx(p.x), y = this.sy(p.y);
      g.beginPath();
      g.arc(x, y, p.state === 'stance' ? 4 : 6, 0, Math.PI * 2);
      g.fillStyle = p.state === 'stance' ? col : 'transparent';
      g.strokeStyle = col;
      g.lineWidth = 1.6;
      if (p.state === 'stance') g.fill(); else g.stroke();
    }
  }

  _scaleBar(g) {
    let m = 1;
    while (m * this.scale > 220) m /= 2;
    while (m * this.scale < 60) m *= 2;
    const px = m * this.scale;
    const bar = document.getElementById('bar');
    const x = 22, y = this.h - (bar ? bar.offsetHeight : 56) - 24;
    g.strokeStyle = '#b3afa3';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y - 4); g.lineTo(x, y); g.lineTo(x + px, y); g.lineTo(x + px, y - 4);
    g.stroke();
    g.fillStyle = '#b3afa3';
    g.font = '10px "Hiragino Sans", sans-serif';
    g.fillText(m >= 1 ? `${m} m` : `${m * 100} cm`, x + px + 6, y);
  }
}
