// ボールの物理。円 1 個 vs 静的な折れ線の壁。
//
// 積分の書き方は experiments/Sumi/js/game.js:66-74（皿の中の墨玉）をそのまま一般化した。
// あちらは「皿の縁 = 円」だったので距離 1 回で済んでいたが、こちらは壁が文字の輪郭なので
// 最近傍の線分を探すところだけが増える。
//
// ★ 内向き法線をリングの向きから先に決めておく
//   毎フレーム「ボールは塗りの内側にいるか」を数えると、壁の総点数 (1000〜3000) に
//   比例したコストがサブステップの回数だけ掛かる。そうではなく、
//   リングの符号つき面積から各線分の内向き法線を 1 回だけ求めておく。
//   カウンター（穴）のリングは向きが逆なので、同じ規則のまま「穴の外へ押し出す」になる。
//   外側 / 穴で場合分けが要らない。

import { pointInRings } from './course.js';

/** 壁（合成後のリング群）を一様グリッドに載せて、近くの線分だけ引けるようにする。 */
export class WallIndex {
  constructor(rings, cellSize = 28) {
    this.rings = rings;
    this.cell = cellSize;
    this.segs = [];
    this.grid = new Map();

    for (const ring of rings) {
      // ★ 面積の符号で外周／穴を見分けて法線を反転する、という書き方をして間違えた。
      //   polygon-clipping は外周と穴を逆向きに出すので、進行方向に対して
      //   「常に同じ側」が塗りになる。つまり式は 1 つでよく、符号での場合分けは
      //   むしろ穴の法線を穴の内側に向けてしまう。
      //   その状態だと玉が穴（「ろ」の輪の中など）へ押し込まれ、復帰処理も同じ
      //   誤った法線で穴の中へ戻すので、玉が永久に塗りの外に居座った。
      //
      //   とはいえライブラリの巻き方向の約束に寄りかかるのは危ういので、
      //   リングごとに実際に contains() で確かめて、逆だったら反転する。
      const flip = this._shouldFlip(ring, rings);
      const s = flip ? -1 : 1;

      for (let i = 0, n = ring.length; i < n; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % n];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) continue;
        const nx = (-dy / len) * s;
        const ny = (dx / len) * s;
        this._push({ x1, y1, x2, y2, dx, dy, len2: len * len, nx, ny });
      }
    }
  }

  /**
   * このリングの法線を反転すべきか。
   * 長い辺をいくつか選び、法線側に少しずらした点が塗りの内側かどうかで多数決する。
   * 1 本だけで決めると、細い画の上に乗った点で判定を誤ることがある。
   */
  _shouldFlip(ring, allRings) {
    const n = ring.length;
    const idx = [];
    const stride = Math.max(1, Math.floor(n / 15));
    for (let i = 0; i < n; i += stride) idx.push(i);

    let agree = 0;
    let disagree = 0;
    for (const i of idx) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const nx = -dy / len;
      const ny = dx / len;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const eps = 0.6;
      if (pointInRings(allRings, mx + nx * eps, my + ny * eps)) agree++;
      else if (pointInRings(allRings, mx - nx * eps, my - ny * eps)) disagree++;
    }
    return disagree > agree;
  }

  _push(seg) {
    const idx = this.segs.length;
    this.segs.push(seg);
    const c = this.cell;
    const cx0 = Math.floor(Math.min(seg.x1, seg.x2) / c);
    const cx1 = Math.floor(Math.max(seg.x1, seg.x2) / c);
    const cy0 = Math.floor(Math.min(seg.y1, seg.y2) / c);
    const cy1 = Math.floor(Math.max(seg.y1, seg.y2) / c);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cx + ',' + cy;
        let bucket = this.grid.get(key);
        if (!bucket) { bucket = []; this.grid.set(key, bucket); }
        bucket.push(idx);
      }
    }
  }

  /**
   * (x,y) から半径 r 以内に届きうる線分の添字を集める。
   * 1 本の線分が複数のセルに載っているので重複を除く。含まれるかを毎回走査すると
   * 候補数の 2 乗になるため、スタンプ（訪問印）で消す。
   */
  near(x, y, r, out) {
    out.length = 0;
    if (!this._mark) this._mark = new Int32Array(this.segs.length);
    this._epoch = (this._epoch || 0) + 1;
    const epoch = this._epoch;
    const c = this.cell;
    const cx0 = Math.floor((x - r) / c);
    const cx1 = Math.floor((x + r) / c);
    const cy0 = Math.floor((y - r) / c);
    const cy1 = Math.floor((y + r) / c);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const bucket = this.grid.get(cx + ',' + cy);
        if (!bucket) continue;
        for (const i of bucket) {
          if (this._mark[i] === epoch) continue;
          this._mark[i] = epoch;
          out.push(i);
        }
      }
    }
    return out;
  }

  contains(x, y) { return pointInRings(this.rings, x, y); }

  get empty() { return this.segs.length === 0; }

  /** いちばん近い壁の上の点と、その内向き法線。迷子になったボールの復帰に使う。 */
  nearestPoint(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const s of this.segs) {
      const t = clamp01(((x - s.x1) * s.dx + (y - s.y1) * s.dy) / s.len2);
      const qx = s.x1 + s.dx * t;
      const qy = s.y1 + s.dy * t;
      const d = Math.hypot(x - qx, y - qy);
      if (d < bestD) { bestD = d; best = { x: qx, y: qy, nx: s.nx, ny: s.ny, d }; }
    }
    return best;
  }
}

