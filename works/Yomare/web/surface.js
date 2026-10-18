// 白い面。カメラも OCR も知らない。操作画面から届いた出来事を描くだけ。
//
//   read  … 読めた。部品のまわりに光を出す（保持するほど強くなる）
//   clear … 動かされた。光を消す
//   fix   … 置かれ続けた。組んだ形を端へ移し、読まれた字を見出しにして並べる
//   emoji … 特定の語。絵文字を流す

import { CHANNEL, PLACE, SHELF, TIME, DEFAULTS } from './common.js';

const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const hint = document.getElementById('hint');
const ch = new BroadcastChannel(CHANNEL);

const S = { ...DEFAULTS, calib: false };
let W = 0, H = 0, dpr = 1;

let reading = null;   // { id, text, t0, glowCanvas, shape, bbox, fading }
const shelf = [];     // { text, shapeCanvas, aspect, y, born, from }
const particles = [];

// ---------------------------------------------------------------- 大きさ

function resize() {
  dpr = window.devicePixelRatio || 1;
  W = Math.round(innerWidth * dpr);
  H = Math.round(innerHeight * dpr);
  cv.width = W; cv.height = H;
  ch.postMessage({ type: 'hello', w: innerWidth, h: innerHeight });
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
  if (m.type === 'wipe') { shelf.length = 0; return; }
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

function fix(id) {
  if (!reading || reading.id !== id) return;
  const b = reading.bbox;
  shelf.unshift({
    text: reading.text,
    shapeCanvas: reading.shapeCanvas,
    aspect: (b.y1 - b.y0) * H / ((b.x1 - b.x0) * W),
    born: now(),
    from: { x: b.x0 * W, y: b.y0 * H, w: (b.x1 - b.x0) * W, h: (b.y1 - b.y0) * H },
    y: null,
  });
  if (shelf.length > 40) shelf.length = 40;
  reading.fading = now();
  reading.flash = now();
}

function spawnEmoji(e) {
  const t = now();
  const n = 28;
  for (let i = 0; i < n; i++) {
    particles.push({
      ch: e,
      x: PLACE.x0 + Math.random() * (PLACE.x1 - PLACE.x0),
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

// ---------------------------------------------------------------- 描画

const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const clamp01 = x => Math.max(0, Math.min(1, x));

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
    ctx.drawImage(reading.glowCanvas, -off, 0, W, H);
  }
  ctx.restore();
}

function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function drawShelf(t) {
  const x0 = SHELF.x0 * W, x1 = SHELF.x1 * W, sw = x1 - x0;
  const headPx = Math.round(sw * 0.17);
  const gap = sw * 0.12;
  const maxShapeH = sw * 0.75;

  // 仕切り。カメラの見ない側なので、線を引いても部品と取り違えない
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(Math.round((PLACE.x1 + SHELF.x0) / 2 * W), SHELF.y0 * H, Math.max(1, dpr), (SHELF.y1 - SHELF.y0) * H);

  let y = SHELF.y0 * H;
  for (const e of shelf) {
    let w = sw * 0.8, h = w * e.aspect;
    if (h > maxShapeH) { h = maxShapeH; w = h / e.aspect; }
    const blockH = headPx * 1.5 + h + gap;
    if (e.y === null) e.y = y;
    e.y += (y - e.y) * 0.18;           // 新しいものが上に入ると、古いものは下へずれる
    if (e.y > SHELF.y1 * H) { y += blockH; continue; }

    const tx = x0 + (sw - w) / 2, ty = e.y + headPx * 1.5;
    const f = clamp01((t - e.born) / TIME.FLY_SEC);
    const k = ease(f);
    const fx = e.from.x + (tx - e.from.x) * k;
    const fy = e.from.y + (ty - e.from.y) * k;
    const fw = e.from.w + (w - e.from.w) * k;
    const fh = e.from.h + (h - e.from.h) * k;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(e.shapeCanvas, fx, fy, fw, fh);
    ctx.restore();

    // 見出しは着地してから出る
    const ha = clamp01((t - e.born - TIME.FLY_SEC * 0.8) / 0.5);
    if (ha > 0) {
      ctx.save();
      ctx.globalAlpha = ha;
      ctx.fillStyle = S.ink;
      ctx.font = `600 ${headPx}px "Hiragino Mincho ProN", "Hiragino Sans", serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(e.text, x0, e.y, sw);
      ctx.restore();
    }
    y += blockH;
  }
}

function drawParticles(t, dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (t < p.t0) continue;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    if (p.y < -0.15 || t - p.t0 > TIME.EMOJI_SEC + 1.5) { particles.splice(i, 1); continue; }
    const s = p.size * H;
    ctx.save();
    ctx.translate(p.x * W, p.y * H);
    ctx.rotate(p.rot);
    ctx.font = `${s}px "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.ch, 0, 0);
    ctx.restore();
  }
}

// 四隅合わせ。操作画面のカメラ映像で、この 1〜4 の角に印を重ねてもらう
function drawCalib() {
  const L = Math.min(W, H) * 0.09, th = Math.max(6, Math.min(W, H) * 0.012);
  const corners = [[0, 0, 1, 1], [W, 0, -1, 1], [W, H, -1, -1], [0, H, 1, -1]];
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
  ctx.fillText('四隅合わせ中 — このあいだは読まない', W / 2, H / 2);
}

let last = now();
function frame() {
  const t = now(), dt = Math.min(0.05, t - last);
  last = t;
  const lv = S.surfaceLevel | 0;
  ctx.fillStyle = `rgb(${lv},${lv},${lv})`;
  ctx.fillRect(0, 0, W, H);
  if (S.calib) {
    drawCalib();
  } else {
    drawGlow(t);
    drawShelf(t);
    drawParticles(t, dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
