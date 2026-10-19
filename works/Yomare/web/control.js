// 操作画面。カメラを持ち、部品を検出し、静止したら切り出して OCR へ渡す。
// 白い面へは BroadcastChannel で出来事だけを送る（描くのは surface.js）。
//
// 輪郭（二値化と連結成分）は「静止したか」「どこに置かれたか」を知るためだけに使う。
// OCR へ渡すのはカメラ映像を矩形で切り出しただけの画像で、二値化したものではない。

import { CHANNEL, PLACE, GATHER, inPlace, TIME, EMOJI, DEFAULTS } from './common.js';

const $ = id => document.getElementById(id);
const ch = new BroadcastChannel(CHANNEL);
const now = () => performance.now() / 1000;

// ================================================================ 設定（この端末に覚えておく）

const STORE = 'yomare.settings.v1';
const S = { ...DEFAULTS, corners: null, cameraId: '', calib: false };
try { Object.assign(S, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch {}
S.calib = false;
function save() {
  const { calib, ...keep } = S;
  try { localStorage.setItem(STORE, JSON.stringify(keep)); } catch {}
}
function pushSurfaceSettings() {
  ch.postMessage({ type: 'settings', settings: {
    surfaceLevel: S.surfaceLevel, glow: S.glow, ink: S.ink, calib: S.calib,
  } });
}

// ================================================================ カメラ

const video = document.createElement('video');
video.muted = true; video.playsInline = true;
let stream = null;

async function openCamera(deviceId) {
  if (stream) stream.getTracks().forEach(t => t.stop());
  const video_ = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  if (deviceId) video_.deviceId = { exact: deviceId };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: false });
  } catch (e) {
    // 覚えていたカメラが今日は繋がっていない（Continuity Camera はよくある）。既定のカメラで開き直す
    if (deviceId) return openCamera('');
    setState('error', 'カメラを開けない', String(e.message || e));
    return;
  }
  video.srcObject = stream;
  await video.play();
  const track = stream.getVideoTracks()[0];
  S.cameraId = track.getSettings().deviceId || '';
  save();
  await listCameras();
  onVideoSize();
}

async function listCameras() {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  const sel = $('camSel');
  sel.innerHTML = '';
  devs.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `カメラ ${i + 1}`;
    if (d.deviceId === S.cameraId) o.selected = true;
    sel.appendChild(o);
  });
}
$('camSel').onchange = e => openCamera(e.target.value);

// ================================================================ 四隅 → 射影変換

// 白い面の正規化座標 (u,v) → カメラ映像の画素 (x,y)
let Hm = null;

function homography(dst) {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i], [x, y] = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  // ガウスの消去法
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]).concat(1);
}

function project(u, v) {
  const h = Hm;
  const w = h[6] * u + h[7] * v + 1;
  return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
}

// ================================================================ 検出の格子

const SMALL_W = 960;          // 毎フレームの検出はこの幅に縮めた映像で行う
const GRID_W = 560;           // 白い面を この幅の格子に直して見る
let surf = { w: 1920, h: 1200 };
let gw = GRID_W, gh = 350;
let zone = null;              // 置く場を囲む格子範囲（中央の円はこの中でさらに外す）
let placeArea = 1;            // 置く場の画素数
let lut = null;               // 格子 → 縮小映像の画素位置（-1 は映像の外）
const small = document.createElement('canvas');
const sctx = small.getContext('2d', { willReadFrequently: true });

let luma, bin, label, mask, view;
let comps = [];
const hist = new Uint32Array(256);

function onVideoSize() {
  if (!video.videoWidth) return;
  small.width = SMALL_W;
  small.height = Math.round(SMALL_W * video.videoHeight / video.videoWidth);
  const cam = $('cam');
  cam.width = 960;
  cam.height = Math.round(960 * video.videoHeight / video.videoWidth);
  if (!S.corners) S.corners = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
  rebuild();
}

function rebuild() {
  gh = Math.round(gw * surf.h / surf.w);
  zone = {
    x0: Math.ceil(PLACE.inset * gw), x1: Math.floor((1 - PLACE.inset) * gw),
    y0: Math.ceil(PLACE.inset * gh), y1: Math.floor((1 - PLACE.inset) * gh),
  };
  const n = gw * gh;
  luma = new Uint8Array(n); bin = new Uint8Array(n); mask = new Uint8Array(n);
  label = new Int32Array(n);
  const rc = $('rect');
  rc.width = gw; rc.height = gh;
  view = rc.getContext('2d').createImageData(gw, gh);
  rebuildLut();
  resetArrangement('格子を作り直した');
}

