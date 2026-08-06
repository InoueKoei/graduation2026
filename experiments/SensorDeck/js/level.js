// 水準器: 傾きベクトル(ax, ay)を気泡で見せる。TiltFluidの向き合わせにも使える。
const css = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class BubbleLevel {
  constructor(holder) {
    this.holder = holder;
    this.canvas = document.createElement('canvas');
    holder.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
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

  // ax, ay: -1..1(g)。nullならMPU無しの表示
  draw(ax, ay) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    const cx = this.w / 2, cy = this.h / 2;
    const R = Math.min(this.w, this.h) / 2 - 14;

    // リング: 1g(外周)・0.5g・0.25g
    c.lineWidth = 1;
    for (const g of [1, 0.5, 0.25]) {
      c.strokeStyle = g === 1 ? css('--baseline') : css('--grid');
      c.beginPath(); c.arc(cx, cy, R * g, 0, Math.PI * 2); c.stroke();
    }
    // 十字
    c.strokeStyle = css('--grid');
    c.beginPath();
    c.moveTo(cx - R, cy); c.lineTo(cx + R, cy);
    c.moveTo(cx, cy - R); c.lineTo(cx, cy + R);
    c.stroke();
    // 目盛ラベル
    c.fillStyle = css('--muted');
    c.font = '10px system-ui, sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText('1g', cx + R * 0.72, cy + R * 0.72);

    if (ax == null) {
      c.fillStyle = css('--muted');
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '12px system-ui, sans-serif';
      c.fillText('MPU-6050 未接続', cx, cy);
      return;
    }

    // 気泡(14px・2pxサーフェスリング)。クランプして外周から出さない
    const mag = Math.hypot(ax, ay);
    const k = mag > 1 ? 1 / mag : 1;
    const bx = cx + ax * k * R;
    const by = cy + ay * k * R;
    c.fillStyle = css('--series-1');
    c.strokeStyle = css('--surface');
    c.lineWidth = 2;
    c.beginPath(); c.arc(bx, by, 7, 0, Math.PI * 2); c.fill(); c.stroke();

    // 中心からの糸
    c.strokeStyle = css('--series-1');
    c.globalAlpha = 0.35;
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(bx, by); c.stroke();
    c.globalAlpha = 1;
  }
}
