// 白い面。カメラも OCR も知らない。操作画面から届いた出来事を描くだけ。
//
//   read  … 読めた。部品のまわりに光を出す（保持するほど強くなる）
//   clear … 動かされた。光を消す
//   fix   … 置かれ続けた。組んだ形を中央へ移し、読まれた字を見出しにして塊に加える
//   emoji … 特定の語。絵文字を流す
//
// 白い面は窓の中央の正方形。外側は黒＝プロジェクターでは何も投げない。
// 外周の帯が置く場、中央の円が集まる場。

import { CHANNEL, GATHER, TIME, DEFAULTS } from './common.js';

const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const hint = document.getElementById('hint');
const ch = new BroadcastChannel(CHANNEL);

const S = { ...DEFAULTS, calib: false };
let W = 0, H = 0, dpr = 1;
let side = 0, ox = 0, oy = 0;   // 正方形の一辺と左上（画素）

let reading = null;   // { id, text, t0, glowCanvas, shapeCanvas, bbox, fading }
const bodies = [];    // 塊に加わった形
const particles = [];

// 塊の決まり
const HEAD_PX = 12;           // 見出しの大きさ（CSS px）
const SHRINK_TO = 0.45;       // 置いた大きさに対する、塊の中での大きさ
const SIZE_MIN = 0.05, SIZE_MAX = 0.10;   // 塊の中での長辺（正方形に対する割合）
const FILL_MAX = 0.62;        // 円の面積のうち、これ以上埋まったら古いものから消す
const SHOW_RING = true;       // 集まる場の輪郭をごく薄く出す（何も無いときに、中央が置く場でないと分かるように）

// ---------------------------------------------------------------- 大きさ

function resize() {
  dpr = window.devicePixelRatio || 1;
  W = Math.round(innerWidth * dpr);
  H = Math.round(innerHeight * dpr);
  cv.width = W; cv.height = H;
  side = Math.min(W, H);
  ox = Math.round((W - side) / 2);
  oy = Math.round((H - side) / 2);
  // 操作画面には正方形の大きさを伝える（検出の格子もこの比で作られる）
  ch.postMessage({ type: 'hello', w: side / dpr, h: side / dpr });
}
addEventListener('resize', resize);
resize();

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
addEventListener('click', () => { if (!document.fullscreenElement) toggleFullscreen(); });
addEventListener('keydown', e => { if (e.key === 'f' || e.key === 'F') toggleFullscreen(); });
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('hide-cursor', !!document.fullscreenElement);
  hint.style.opacity = document.fullscreenElement ? 0 : 1;
});

// 正規化座標 → 画素
const X = u => ox + u * side;
const Y = v => oy + v * side;

// ---------------------------------------------------------------- 受信

ch.onmessage = ({ data: m }) => {
  if (m.type === 'ping') { resize(); return; }
  if (m.type === 'settings') { Object.assign(S, m.settings); return; }
  if (m.type === 'read') { startReading(m); return; }
  if (m.type === 'clear') {
    if (reading && reading.id === m.id && !reading.fading) reading.fading = now();
    return;
  }
  if (m.type === 'fix') { fix(m.id); return; }
  if (m.type === 'emoji') { spawnEmoji(m.ch); return; }
  if (m.type === 'wipe') { bodies.length = 0; return; }
};

const now = () => performance.now() / 1000;