function rebuildLut() {
  if (!video.videoWidth || !S.corners) return;
  Hm = homography(S.corners.map(([x, y]) => [x * video.videoWidth, y * video.videoHeight]));
  lut = new Int32Array(gw * gh).fill(-1);
  const kx = small.width / video.videoWidth, ky = small.height / video.videoHeight;
  placeArea = 0;
  for (let y = zone.y0; y < zone.y1; y++) {
    for (let x = zone.x0; x < zone.x1; x++) {
      const u = (x + 0.5) / gw, v = (y + 0.5) / gh;
      if (!inPlace(u, v)) continue;     // 中央の円は集まる場。見ない（円の縁に触れた塊は捨てられる）
      const [px, py] = project(u, v);
      const sx = Math.round(px * kx), sy = Math.round(py * ky);
      if (sx < 0 || sy < 0 || sx >= small.width || sy >= small.height) continue;
      lut[y * gw + x] = (sy * small.width + sx) * 4;
      placeArea++;
    }
  }
}

// 1フレームぶんの検出。部品の和集合を mask に入れて、面積と外接矩形を返す
function detect() {
  sctx.drawImage(video, 0, 0, small.width, small.height);
  const px = sctx.getImageData(0, 0, small.width, small.height).data;
  hist.fill(0);
  bin.fill(0); label.fill(0); mask.fill(0);
  const thr = S.threshold, dark = S.darkParts;
  for (let y = zone.y0; y < zone.y1; y++) {
    for (let x = zone.x0; x < zone.x1; x++) {
      const i = y * gw + x, j = lut[i];
      if (j < 0) continue;
      const l = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
      luma[i] = l; hist[l]++;
      bin[i] = dark ? (l < thr ? 1 : 0) : (l > thr ? 1 : 0);
    }
  }

  // 連結成分（4近傍）
  const minArea = Math.max(4, placeArea * S.minAreaPct / 100);
  comps = [{}];
  const stack = new Int32Array(gw * gh);
  for (let y = zone.y0; y < zone.y1; y++) {
    for (let x = zone.x0; x < zone.x1; x++) {
      const s = y * gw + x;
      if (!bin[s] || label[s]) continue;
      const id = comps.length;
      const c = { area: 0, x0: x, y0: y, x1: x, y1: y, touch: false };
      let sp = 0;
      stack[sp++] = s; label[s] = id;
      while (sp) {
        const i = stack[--sp];
        const cx = i % gw, cy = (i / gw) | 0;
        c.area++;
        if (cx < c.x0) c.x0 = cx; if (cx > c.x1) c.x1 = cx;
        if (cy < c.y0) c.y0 = cy; if (cy > c.y1) c.y1 = cy;
        if (cx === zone.x0 || cx === zone.x1 - 1 || cy === zone.y0 || cy === zone.y1 - 1) c.touch = true;
        for (const k of [i - 1, i + 1, i - gw, i + gw]) {
          if (lut[k] < 0) { c.touch = true; continue; }   // 映像の外に接している
          if (bin[k] && !label[k]) { label[k] = id; stack[sp++] = k; }
        }
      }
      c.kind = c.touch ? 'edge' : c.area < minArea ? 'small' : 'part';
      comps.push(c);
    }
  }

  let area = 0, bx0 = gw, by0 = gh, bx1 = -1, by1 = -1, n = 0;
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    if (c.kind !== 'part') continue;
    n++; area += c.area;
    bx0 = Math.min(bx0, c.x0); by0 = Math.min(by0, c.y0);
    bx1 = Math.max(bx1, c.x1); by1 = Math.max(by1, c.y1);
  }
  // 部品の外接矩形の内側にある小さい塊（てん など）は、部品の一部として数える。
  // 切り出しには最初から写っているので、残す形からだけ落とすと、読みと形が食い違う
  if (n) {
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      const i = y * gw + x;
      if (label[i] && comps[label[i]].kind !== 'edge') mask[i] = 1;
    }
  }
  return { area, n, bbox: n ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : null };
}

