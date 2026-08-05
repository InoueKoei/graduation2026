import { CONFIG } from './config.js';

// 墨(ゲーム本体)。
// 皿の上を転がる墨玉 + 器の縁からこぼれる量 + 波(揺れの罰)。
// 「静けさが上達」= 波は時間でしか鎮まらない、が設計の核。
export class Sumi {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.reset();
    this._fit();
    new ResizeObserver(() => this._fit()).observe(canvas.parentElement);
  }

  _fit() {
    const el = this.canvas.parentElement;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = Math.max(1, el.clientWidth);
    this.h = Math.max(1, el.clientHeight);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.R = Math.min(this.w, this.h) * CONFIG.dishRadius;
    if (!this._placed) { this._placeGoal(); this._placed = true; }
  }

  reset() {
    this.ink = CONFIG.startInk;
    this.px = 0; this.py = 0;        // 皿中心からの相対位置
    this.vx = 0; this.vy = 0;
    this.wave = 0;                    // 波の高さ 0..1
    this.score = 0;
    this.time = 0;
    this.holdT = 0;
    this.over = false;
    this.splashes = [];               // こぼれた墨の跡
    this.calmT = 0;                   // 連続で静かにできている時間
  }

  _placeGoal() {
    // 皿の縁の近くにゴールを置く(移動を強いる)
    const a = Math.random() * Math.PI * 2;
    const r = this.R * (0.55 + Math.random() * 0.32);
    this.gx = Math.cos(a) * r;
    this.gy = Math.sin(a) * r;
  }

  // dt=秒, tilt={x,y}, shake=0..1
  step(dt, tilt, shake) {
    if (this.over) return;
    this.time += dt;

    // 波: 揺れで立ち、時間でしか鎮まらない
    const target = Math.min(1, shake * CONFIG.waveGain);
    if (target > this.wave) this.wave += (target - this.wave) * Math.min(1, 14 * dt);
    else this.wave = Math.max(0, this.wave - CONFIG.waveDecay * dt);

    // 墨玉の移動
    const g = CONFIG.gravity;
    this.vx = (this.vx + tilt.x * g * dt) * Math.exp(-CONFIG.friction * dt);
    this.vy = (this.vy + tilt.y * g * dt) * Math.exp(-CONFIG.friction * dt);
    this.px += this.vx * dt;
    this.py += this.vy * dt;

    // 皿の縁で受け止める(勢いは殺す)
    const d = Math.hypot(this.px, this.py);
    const rim = this.R * 0.9;
    if (d > rim) {
      const nx = this.px / d, ny = this.py / d;
      this.px = nx * rim; this.py = ny * rim;
      const vn = this.vx * nx + this.vy * ny;
      this.vx -= nx * vn * 1.3;
      this.vy -= ny * vn * 1.3;
    }

    // こぼれ: 傾けすぎ + 波 + 縁への寄り
    const tiltMag = Math.hypot(tilt.x, tilt.y);
    const over = Math.max(0, tiltMag - CONFIG.spillTilt);
    const edge = Math.max(0, d / rim - 0.55);
    const spill = (over * 2.2 + this.wave * 0.9 * (0.35 + edge)) * CONFIG.spillRate;
    if (spill > 0.01) {
      this.ink = Math.max(0, this.ink - spill * dt);
      if (Math.random() < spill * dt * 0.4) {
        this.splashes.push({
          x: this.px + (Math.random() - 0.5) * 30,
          y: this.py + (Math.random() - 0.5) * 30,
          r: 2 + Math.random() * 7, a: 1,
        });
        if (this.splashes.length > 120) this.splashes.shift();
      }
    }
    for (const s of this.splashes) s.a = Math.max(0, s.a - dt * 0.05);

    // 静けさボーナス: 波が無い時間が続くと墨がわずかに戻る(呼吸できる)
    if (this.wave < 0.05 && tiltMag < 0.35) {
      this.calmT += dt;
      if (this.calmT > 1.2) this.ink = Math.min(100, this.ink + 3 * dt);
    } else this.calmT = 0;

    // ゴール判定: 一定時間そこに留まる
    const gd = Math.hypot(this.px - this.gx, this.py - this.gy);
    if (gd < CONFIG.goalRadius && this.wave < 0.35) {
      this.holdT += dt;
      if (this.holdT >= CONFIG.goalHold) {
        this.score++;
        this.ink = Math.min(100, this.ink + CONFIG.refillOnGoal);
        this.holdT = 0;
        this._placeGoal();
      }
    } else {
      this.holdT = Math.max(0, this.holdT - dt * 2);
    }

    if (this.ink <= 0) { this.ink = 0; this.over = true; }
  }

  render() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    const cx = this.w / 2, cy = this.h / 2;
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const ink = css('--ink'), hair = css('--hairline'), muted = css('--muted');

    c.save();
    c.translate(cx, cy);

    // 皿
    c.strokeStyle = hair;
    c.lineWidth = 1;
    c.beginPath(); c.arc(0, 0, this.R, 0, Math.PI * 2); c.stroke();
    // 危険域(縁の内側)
    c.setLineDash([2, 6]);
    c.beginPath(); c.arc(0, 0, this.R * 0.9, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);

    // こぼれた跡
    for (const s of this.splashes) {
      c.globalAlpha = s.a * 0.22;
      c.fillStyle = ink;
      c.beginPath(); c.arc(s.x, s.y, s.r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;

    // ゴール(留まるほど濃くなる環)
    const prog = Math.min(1, this.holdT / CONFIG.goalHold);
    c.strokeStyle = muted;
    c.lineWidth = 1;
    c.beginPath(); c.arc(this.gx, this.gy, CONFIG.goalRadius, 0, Math.PI * 2); c.stroke();
    if (prog > 0) {
      c.strokeStyle = ink;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(this.gx, this.gy, CONFIG.goalRadius, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      c.stroke();
    }

    // 墨玉: 量で大きさ、波で輪郭が乱れる
    const rad = 12 + (this.ink / 100) * 26;
    c.fillStyle = ink;
    c.beginPath();
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const wob = Math.sin(th * 3 + this.time * 9) * 0.5 + Math.sin(th * 5 - this.time * 6) * 0.5;
      const r = rad * (1 + wob * this.wave * 0.42);
      const x = this.px + Math.cos(th) * r;
      const y = this.py + Math.sin(th) * r;
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.closePath();
    c.fill();

    c.restore();
  }
}