export class Ball {
  constructor(cfg) {
    this.cfg = cfg;
    this.r = cfg.radius;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.alive = false;
    this._cand = [];
  }

  place(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.alive = true;
  }

  remove() { this.alive = false; }

  /**
   * @param {number} dt 秒
   * @param {{x:number,y:number}} tilt 傾き(g)
   * @param {WallIndex} walls
   */
  step(dt, tilt, walls) {
    if (!this.alive || !walls || walls.empty) return;
    const c = this.cfg;
    const gx = tilt.x * c.gravity;
    const gy = tilt.y * c.gravity;

    // 1 サブステップの移動量が半径の半分を超えないように分割する。
    // 細い画で壁をすり抜けるのを防ぐのが目的。
    const speed = Math.hypot(this.vx, this.vy);
    const steps = Math.max(1, Math.min(c.maxSubsteps, Math.ceil((speed * dt) / (this.r * 0.5))));
    const h = dt / steps;

    for (let i = 0; i < steps; i++) {
      // セミインプリシット・オイラー + 指数減衰（フレームレート非依存）
      this.vx = (this.vx + gx * h) * Math.exp(-c.friction * h);
      this.vy = (this.vy + gy * h) * Math.exp(-c.friction * h);

      const v = Math.hypot(this.vx, this.vy);
      if (v > c.maxSpeed) {
        this.vx = (this.vx / v) * c.maxSpeed;
        this.vy = (this.vy / v) * c.maxSpeed;
      }

      this.x += this.vx * h;
      this.y += this.vy * h;

      this._resolve(walls);
    }

    // 保険。すり抜けてしまったら、いちばん近い壁の内側へ戻す。
    // 内外判定は壁の総点数に比例するので、1 フレームに 1 回だけ。
    if (!walls.contains(this.x, this.y)) {
      const q = walls.nearestPoint(this.x, this.y);
      if (q) {
        this.x = q.x + q.nx * (this.r + 0.5);
        this.y = q.y + q.ny * (this.r + 0.5);
        this.vx *= 0.2;
        this.vy *= 0.2;
      }
    }
  }

  /**
   * めり込みを押し出して、法線方向の速度を反射する。角で 2 面に同時に触るので数回まわす。
   *
   * 押し出す量は「線分までの実距離」から出す。内向き法線との内積 (side) から
   * 深さを出す書き方だと、線分の延長線上の遠くにいるボールに対して
   * depth が巨大になり、座標が飛ぶ。距離で見れば d >= r で先に弾ける。
   * 法線は、辺の内側では線分の法線に、端点の近くでは端点からの放射方向に自然に切り替わる。
   */
  _resolve(walls) {
    const c = this.cfg;
    for (let pass = 0; pass < 4; pass++) {
      const cand = walls.near(this.x, this.y, this.r, this._cand);
      let touched = false;

      for (const idx of cand) {
        const s = walls.segs[idx];
        const t = clamp01(((this.x - s.x1) * s.dx + (this.y - s.y1) * s.dy) / s.len2);
        const qx = s.x1 + s.dx * t;
        const qy = s.y1 + s.dy * t;
        const ox = this.x - qx;
        const oy = this.y - qy;
        const d = Math.hypot(ox, oy);
        if (d >= this.r) continue;

        // 内向きか外向きか。壁の外へ出かかっているときは押し戻す向きが逆になる。
        const inward = ox * s.nx + oy * s.ny >= 0;
        let nx;
        let ny;
        let push;
        if (d > 1e-6) {
          nx = (inward ? ox : -ox) / d;
          ny = (inward ? oy : -oy) / d;
          push = inward ? this.r - d : this.r + d;
        } else {
          // ちょうど線分の上。線分自身の法線を使う
          nx = s.nx;
          ny = s.ny;
          push = this.r;
        }

        this.x += nx * push;
        this.y += ny * push;

        const vn = this.vx * nx + this.vy * ny;
        if (vn < 0) {
          this.vx -= nx * vn * (1 + c.restitution);
          this.vy -= ny * vn * (1 + c.restitution);
          // 壁をこする分の減速
          const tx = -ny;
          const ty = nx;
          const vt = this.vx * tx + this.vy * ty;
          this.vx -= tx * vt * c.tangentFriction;
          this.vy -= ty * vt * c.tangentFriction;
        }
        touched = true;
      }

      if (!touched) break;
    }
  }
}

function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