// 半径 r で膨らませる（行・列それぞれの累積和で、窓の中に1つでもあれば1）
function dilate(src, r) {
  const tmp = new Uint8Array(gw * gh), out = new Uint8Array(gw * gh);
  const acc = new Int32Array(Math.max(gw, gh) + 1);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) acc[x + 1] = acc[x] + src[y * gw + x];
    for (let x = 0; x < gw; x++) {
      const a = Math.max(0, x - r), b = Math.min(gw, x + r + 1);
      tmp[y * gw + x] = acc[b] - acc[a] > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < gw; x++) {
    for (let y = 0; y < gh; y++) acc[y + 1] = acc[y] + tmp[y * gw + x];
    for (let y = 0; y < gh; y++) {
      const a = Math.max(0, y - r), b = Math.min(gh, y + r + 1);
      out[y * gw + x] = acc[b] - acc[a] > 0 ? 1 : 0;
    }
  }
  return out;
}

// ================================================================ 配置の状態

// empty → settling →（静止）→ reading → read →（保持）→ fixed
//                                     ↘ unread（何もしない。動かせばまた読む）
const st = {
  name: 'empty', id: 0,
  ref: null, refDil: null, refArea: 0, refT: 0,
  changedFor: 0, emptyFor: 0,
  text: '', readT: 0,
  lastFixed: null,
  pausedUntil: 0,
};
const lastEmoji = {};

function resetArrangement(why) {
  if (st.name === 'read') ch.postMessage({ type: 'clear', id: st.id });
  st.name = 'empty'; st.ref = null; st.changedFor = 0;
  if (why) console.log(why);
}

// 基準の配置からどれだけ変わったか。際のちらつきや光の滲みは、膨らませた範囲の内側なので数えない
function differs(m, area, ref, refDil, refArea) {
  let lost = 0, added = 0;
  for (let i = 0; i < m.length; i++) {
    if (ref[i] && !m[i]) lost++;
    else if (m[i] && !refDil[i]) added++;
  }
  return lost / refArea > 0.3 || added / refArea > 0.15 || Math.abs(area - refArea) / refArea > 0.4;
}

function newArrangement(m, area, t) {
  st.id++;
  st.ref = m.slice();
  st.refDil = dilate(st.ref, Math.round(gw * 0.025));
  st.refArea = area; st.refT = t; st.changedFor = 0;
  st.name = 'settling';
  // 腕が一瞬かぶって戻っただけなら、もう残した配置なので繰り返さない
  const f = st.lastFixed;
  if (f && !differs(m, area, f.ref, f.refDil, f.refArea)) {
    st.name = 'fixed'; st.text = f.text;
  }
}

function step(det, t, dt) {
  const paused = S.calib || t < st.pausedUntil;
  if (!paused) {
    if (det.area === 0) {
      st.emptyFor += dt;
      if (st.ref && st.emptyFor >= TIME.MOVE_CONFIRM_SEC) resetArrangement();
      if (st.emptyFor >= 2) st.lastFixed = null;   // 本当に片付けたら、同じ形をまた残してよい
    } else {
      st.emptyFor = 0;
      if (!st.ref) newArrangement(mask, det.area, t);
      else if (differs(mask, det.area, st.ref, st.refDil, st.refArea)) {
        st.changedFor += dt;
        if (st.changedFor >= TIME.MOVE_CONFIRM_SEC) {
          resetArrangement();
          newArrangement(mask, det.area, t);
        }
      } else st.changedFor = 0;
    }
    if (st.name === 'settling' && st.changedFor === 0 && t - st.refT >= TIME.STILL_SEC) {
      read(det);
    }
  }
  if (st.name === 'read' && t - st.readT >= TIME.HOLD_SEC) {
    st.name = 'fixed';
    st.lastFixed = { ref: st.ref, refDil: st.refDil, refArea: st.refArea, text: st.text };
    ch.postMessage({ type: 'fix', id: st.id });
    // 形が置く場を横切って中央へ縮んでいくあいだは、それを部品と取り違えないよう見ない
    st.pausedUntil = Math.max(st.pausedUntil, t + TIME.SHRINK_SEC + 0.3);
    log(st.text, '残した');
  }
}

// ================================================================ 読ませる

const full = document.createElement('canvas');
const fctx = full.getContext('2d', { willReadFrequently: true });
const cropCanvas = document.createElement('canvas');