// 0/1 のマスクを、色つきのキャンバスにする
function maskCanvas(data, w, h, color) {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const [r, gg, b] = hexRgb(color);
  for (let i = 0; i < w * h; i++) {
    if (!data[i]) continue;
    const k = i * 4;
    img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function startReading(m) {
  reading = {
    id: m.id,
    text: m.text,
    t0: now(),
    glowCanvas: maskCanvas(m.mask, m.gw, m.gh, S.glow),
    shapeCanvas: maskCanvas(m.shape.data, m.shape.w, m.shape.h, S.ink),
    bbox: m.bbox,         // 正規化座標
    fading: 0,
  };
}

// 置かれていた場所から、置かれていた大きさのまま塊に加わり、引かれながら縮む
function fix(id) {
  if (!reading || reading.id !== id) return;
  const b = reading.bbox;
  const w0 = b.x1 - b.x0, h0 = b.y1 - b.y0;
  const long = Math.max(w0, h0);
  const k = Math.min(SIZE_MAX, Math.max(SIZE_MIN, long * SHRINK_TO)) / long;
  const ph = Math.random() * Math.PI * 2;
  bodies.push({
    text: reading.text,
    canvas: reading.shapeCanvas,
    w0, h0, w: w0 * k, h: h0 * k,
    x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2,
    vx: 0, vy: 0,
    born: now(), dying: 0, ph,
  });
  reading.fading = now();
  reading.flash = true;
}

function spawnEmoji(e) {
  const t = now();
  for (let i = 0; i < 28; i++) {
    particles.push({
      ch: e,
      x: Math.random(),
      y: 1.05 + Math.random() * 0.35,
      vy: -(0.28 + Math.random() * 0.3),
      vx: (Math.random() - 0.5) * 0.06,
      size: 0.035 + Math.random() * 0.04,
      rot: (Math.random() - 0.5) * 0.8,
      vr: (Math.random() - 0.5) * 1.2,
      t0: t + Math.random() * 0.5,
    });
  }
}

// ---------------------------------------------------------------- 塊の動き

const ease = x => 1 - Math.pow(1 - x, 3);
const clamp01 = x => Math.max(0, Math.min(1, x));

// いまの大きさ（縮みきるまでは置いた大きさから補間）と、消えかけの度合い
function sizeOf(b, t) {
  const s = ease(clamp01((t - b.born) / TIME.SHRINK_SEC));
  const fade = b.dying ? clamp01((t - b.dying) / 1.5) : 0;
  const k = 1 - fade;
  return {
    s, fade,
    w: (b.w0 + (b.w - b.w0) * s) * k,
    h: (b.h0 + (b.h - b.h0) * s) * k,
  };
}

// ぶつかり合いは円で近似する。字形の外接矩形には余白があるので、対角線より少し小さく取る。
// 見出しのぶんだけ上下に余裕を足す
function radiusOf(sz) {
  return 0.5 * Math.hypot(sz.w, sz.h) * 0.78 + (HEAD_PX * dpr / side) * 0.6 * (1 - sz.fade);
}

function stepBodies(t, dt) {
  const R = GATHER.r;
  // 埋まりすぎたら古いものから消す（塊が円からあふれると、カメラが見る帯にはみ出すため）
  let fill = 0;
  for (const b of bodies) if (!b.dying) { const r = radiusOf({ w: b.w, h: b.h, fade: 0 }); fill += r * r; }
  for (const b of bodies) {
    if (fill <= FILL_MAX * R * R) break;
    if (b.dying) continue;
    b.dying = t;
    const r = radiusOf({ w: b.w, h: b.h, fade: 0 });
    fill -= r * r;
  }
  for (let i = bodies.length - 1; i >= 0; i--) {
    if (bodies[i].dying && t - bodies[i].dying > 1.5) bodies.splice(i, 1);
  }

  const n = bodies.length;
  const sz = bodies.map(b => sizeOf(b, t));
  const rad = sz.map(radiusOf);
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    // 中心へ引く。ごく弱く揺らして、塊がいつまでも少しずつ動くようにする
    const ax = (GATHER.x - b.x) * 5 + Math.sin(t * 0.6 + b.ph) * 0.012;
    const ay = (GATHER.y - b.y) * 5 + Math.cos(t * 0.45 + b.ph * 1.7) * 0.012;
    b.vx = (b.vx + ax * dt) * Math.exp(-4 * dt);
    b.vy = (b.vy + ay * dt) * Math.exp(-4 * dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  // 重なりを押し分ける（位置で直す。速さは少し削る）
  for (let it = 0; it < 4; it++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = bodies[i], b = bodies[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const min = rad[i] + rad[j];
        if (d >= min) continue;
        if (d < 1e-6) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
        const push = (min - d) / 2;
        dx /= d; dy /= d;
        a.x -= dx * push; a.y -= dy * push;
        b.x += dx * push; b.y += dy * push;
        a.vx *= 0.9; a.vy *= 0.9; b.vx *= 0.9; b.vy *= 0.9;
      }
    }
    // 縮みきったものは円の内側に留める
    for (let i = 0; i < n; i++) {
      if (sz[i].s < 1) continue;
      const b = bodies[i];
      const dx = b.x - GATHER.x, dy = b.y - GATHER.y, d = Math.hypot(dx, dy);
      const lim = R - rad[i];
      if (d > lim && d > 0) { b.x = GATHER.x + dx / d * lim; b.y = GATHER.y + dy / d * lim; }
    }
  }
}

// ---------------------------------------------------------------- 描画

function drawGlow(t) {
  if (!reading) return;
  let a;
  if (reading.fading) {
    const f = (t - reading.fading) / 0.7;
    if (f >= 1) { reading = null; return; }
    a = (reading.flash ? 1 : 0.8) * (1 - f);
  } else {
    // 保持するほど強くなる。これがそのまま「あと少しで残る」の手がかりになる
    const p = clamp01((t - reading.t0) / TIME.HOLD_SEC);
    a = 0.35 + 0.65 * p + 0.06 * Math.sin(t * 5);
  }
  // 影だけを描く：画像そのものは画面の外に置き、影を元の位置に落とす
  const off = W * 2;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.shadowOffsetX = off;
  for (const [blur, k] of [[70, 1], [30, 1], [12, 0.8]]) {
    ctx.shadowBlur = blur * dpr;
    ctx.shadowColor = rgba(S.glow, clamp01(a * k));
    ctx.drawImage(reading.glowCanvas, ox - off, oy, side, side);
  }
  ctx.restore();
}

function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function drawBodies(t) {
  const head = HEAD_PX * dpr;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.font = `500 ${head}px "Hiragino Mincho ProN", "Hiragino Sans", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = S.ink;
  for (const b of bodies) {
    const sz = sizeOf(b, t);
    const w = sz.w * side, h = sz.h * side;
    const cx = X(b.x), cy = Y(b.y);
    ctx.globalAlpha = 1 - sz.fade;
    ctx.drawImage(b.canvas, cx - w / 2, cy - h / 2, w, h);
    // 見出しは縮みきる手前から出る
    const ha = clamp01((sz.s - 0.7) / 0.3) * (1 - sz.fade);
    if (ha > 0) {
      ctx.globalAlpha = ha;
      ctx.fillText(b.text, cx, cy - h / 2 - head * 0.25);
    }
  }
  ctx.restore();
}

function drawRing() {
  if (!SHOW_RING) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  ctx.arc(X(GATHER.x), Y(GATHER.y), (GATHER.r + GATHER.margin) * side, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawParticles(t, dt) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, side, side);
  ctx.clip();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (t < p.t0) continue;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    if (p.y < -0.15 || t - p.t0 > TIME.EMOJI_SEC + 1.5) { particles.splice(i, 1); continue; }
    const s = p.size * side;
    ctx.save();
    ctx.translate(X(p.x), Y(p.y));
    ctx.rotate(p.rot);
    ctx.font = `${s}px "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.ch, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

// 四隅合わせ。操作画面のカメラ映像で、この 1〜4 の角に印を重ねてもらう
function drawCalib() {
  const L = side * 0.09, th = Math.max(6, side * 0.012);
  const corners = [[ox, oy, 1, 1], [ox + side, oy, -1, 1], [ox + side, oy + side, -1, -1], [ox, oy + side, 1, -1]];
  ctx.fillStyle = '#000';
  ctx.font = `700 ${L * 0.8}px "Hiragino Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  corners.forEach(([x, y, sx, sy], i) => {
    ctx.fillRect(sx > 0 ? x : x - L, sy > 0 ? y : y - th, L, th);
    ctx.fillRect(sx > 0 ? x : x - th, sy > 0 ? y : y - L, th, L);
    ctx.fillText(String(i + 1), x + sx * L * 0.9, y + sy * L * 0.9);
  });
  ctx.font = `${L * 0.3}px "Hiragino Sans", sans-serif`;
  ctx.fillStyle = '#666';
  ctx.fillText('四隅合わせ中 — このあいだは読まない', X(0.5), Y(0.5));
}

let last = now();
function frame() {
  const t = now(), dt = Math.min(0.05, t - last);
  last = t;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const lv = S.surfaceLevel | 0;
  ctx.fillStyle = `rgb(${lv},${lv},${lv})`;
  ctx.fillRect(ox, oy, side, side);
  if (S.calib) {
    drawCalib();
  } else {
    stepBodies(t, dt);
    drawRing();
    drawGlow(t);
    drawBodies(t);
    drawParticles(t, dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
