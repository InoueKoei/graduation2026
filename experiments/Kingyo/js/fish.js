import { CONFIG } from './config.js';

// 金魚。ふらふら泳ぎ、ポイが近づくと散る。
// すくわれると poi に乗って運ばれ、水から出ると跳ねて暴れる(=紙への負荷)。
export class Fish {
  constructor(w, h) {
    this.reset(w, h);
    this.kind = Math.random();          // 見た目のばらつき(赤/出目金/白)
    this.phase = Math.random() * 10;
  }

  reset(w, h) {
    this.x = 40 + Math.random() * (w - 80);
    this.y = 40 + Math.random() * (h - 80);
    this.a = Math.random() * Math.PI * 2;   // 向き
    this.v = CONFIG.fishSpeed * (0.7 + Math.random() * 0.6);
    this.caught = false;                 // ポイの上に乗っている
    this.scored = false;                 // 器に入った
    this.panic = 0;
    this.flop = 0;                       // 水から出たときの暴れ
  }

  update(dt, w, h, poi) {
    this.phase += dt * (3 + this.v * 0.02);

    if (this.scored) return;

    if (this.caught) {
      // ポイに乗って運ばれる(少しずれてついてくる)
      this.x += (poi.x + this.offx - this.x) * Math.min(1, 12 * dt);
      this.y += (poi.y + this.offy - this.y) * Math.min(1, 12 * dt);
      // 水から出るほど激しく跳ねる
      this.flop = poi.lift;
      this.a += Math.sin(this.phase * 9) * this.flop * dt * 6;
      return;
    }

    // ポイから逃げる。ただし「近い」だけでは逃げない。
    // 急に動かした時だけ散る = そっと近づければ真下に入れる。
    const dx = this.x - poi.x, dy = this.y - poi.y;
    const d = Math.hypot(dx, dy);
    const scare = CONFIG.fearRadius * (0.35 + (1 - poi.lift) * 0.65);
    const poiSpeed = Math.hypot(poi.vx, poi.vy);
    const startled = poiSpeed > CONFIG.startleSpeed || poi.lift > 0.2;
    if (d < scare && startled) {
      this.panic = 1;
      const away = Math.atan2(dy, dx);
      // 角度を逃走方向へ寄せる
      let diff = away - this.a;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.a += diff * Math.min(1, 8 * dt);
    } else {
      this.panic = Math.max(0, this.panic - dt * CONFIG.panicDecay);
      // ふらふら
      this.a += Math.sin(this.phase * 0.7) * CONFIG.wanderTurn * dt;
    }

    const speed = CONFIG.fishSpeed + this.panic * (CONFIG.fishDart - CONFIG.fishSpeed);
    this.x += Math.cos(this.a) * speed * dt;
    this.y += Math.sin(this.a) * speed * dt;

    // 壁で反射(池の縁)
    const m = 18;
    if (this.x < m) { this.x = m; this.a = Math.PI - this.a; }
    if (this.x > w - m) { this.x = w - m; this.a = Math.PI - this.a; }
    if (this.y < m) { this.y = m; this.a = -this.a; }
    if (this.y > h - m) { this.y = h - m; this.a = -this.a; }
  }

  // 尾を振りながら泳ぐ姿を描く
  draw(c, css) {
    if (this.scored) return;
    const L = CONFIG.fishLen;
    const swim = Math.sin(this.phase * (this.caught ? 14 : 5));
    c.save();
    c.translate(this.x, this.y);
    c.rotate(this.a + swim * 0.12 * (1 + this.flop * 2));

    const red = this.kind < 0.6;
    const black = this.kind > 0.88;
    c.fillStyle = black ? css('--fish-black') : red ? css('--fish-red') : css('--fish-white');

    // 尾びれ
    c.beginPath();
    c.moveTo(-L * 0.45, 0);
    c.quadraticCurveTo(-L * 0.9, swim * L * 0.32 - L * 0.2, -L * 0.95, swim * L * 0.5);
    c.quadraticCurveTo(-L * 0.7, 0, -L * 0.95, -swim * L * 0.5 + L * 0.05);
    c.quadraticCurveTo(-L * 0.9, swim * L * 0.32 - L * 0.2, -L * 0.45, 0);
    c.globalAlpha = 0.75;
    c.fill();
    c.globalAlpha = 1;

    // 体
    c.beginPath();
    c.ellipse(0, 0, L * 0.5, L * 0.27, 0, 0, Math.PI * 2);
    c.fill();

    // 目
    c.fillStyle = css('--ink');
    const eo = black ? L * 0.3 : L * 0.26;
    c.beginPath(); c.arc(L * 0.3, -eo * 0.35, black ? 2.6 : 1.8, 0, Math.PI * 2); c.fill();
    c.restore();
  }
}