async function read(det) {
  st.name = 'reading';
  const id = st.id;
  // 読ませる瞬間の配置を基準にし直す（保持の判定はこれと比べる）
  st.ref = mask.slice();
  st.refDil = dilate(st.ref, Math.round(gw * 0.025));
  st.refArea = det.area;

  const b = det.bbox;
  const gridMask = mask.slice();

  // 切り出す範囲：部品の外接矩形に余白を足し、カメラ映像の座標へ写す
  const m = Math.round(Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.25) + 4;
  const g = [[b.x0 - m, b.y0 - m], [b.x1 + 1 + m, b.y0 - m], [b.x1 + 1 + m, b.y1 + 1 + m], [b.x0 - m, b.y1 + 1 + m]];
  const pts = g.map(([x, y]) => project(x / gw, y / gh));
  const vw = video.videoWidth, vh = video.videoHeight;
  const sx = Math.max(0, Math.floor(Math.min(...pts.map(p => p[0]))));
  const sy = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1]))));
  const ex = Math.min(vw, Math.ceil(Math.max(...pts.map(p => p[0]))));
  const ey = Math.min(vh, Math.ceil(Math.max(...pts.map(p => p[1]))));

  // 同じ瞬間の映像から、切り出し（OCR 用）と、残す形（白い面用）の両方を取る
  full.width = vw; full.height = vh;
  fctx.drawImage(video, 0, 0);
  cropCanvas.width = ex - sx; cropCanvas.height = ey - sy;
  cropCanvas.getContext('2d').drawImage(full, sx, sy, ex - sx, ey - sy, 0, 0, ex - sx, ey - sy);
  const shape = traceShape(b, gridMask);
  const blob = await new Promise(r => cropCanvas.toBlob(r, 'image/png'));
  showCrop(blob);

  let res;
  try {
    const r = await fetch('/ocr', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/png' } });
    res = await r.json();
    $('server').textContent = '';
  } catch (e) {
    $('server').innerHTML = '<span class="warn">OCR サーバに届かない（./run.sh で起動しているか）</span>';
    res = { ok: false, text: '' };
  }
  if (st.id !== id || st.name !== 'reading') return;    // 読んでいるあいだに動かされた

  const text = res.ok ? (res.text || '') : '';
  if (!text) {
    st.name = 'unread';
    log('', res.ok ? `${res.ms}ms` : 'エラー');
    $('lastRead').textContent = `読めず（${cropCanvas.width}×${cropCanvas.height}px を渡した）`;
    return;
  }
  st.name = 'read'; st.text = text; st.readT = now();
  log(text, `確信度 ${(+res.conf).toFixed(2)} ・ ${res.ms}ms`);
  $('lastRead').textContent = `「${text}」（${cropCanvas.width}×${cropCanvas.height}px を渡した）`;
  ch.postMessage({
    type: 'read', id, text, gw, gh, mask: gridMask, shape,
    bbox: { x0: b.x0 / gw, y0: b.y0 / gh, x1: (b.x1 + 1) / gw, y1: (b.y1 + 1) / gh },
  });

  const e = EMOJI[text];
  if (e) {
    const t = now();
    if (t - (lastEmoji[text] ?? -1e9) >= TIME.EMOJI_COOLDOWN_SEC) {
      ch.postMessage({ type: 'emoji', ch: e });
      st.pausedUntil = t + TIME.EMOJI_SEC + 0.3;   // 流れている絵文字を部品と取り違えないよう、そのあいだは見ない
    }
    lastEmoji[text] = t;
  }
}

// 残す形。格子より細かく、元の解像度の映像から白い面の向きに写し直して二値にする。
// 格子で部品と判定された塊の近くだけを拾うので、ゴミや縁は入らない。
function traceShape(b, gridMask) {
  const near = dilate(gridMask, 2);
  const u0 = b.x0 / gw, v0 = b.y0 / gh, u1 = (b.x1 + 1) / gw, v1 = (b.y1 + 1) / gh;
  const wPx = (u1 - u0) * surf.w, hPx = (v1 - v0) * surf.h;
  const w = Math.max(16, Math.min(720, Math.round(wPx * 2)));
  const h = Math.max(16, Math.round(w * hPx / wPx));
  const data = new Uint8Array(w * h);
  const vw = full.width, vh = full.height;
  const px = fctx.getImageData(0, 0, vw, vh).data;
  const L = (x, y) => { const k = (y * vw + x) * 4; return (px[k] * 77 + px[k + 1] * 150 + px[k + 2] * 29) >> 8; };
  for (let y = 0; y < h; y++) {
    const v = v0 + (y + 0.5) / h * (v1 - v0);
    for (let x = 0; x < w; x++) {
      const u = u0 + (x + 0.5) / w * (u1 - u0);
      if (!near[Math.min(gh - 1, (v * gh) | 0) * gw + Math.min(gw - 1, (u * gw) | 0)]) continue;
      const [fx, fy] = project(u, v);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= vw || y0 + 1 >= vh) continue;
      const ax = fx - x0, ay = fy - y0;
      const l = (L(x0, y0) * (1 - ax) + L(x0 + 1, y0) * ax) * (1 - ay) + (L(x0, y0 + 1) * (1 - ax) + L(x0 + 1, y0 + 1) * ax) * ay;
      data[y * w + x] = S.darkParts ? (l < S.threshold ? 1 : 0) : (l > S.threshold ? 1 : 0);
    }
  }
  return { w, h, data };
}

