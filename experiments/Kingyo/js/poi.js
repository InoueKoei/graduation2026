import { CONFIG } from './config.js';

// ポイ(紙の器)。このゲームの心臓部。
// 紙は「水中では平気、引き上げる時に破れる」。だから
//   破れ = 濡れ具合^n × (魚の荷重 + 動きの速さ) × 水から出ている度合い
// で効かせる。そっと沈め、そっと持ち上げるのが正解になる。
export class Poi {
  constructor() {
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.lift = 0;        // 0=水中, 1=完全に水上
    this.wet = 0;         // 0=乾いてる, 1=ふやけてる
    this.tear = 0;        // 0=無傷, 1=破れた
    this.broken = false;
    this.tearSeed = Math.random() * 100;
  }

  reset() {
    this.wet = 0; this.tear = 0; this.broken = false;
    this.lift = 0;
    this.tearSeed = Math.random() * 100;
  }

  // dt=秒, target={x,y}=傾きから決まる目標位置, lifting=持ち上げ入力(bool), load=乗ってる魚の数
  update(dt, target, lifting, load) {
    // 位置: 目標へ向かうが、水中の器なので速度に上限がある。
    // (上限を設けないと傾け切った瞬間に極端な速度が出て、即破れ+操作が過敏になる)
    const px = this.x, py = this.y;
    const dx = target.x - this.x, dy = target.y - this.y;
    const dist = Math.hypot(dx, dy);
    const follow = (this.lift > 0.5 ? 9 : 5);       // 近づくほど減速する自然な寄り方
    const wanted = Math.min(dist * follow, CONFIG.poiMaxSpeed * (this.lift > 0.5 ? 1.1 : 1));
    if (dist > 0.01) {
      const stepLen = Math.min(dist, wanted * dt);
      this.x += (dx / dist) * stepLen;
      this.y += (dy / dist) * stepLen;
    }
    this.vx = (this.x - px) / Math.max(dt, 0.001);
    this.vy = (this.y - py) / Math.max(dt, 0.001);
    const speed = Math.hypot(this.vx, this.vy);

    // 上下: 押している間だけ持ち上がる
    const dir = lifting ? 1 : -1;
    this.lift = Math.max(0, Math.min(1, this.lift + dir * CONFIG.liftSpeed * dt));

    // 濡れ/乾き
    if (this.lift < 0.5) this.wet = Math.min(1, this.wet + CONFIG.wetRate * dt);
    else this.wet = Math.max(0, this.wet - CONFIG.dryRate * dt);

    if (this.broken) return;

    // 破れ: 濡れているほど脆い。水から出ている間だけ荷重がかかる
    const fragile = Math.pow(this.wet, CONFIG.tearWetPower);
    const lifted = Math.max(0, this.lift - 0.15);          // 水中では負荷ゼロ
    const loadForce = load * CONFIG.tearFromLoad * lifted;
    // ゆっくり動かす分には破れない。水を切るような急な動きだけが効く
    const excess = Math.max(0, speed - CONFIG.tearSpeedFree);
    const dragForce = excess * CONFIG.tearFromSpeed * (this.lift < 0.5 ? 1 : 0.35);
    const stress = fragile * (loadForce + dragForce);
    if (stress > 0) this.tear = Math.min(1, this.tear + stress * dt);
    if (this.tear >= 1) this.broken = true;
  }

  // すくえる判定: 水中〜浅い位置で魚と重なっていること
  canCatch() { return !this.broken && this.lift < 0.45; }

  // 完全に水から出た(=すくい上げ成功の高さ)
  get isOut() { return this.lift >= CONFIG.scoopHeight; }

  draw(c, css) {
    const R = CONFIG.poiRadius;
    c.save();
    c.translate(this.x, this.y);

    // 持ち上げるほど大きく見える(近づく)+影
    const s = 1 + this.lift * 0.16;
    if (this.lift > 0.05) {
      c.globalAlpha = 0.10 * this.lift;
      c.fillStyle = css('--ink');
      c.beginPath(); c.ellipse(4 * this.lift, 8 * this.lift, R * 0.95, R * 0.95, 0, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
    }
    c.scale(s, s);

    // 枠(赤い輪)
    c.strokeStyle = css('--poi-frame');
    c.lineWidth = 4;
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.stroke();
    // 柄
    c.lineWidth = 5;
    c.beginPath(); c.moveTo(R * 0.72, R * 0.72); c.lineTo(R * 1.5, R * 1.5); c.stroke();

    if (!this.broken) {
      // 紙: 濡れるほど透けて色づく
      c.fillStyle = css('--poi-paper');
      c.globalAlpha = 0.30 + this.wet * 0.34;
      c.beginPath(); c.arc(0, 0, R - 2, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;

      // 破れかけの亀裂(tearが進むほど伸びる)
      if (this.tear > 0.06) {
        c.strokeStyle = css('--poi-frame');
        c.globalAlpha = 0.55;
        c.lineWidth = 1.2;
        const cracks = 3;
        for (let i = 0; i < cracks; i++) {
          const a = this.tearSeed + i * 2.3;
          const len = R * this.tear * (0.7 + (i % 3) * 0.15);
          c.beginPath();
          c.moveTo(0, 0);
          let px = 0, py = 0;
          const steps = 5;
          for (let k = 1; k <= steps; k++) {
            const t = (k / steps) * len;
            px = Math.cos(a + Math.sin(k * 1.7 + this.tearSeed) * 0.4) * t;
            py = Math.sin(a + Math.sin(k * 1.7 + this.tearSeed) * 0.4) * t;
            c.lineTo(px, py);
          }
          c.stroke();
        }
        c.globalAlpha = 1;
      }
    } else {
      // 破れた紙: 縁だけ残る
      c.strokeStyle = css('--poi-frame');
      c.globalAlpha = 0.5;
      c.lineWidth = 1.2;
      c.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const r = (R - 4) * (0.55 + Math.sin(a * 4 + this.tearSeed) * 0.16);
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.closePath();
      c.stroke();
      c.globalAlpha = 1;
    }
    c.restore();
  }
}