let cropUrl = null;
function showCrop(blob) {
  if (cropUrl) URL.revokeObjectURL(cropUrl);
  cropUrl = URL.createObjectURL(blob);
  $('crop').src = cropUrl;
  $('crop').hidden = false;
}

function log(text, note) {
  const li = document.createElement('li');
  const d = new Date();
  li.innerHTML = `<time>${d.toTimeString().slice(0, 8)}</time><b></b><span class="hint"></span>`;
  li.querySelector('b').textContent = text || '読めず';
  li.querySelector('span').textContent = note;
  if (!text) li.className = 'miss';
  $('log').prepend(li);
  while ($('log').children.length > 60) $('log').lastChild.remove();
}

// ================================================================ 表示

const STATE_VIEW = {
  empty:    ['#ccc',    '何も置かれていない', ''],
  settling: ['#999',    '静止を待っている', '手を止めると読ませる'],
  reading:  ['#3e9be0', '読ませている', ''],
  unread:   ['#bbb',    '読めず', '何もしない。動かせばまた読む'],
  read:     ['#ffb01f', '読めた', '置いたままにすると残る'],
  fixed:    ['#2f9e44', '残した', '片付けるか、組み直す'],
  error:    ['#e5484d', '', ''],
};

function setState(name, text, sub) {
  const [c, t, s] = STATE_VIEW[name] || STATE_VIEW.error;
  $('stateDot').style.background = c;
  $('stateText').textContent = text ?? t;
  $('stateSub').textContent = sub ?? s;
}

function renderState(t) {
  if (S.calib) { setState('settling', '四隅合わせ中', 'このあいだは読まない'); $('bar').firstChild.style.width = '0'; return; }
  const extra = st.name === 'read' || st.name === 'fixed' ? `「${st.text}」` : '';
  const [c, label, sub] = STATE_VIEW[st.name];
  setState(st.name, label + extra, t < st.pausedUntil ? '絵文字が流れているあいだはカメラを見ない' : sub);
  let p = 0;
  if (st.name === 'settling') p = (t - st.refT) / TIME.STILL_SEC;
  if (st.name === 'read') p = (t - st.readT) / TIME.HOLD_SEC;
  if (st.name === 'fixed') p = 1;
  $('bar').firstChild.style.width = `${Math.min(1, Math.max(0, p)) * 100}%`;
  $('bar').firstChild.style.background = c;
}

const camCtx = $('cam').getContext('2d');
function drawCam(det) {
  const c = $('cam'), W = c.width, H = c.height;
  camCtx.drawImage(video, 0, 0, W, H);
  if (!Hm) return;
  const k = W / video.videoWidth;
  const P = (u, v) => project(u, v).map(z => z * k);
  const poly = (pts, stroke, dash, width = 2) => {
    camCtx.save();
    camCtx.setLineDash(dash || []);
    camCtx.strokeStyle = stroke; camCtx.lineWidth = width;
    camCtx.beginPath();
    pts.forEach(([x, y], i) => i ? camCtx.lineTo(x, y) : camCtx.moveTo(x, y));
    camCtx.closePath(); camCtx.stroke();
    camCtx.restore();
  };
  poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)], 'rgba(255,255,255,.9)');
  const i = PLACE.inset, R = GATHER.r + GATHER.margin;
  poly([P(i, i), P(1 - i, i), P(1 - i, 1 - i), P(i, 1 - i)], 'rgba(255,255,255,.7)', [6, 6], 1.5);
  poly(Array.from({ length: 48 }, (_, k) => P(GATHER.x + R * Math.cos(k / 48 * Math.PI * 2), GATHER.y + R * Math.sin(k / 48 * Math.PI * 2))),
    'rgba(255,255,255,.7)', [6, 6], 1.5);
  if (det && det.bbox) {
    const b = det.bbox;
    poly([P(b.x0 / gw, b.y0 / gh), P((b.x1 + 1) / gw, b.y0 / gh), P((b.x1 + 1) / gw, (b.y1 + 1) / gh), P(b.x0 / gw, (b.y1 + 1) / gh)],
      st.name === 'read' || st.name === 'fixed' ? '#ffb01f' : '#e5484d', null, 2.5);
  }
  S.corners.forEach(([x, y], i) => {
    const cx = x * W, cy = y * H;
    camCtx.beginPath();
    camCtx.arc(cx, cy, 13, 0, Math.PI * 2);
    camCtx.fillStyle = drag === i ? '#ffb01f' : 'rgba(229,72,77,.9)';
    camCtx.fill();
    camCtx.fillStyle = '#fff';
    camCtx.font = '600 14px "Hiragino Sans", sans-serif';
    camCtx.textAlign = 'center'; camCtx.textBaseline = 'middle';
    camCtx.fillText(String(i + 1), cx, cy + 1);
  });
}

const rectCtx = $('rect').getContext('2d');
const KIND_RGB = { part: [229, 72, 77], small: [62, 155, 224], edge: [240, 160, 32] };
function drawRect() {
  const d = view.data;
  for (let i = 0; i < gw * gh; i++) {
    const k = i * 4;
    if (lut[i] < 0) { d[k] = d[k + 1] = d[k + 2] = 30; d[k + 3] = 255; continue; }
    const l = luma[i];
    const c = label[i] ? KIND_RGB[comps[label[i]].kind] : null;
    if (c) { d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; }
    else { d[k] = d[k + 1] = d[k + 2] = l; }
    d[k + 3] = 255;
  }
  rectCtx.putImageData(view, 0, 0);
}

// ヒストグラム。2つの山（部品と地）のあいだに線を置けばよい、が見て分かるように
const histCtx = $('hist').getContext('2d');
function otsu() {
  let total = 0, sum = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
  if (!total) return null;
  let wB = 0, sumB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

function drawHist() {
  const c = $('hist'), W = c.width, H = c.height;
  histCtx.clearRect(0, 0, W, H);
  let max = 1;
  for (let i = 0; i < 256; i++) max = Math.max(max, Math.log1p(hist[i]));
  const thr = S.threshold;
  // 部品とみなす側を薄く塗る
  histCtx.fillStyle = 'rgba(229,72,77,.08)';
  if (S.darkParts) histCtx.fillRect(0, 0, thr / 255 * W, H);
  else histCtx.fillRect(thr / 255 * W, 0, W - thr / 255 * W, H);
  for (let i = 0; i < 256; i++) {
    const h = Math.log1p(hist[i]) / max * (H - 18);
    const isPart = S.darkParts ? i < thr : i > thr;
    histCtx.fillStyle = isPart ? '#e5484d' : '#9a978d';
    histCtx.fillRect(i / 255 * W, H - h, W / 256 + 0.5, h);
  }
  const o = otsu();
  if (o !== null) {
    histCtx.fillStyle = '#3e9be0';
    histCtx.fillRect(o / 255 * W - 1, H - 10, 2, 10);
  }
  histCtx.fillStyle = '#1d1d1b';
  histCtx.fillRect(thr / 255 * W - 1.5, 0, 3, H);
  histCtx.font = '11px "Hiragino Sans", sans-serif';
  histCtx.textBaseline = 'top';
  histCtx.fillStyle = '#7a786f';
  histCtx.textAlign = 'left'; histCtx.fillText('暗い', 4, 2);
  histCtx.textAlign = 'right'; histCtx.fillText('明るい', W - 4, 2);
  $('thrVal').textContent = thr;

  // 地と部品の平均の差。小さすぎるなら閾値では分けられない
  let a = 0, an = 0, b = 0, bn = 0;
  for (let i = 0; i < 256; i++) {
    if (S.darkParts ? i < thr : i > thr) { a += i * hist[i]; an += hist[i]; } else { b += i * hist[i]; bn += hist[i]; }
  }
  const total = an + bn;
  const note = !total ? '' :
    `部品の側 ${an ? Math.round(a / an) : '-'}（${(an / total * 100).toFixed(1)}%）／ 地の側 ${bn ? Math.round(b / bn) : '-'}` +
    (an / total > 0.3 ? ' — 部品の側が広すぎる。線を地の山から離す' : '') +
    (o !== null ? ` ／ 青い印が自動の位置（${o}）` : '');
  $('histNote').textContent = note;
}

// ================================================================ 操作

let drag = -1;
const camEl = $('cam');
function camPos(e) {
  const r = camEl.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
}
camEl.addEventListener('pointerdown', e => {
  const [x, y] = camPos(e);
  const r = camEl.getBoundingClientRect();
  let best = -1, bd = 1e9;
  S.corners.forEach(([cx, cy], i) => {
    const d = Math.hypot((cx - x) * r.width, (cy - y) * r.height);
    if (d < bd) { bd = d; best = i; }
  });
  if (bd < 40) { drag = best; camEl.setPointerCapture(e.pointerId); }
});
camEl.addEventListener('pointermove', e => {
  if (drag < 0) return;
  const [x, y] = camPos(e);
  S.corners[drag] = [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  rebuildLut();
});
camEl.addEventListener('pointerup', () => {
  if (drag < 0) return;
  drag = -1; save(); resetArrangement();
});

const histEl = $('hist');
let histDrag = false;
function setThrFromEvent(e) {
  const r = histEl.getBoundingClientRect();
  S.threshold = Math.round(Math.min(254, Math.max(1, (e.clientX - r.left) / r.width * 255)));
}
histEl.addEventListener('pointerdown', e => { histDrag = true; histEl.setPointerCapture(e.pointerId); setThrFromEvent(e); });
histEl.addEventListener('pointermove', e => { if (histDrag) setThrFromEvent(e); });
histEl.addEventListener('pointerup', () => { histDrag = false; save(); });

$('otsu').onclick = () => { const o = otsu(); if (o !== null) { S.threshold = o; save(); } };
function renderPolarity() { $('polarity').textContent = S.darkParts ? '部品は地より暗い' : '部品は地より明るい'; }
$('polarity').onclick = () => { S.darkParts = !S.darkParts; renderPolarity(); save(); resetArrangement(); };

$('minArea').value = S.minAreaPct;
$('minArea').oninput = e => { S.minAreaPct = +e.target.value; save(); };
$('level').value = S.surfaceLevel;
$('level').oninput = e => { S.surfaceLevel = +e.target.value; save(); pushSurfaceSettings(); };
$('glow').value = S.glow;
$('glow').oninput = e => { S.glow = e.target.value; save(); pushSurfaceSettings(); };

$('calib').onclick = () => {
  S.calib = !S.calib;
  $('calib').classList.toggle('on', S.calib);
  pushSurfaceSettings();
  resetArrangement();
};
$('wipe').onclick = () => { ch.postMessage({ type: 'wipe' }); st.lastFixed = null; };
$('openSurface').onclick = () => window.open('surface.html', 'yomare-surface', 'width=1280,height=800');

ch.onmessage = ({ data: m }) => {
  if (m.type !== 'hello') return;
  const changed = Math.abs(m.w / m.h - surf.w / surf.h) > 0.01;
  surf = { w: m.w, h: m.h };
  pushSurfaceSettings();
  if (changed && video.videoWidth) rebuild();
};

// ================================================================ ループ

let last = now();
function loop() {
  const t = now(), dt = Math.min(0.1, t - last);
  last = t;
  if (video.readyState >= 2 && lut) {
    const det = detect();
    step(det, t, dt);
    drawCam(det);
    drawRect();
    drawHist();
    renderState(t);
    const counts = { part: 0, small: 0, edge: 0 };
    for (let i = 1; i < comps.length; i++) counts[comps[i].kind]++;
    $('counts').textContent = `部品 ${counts.part}　小さいので無視 ${counts.small}　縁に触れたので無視 ${counts.edge}`;
    $('minAreaVal').textContent = `${S.minAreaPct.toFixed(2)}%`;
    $('levelVal').textContent = S.surfaceLevel;
  }
  requestAnimationFrame(loop);
}

renderPolarity();
setState('empty', 'カメラを待っている', '');
ch.postMessage({ type: 'ping' });
openCamera(S.cameraId).then(() => requestAnimationFrame(loop));
