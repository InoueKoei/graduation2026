// 操作画面。カメラを持ち、部品を検出し、静止したら切り出して OCR へ渡す。
// 白い面へは BroadcastChannel で出来事だけを送る（描くのは surface.js）。
//
// 輪郭（二値化と連結成分）は「静止したか」「どこに置かれたか」を知るためだけに使う。
// OCR へ渡すのはカメラ映像を矩形で切り出しただけの画像で、二値化したものではない。

import { CHANNEL, PLACE, GATHER, inPlace, TIME, DEFAULTS } from './common.js';
import { WORDS as EMOJI, FLOW } from './emoji.js';

const $ = id => document.getElementById(id);
const ch = new BroadcastChannel(CHANNEL);
const now = () => performance.now() / 1000;

// ================================================================ 設定（この端末に覚えておく）

const STORE = 'yomare.settings.v1';
const S = { ...DEFAULTS, corners: null, cameraId: '', rotate: 0, calib: false };
try { Object.assign(S, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch {}
S.calib = false;
function save() {
  const { calib, ...keep } = S;
  try { localStorage.setItem(STORE, JSON.stringify(keep)); } catch {}
}
function pushSurfaceSettings() {
  ch.postMessage({ type: 'settings', settings: {
    surfaceLevel: S.surfaceLevel, glow: S.glow, ink: S.ink, calib: S.calib, gatherR: S.gatherR,
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

// ================================================================ 映像の向き

// カメラを横向きや逆さに据えても、白い面と同じ向きで見られるように、映像を 90° 単位で（時計回りに）回す。
// ここから先はすべて「回したあとの映像」の座標で扱う。四隅も、OCR へ渡す切り出しも
const frameW = () => S.rotate % 180 ? video.videoHeight : video.videoWidth;
const frameH = () => S.rotate % 180 ? video.videoWidth : video.videoHeight;

// 回したあとの映像を、w×h に描く
function drawFrame(g, w, h) {
  const turned = S.rotate % 180 !== 0;
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(S.rotate * Math.PI / 180);
  g.drawImage(video, -(turned ? h : w) / 2, -(turned ? w : h) / 2, turned ? h : w, turned ? w : h);
  g.restore();
}

// 向きを変えても、合わせた四隅はそのまま白い面の四隅を指すように、同じだけ回す。
// 時計回りに 90° 回すと、映像の (x, y) は (1 - y, x) へ移る
function setRotate(deg) {
  for (let k = ((deg - S.rotate) / 90 + 4) % 4; k > 0; k--) {
    if (S.corners) S.corners = S.corners.map(([x, y]) => [1 - y, x]);
  }
  S.rotate = deg;
  save();
  onVideoSize();
}
$('rotSel').value = String(S.rotate);
$('rotSel').onchange = e => setRotate(+e.target.value);

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

let luma, bin, label, glabel, partMask, view;
let comps = [];
const hist = new Uint32Array(256);

function onVideoSize() {
  if (!video.videoWidth) return;
  small.width = SMALL_W;
  small.height = Math.round(SMALL_W * frameH() / frameW());
  const cam = $('cam');
  cam.width = 960;
  cam.height = Math.round(960 * frameH() / frameW());
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
  luma = new Uint8Array(n); bin = new Uint8Array(n); partMask = new Uint8Array(n);
  label = new Int32Array(n); glabel = new Int32Array(n);
  const rc = $('rect');
  rc.width = gw; rc.height = gh;
  view = rc.getContext('2d').createImageData(gw, gh);
  rebuildLut();
  tracks = [];                // 格子が変わると塊の座標も変わるので、動かない塊の記録は捨てる
  memory = [];                // 残した配置の記憶も同じ
  resetArrangement('格子を作り直した');
}

function rebuildLut() {
  if (!video.videoWidth || !S.corners) return;
  Hm = homography(S.corners.map(([x, y]) => [x * frameW(), y * frameH()]));
  lut = new Int32Array(gw * gh).fill(-1);
  const kx = small.width / frameW(), ky = small.height / frameH();
  placeArea = 0;
  for (let y = zone.y0; y < zone.y1; y++) {
    for (let x = zone.x0; x < zone.x1; x++) {
      const u = (x + 0.5) / gw, v = (y + 0.5) / gh;
      if (!inPlace(u, v, S.gatherR)) continue;     // 中央の円は集まる場。見ない（円の縁に触れた塊は捨てられる）
      const [px, py] = project(u, v);
      const sx = Math.round(px * kx), sy = Math.round(py * ky);
      if (sx < 0 || sy < 0 || sx >= small.width || sy >= small.height) continue;
      lut[y * gw + x] = (sy * small.width + sx) * 4;
      placeArea++;
    }
  }
}

// 1フレームぶんの検出。部品を連結成分に分け、近いものどうしを「ひとまとまり（1語）」に束ねて返す。
// paused のあいだ（絵文字が置く場の上にある）は、動かない塊の記録を更新しない。
// 中央へ飛ぶ形の道筋（quiet）にかかる塊も同じ
function detect(t, paused) {
  drawFrame(sctx, small.width, small.height);
  const px = sctx.getImageData(0, 0, small.width, small.height).data;
  hist.fill(0);
  bin.fill(0); label.fill(0); partMask.fill(0); glabel.fill(0);
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
  const minArea = minAreaPx();
  comps = [{}];
  const stack = new Int32Array(gw * gh);
  for (let y = zone.y0; y < zone.y1; y++) {
    for (let x = zone.x0; x < zone.x1; x++) {
      const s = y * gw + x;
      if (!bin[s] || label[s]) continue;
      const id = comps.length;
      const c = { area: 0, x0: x, y0: y, x1: x, y1: y, touch: false, seed: s };
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
  trackStatic(t, paused);

  // ひとまとまり：部品を「間隔の半分」ずつ膨らませ、つながったものを1語とみなす。
  // テーブルを囲んで何人かが別々に組んでも、語ごとに分けて読ませるため。
  // 膨らませた範囲は中央の円の上を通ってもよい（円をはさんだ2つの部品の近さは、見た目どおりの距離で決める）
  for (let y = zone.y0; y < zone.y1; y++) {
    for (let x = zone.x0; x < zone.x1; x++) {
      const i = y * gw + x;
      if (label[i] && comps[label[i]].kind === 'part') partMask[i] = 1;   // 動かない塊・小さい塊は入れない
    }
  }
  const groups = [];
  let area = 0;
  if (comps.some(c => c.kind === 'part')) {
    const r = Math.max(1, Math.round(gw * S.groupGapPct / 100 / 2));
    const grown = dilate(partMask, r);
    for (let y = zone.y0; y < zone.y1; y++) {
      for (let x = zone.x0; x < zone.x1; x++) {
        const s = y * gw + x;
        if (!grown[s] || glabel[s]) continue;
        const id = groups.length + 1;
        let sp = 0;
        stack[sp++] = s; glabel[s] = id;
        while (sp) {
          const i = stack[--sp];
          const cx = i % gw, cy = (i / gw) | 0;
          if (cx > zone.x0 && grown[i - 1] && !glabel[i - 1]) { glabel[i - 1] = id; stack[sp++] = i - 1; }
          if (cx < zone.x1 - 1 && grown[i + 1] && !glabel[i + 1]) { glabel[i + 1] = id; stack[sp++] = i + 1; }
          if (cy > zone.y0 && grown[i - gw] && !glabel[i - gw]) { glabel[i - gw] = id; stack[sp++] = i - gw; }
          if (cy < zone.y1 - 1 && grown[i + gw] && !glabel[i + gw]) { glabel[i + gw] = id; stack[sp++] = i + gw; }
        }
        groups.push({ id, area: 0, n: 0, x0: gw, y0: gh, x1: -1, y1: -1 });
      }
    }
    for (const c of comps) {
      if (c.kind !== 'part') continue;
      const g = groups[glabel[c.seed] - 1];
      g.n++; g.area += c.area; area += c.area;
      g.x0 = Math.min(g.x0, c.x0); g.y0 = Math.min(g.y0, c.y0);
      g.x1 = Math.max(g.x1, c.x1); g.y1 = Math.max(g.y1, c.y1);
    }
  }
  return { area, groups: groups.filter(g => g.n) };
}

// 画素 i がまとまり g に属するか。光・残す形・動いたかの判定に使うのは、そのまとまりの「部品」だけ。
// 小さい塊は、たとえ部品の近くにあっても入れない（てん が小さい塊に落ちるなら、小さい塊のスライダーを下げる）
const inGroup = (i, g) => partMask[i] && glabel[i] === g.id ? 1 : 0;

function groupMask(g) {
  const m = new Uint8Array(gw * gh);
  for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) {
    const i = y * gw + x;
    m[i] = inGroup(i, g);
  }
  return m;
}

// ---------------------------------------------------------------- 動かない塊
//
// 布の柄や汚れ、置いたまま片付けていない字のように、STATIC_SEC のあいだ変わらない塊は無視する。
// 塊は外接矩形の重なり（IoU）で追いかけるので、少し揺れても同じ塊とみなす。
//
// ただし時間だけで決めると、組んでいる途中の字まで消える。そこで2つの例外を置く。
//   ・近くで部品が現れた／消えたら、まわりの塊の時計を最初から数え直す（組み足している最中）
//   ・静止を待つ〜読めて保持しているまとまりの近くでは、まだ動かないと決まっていない塊の時計を止める
//     （読めてから残るまで約6秒かかるので、止めないと残す前に部品が消える）。
//     止めるのはそのまとまりの近くだけ。ほかの人が組んでいるあいだも、離れた柄や汚れは無視されていく

const STATIC_SEC = 5;        // これだけ変わらなければ無視する
const LOST_SEC = 0.5;        // これだけ見えなければ「どけた」とみなす（際のちらつきは数えない）
let tracks = [];             // { x0, y0, x1, y1, area, since, seen, kind }

function iou(a, b) {
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
  const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  const ua = (a.x1 - a.x0 + 1) * (a.y1 - a.y0 + 1) + (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) - inter;
  return inter / ua;
}

// 外接矩形どうしの隙間が r 以内か
function near(a, b, r) {
  const gx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const gy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
  return Math.hypot(gx, gy) <= r;
}

function trackStatic(t, paused) {
  const used = new Set();
  const events = [];         // 部品が現れた／消えた場所
  for (let i = 1; i < comps.length; i++) {
    const c = comps[i];
    if (c.kind === 'edge') continue;
    let best = null, bv = 0;
    for (const tr of tracks) {
      if (used.has(tr)) continue;
      const r = c.area / tr.area;
      if (r < 0.6 || r > 1.67) continue;
      const v = iou(c, tr);
      if (v >= 0.5 && v > bv) { bv = v; best = tr; }
    }
    const hush = paused || isQuiet(c);
    if (best) {
      used.add(best);
      c.track = best;
      if (!hush) Object.assign(best, { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, area: c.area, seen: t, kind: c.kind });
    } else if (!hush) {
      const tr = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, area: c.area, since: t, seen: t, kind: c.kind };
      tracks.push(tr); used.add(tr); c.track = tr;
      if (c.kind === 'part') events.push(tr);   // 小さい塊（ゴミ）の明滅では数え直さない
    }
  }
  if (!paused) {
    tracks = tracks.filter(tr => {
      if (t - tr.seen <= LOST_SEC || isQuiet(tr)) return true;   // 道筋の上は見ていないので、どけたとは数えない
      if (tr.kind === 'part') events.push(tr);
      return false;
    });
    const R = Math.round(gw * 0.08);
    for (const e of events) for (const tr of tracks) if (tr !== e && near(tr, e, R)) tr.since = t;
    const busy = trackers.filter(x => ['settling', 'reading', 'read'].includes(x.name));
    const Rg = Math.round(gw * S.groupGapPct / 100);
    for (const tr of tracks) {
      if (t - tr.since < STATIC_SEC && busy.some(x => near(tr, x.box, Rg))) tr.since = t;
    }
  }
  for (let i = 1; i < comps.length; i++) {
    const c = comps[i];
    if (c.track && t - c.track.since >= STATIC_SEC) c.kind = 'static';
  }
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

// ================================================================ まとまりごとの状態

// まとまり（1語）ごとに、次の順で進む。テーブルを囲む何人かが、それぞれのペースで組めるように
// settling →（静止）→ reading → read →（保持）→ fixed
//                            ↘ unread（何もしない。動かせばまた読む）
// 前のフレームのまとまりとは、基準の配置を少し膨らませた範囲と重なるかで対応づける
let trackers = [];
let nextId = 0;
let pausedUntil = 0;   // 絵文字が流れているあいだ。白い面の全体を流れるので、全部止める
// 残した形が中央へ縮んでいく道筋。そこだけしばらく見ない（ほかの人の語は止めない）
let quiet = [];        // { box, until }
// 残した配置の記憶（最近の 20）。腕が一瞬かぶって戻っただけなら、同じ形を二重に残さない。
// その場所から物が本当になくなって 2秒たてば消えるので、片付けて組み直せばまた残る
let memory = [];
const lastEmoji = {};

function resetArrangement(why) {
  for (const tr of trackers) if (tr.name === 'read') ch.postMessage({ type: 'clear', id: tr.id });
  for (const tr of trackers) tr.name = 'gone';
  trackers = [];
  if (why) console.log(why);
}

function dropTracker(tr) {
  if (tr.name === 'read') ch.postMessage({ type: 'clear', id: tr.id });
  tr.name = 'gone';   // 読んでいる最中なら、その読みは捨てられる
  trackers = trackers.filter(x => x !== tr);
}

// 基準にする配置を、いまのまとまり g から取り直す
function setRef(tr, g) {
  const d = Math.round(gw * 0.025);
  tr.ref = groupMask(g);
  tr.refDil = dilate(tr.ref, d);
  tr.refArea = g.area;
  tr.bbox = { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 };
  tr.box = {
    x0: Math.max(0, g.x0 - d), y0: Math.max(0, g.y0 - d),
    x1: Math.min(gw - 1, g.x1 + d), y1: Math.min(gh - 1, g.y1 + d),
  };
}

// 基準の配置からどれだけ変わったか。際のちらつきや光の滲みは、膨らませた範囲の内側なので数えない
function differs(g, ref, refDil, refArea, box) {
  let lost = 0, added = 0;
  const x0 = Math.min(g.x0, box.x0), x1 = Math.max(g.x1, box.x1);
  const y0 = Math.min(g.y0, box.y0), y1 = Math.max(g.y1, box.y1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * gw + x, m = inGroup(i, g);
    if (ref[i] && !m) lost++;
    else if (m && !refDil[i]) added++;
  }
  return lost / refArea > 0.3 || added / refArea > 0.15 || Math.abs(g.area - refArea) / refArea > 0.4;
}

// まとまり g の部品のうち、どれだけが refDil の内側にあるか（0〜1）
function overlap(g, refDil) {
  let n = 0;
  for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) {
    const i = y * gw + x;
    if (refDil[i] && partMask[i] && glabel[i] === g.id) n++;
  }
  return n / g.area;
}

const meets = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
const isQuiet = b => quiet.some(q => meets(q.box, b));

function newTracker(g, t) {
  const tr = { id: ++nextId, name: 'settling', refT: t, changedFor: 0, goneFor: 0, text: '', readT: 0, g };
  setRef(tr, g);
  const f = memory.find(e => !differs(g, e.ref, e.refDil, e.refArea, e.box));
  if (f) { tr.name = 'fixed'; tr.text = f.text; }
  trackers.push(tr);
}

// 「部品が無い」では判断しない。残した字は5秒で動かない塊として無視されるが、物はまだそこにある。
// 二値の画素で、残した形の場所がほとんど空いたかを見る
function updateMemory(dt) {
  for (const e of memory) {
    if (isQuiet(e.box)) continue;   // 見ていないあいだは、片付けられたとは数えない
    let left = 0;
    for (let y = e.box.y0; y <= e.box.y1; y++) for (let x = e.box.x0; x <= e.box.x1; x++) {
      const i = y * gw + x;
      if (e.ref[i] && bin[i]) left++;
    }
    e.emptyFor = left < e.refArea * 0.1 ? e.emptyFor + dt : 0;
  }
  memory = memory.filter(e => e.emptyFor < 2);
}

function step(det, t, dt) {
  quiet = quiet.filter(q => t < q.until);
  const paused = S.calib || t < pausedUntil;
  if (!paused) {
    for (const tr of trackers) tr.hits = [];
    for (const g of det.groups) {
      g.quiet = isQuiet(g);
      g.trs = trackers.filter(tr => overlap(g, tr.refDil) > 0.3);
      for (const tr of g.trs) tr.hits.push(g);
    }
    for (const tr of [...trackers]) {
      // 縮んでいく形が重なっているかもしれない。見えたものを信じず、そのまま待つ
      tr.frozen = isQuiet(tr.box) || tr.hits.some(g => g.quiet);
      if (tr.frozen) continue;
      if (!tr.hits.length) {
        // 片付けられた
        tr.goneFor += dt;
        if (tr.goneFor >= TIME.MOVE_CONFIRM_SEC) dropTracker(tr);
        continue;
      }
      tr.goneFor = 0;
      const g = tr.hits[0];
      tr.g = g;
      // 割れた・隣とくっついた・形が変わった、のどれも「動かした」として扱う
      const changed = tr.hits.length > 1 || g.trs.length > 1 || differs(g, tr.ref, tr.refDil, tr.refArea, tr.box);
      if (!changed) { tr.changedFor = 0; continue; }
      tr.changedFor += dt;
      if (tr.changedFor >= TIME.MOVE_CONFIRM_SEC) dropTracker(tr);   // 次のフレームで新しい配置として拾い直す
    }
    for (const g of det.groups) if (!g.trs.length && !g.quiet) newTracker(g, t);
    for (const tr of trackers) {
      if (tr.name === 'settling' && !tr.frozen && tr.changedFor === 0 && t - tr.refT >= TIME.STILL_SEC) read(tr, tr.g);
    }
    updateMemory(dt);
  }
  for (const tr of trackers) {
    if (tr.name === 'read' && t - tr.readT >= TIME.HOLD_SEC) {
      tr.name = 'fixed';
      memory.push({ ref: tr.ref, refDil: tr.refDil, refArea: tr.refArea, box: tr.box, text: tr.text, emptyFor: 0 });
      if (memory.length > 20) memory.shift();
      ch.postMessage({ type: 'fix', id: tr.id });
      // 部品は置かれていた場所から中心へ、置く場を横切って飛んでいく。そのあいだ、その道筋だけを見ない。
      // 道筋は、まとまりの枠と円の中心を両方含む矩形に、横へのふくらみ（最大 0.08）のぶんの余裕を足したもの
      const d = Math.round(gw * 0.1);
      const cx = Math.round(GATHER.x * gw), cy = Math.round(GATHER.y * gh);
      quiet.push({
        until: t + TIME.GATHER_SEC + 0.3,
        box: {
          x0: Math.max(0, Math.min(tr.box.x0, cx) - d), y0: Math.max(0, Math.min(tr.box.y0, cy) - d),
          x1: Math.min(gw - 1, Math.max(tr.box.x1, cx) + d), y1: Math.min(gh - 1, Math.max(tr.box.y1, cy) + d),
        },
      });
      log(tr.text, '残した');
    }
  }
}

// ================================================================ 読ませる

const full = document.createElement('canvas');
const fctx = full.getContext('2d', { willReadFrequently: true });

async function read(tr, g) {
  tr.name = 'reading';
  // 読ませる瞬間の配置を基準にし直す（保持の判定はこれと比べる）
  setRef(tr, g);
  const id = tr.id;
  const b = tr.bbox;
  const gridMask = tr.ref;

  // 切り出す範囲：まとまりの外接矩形に余白を足し、カメラ映像の座標へ写す
  const m = Math.round(Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.25) + 4;
  const q = [[b.x0 - m, b.y0 - m], [b.x1 + 1 + m, b.y0 - m], [b.x1 + 1 + m, b.y1 + 1 + m], [b.x0 - m, b.y1 + 1 + m]];
  const pts = q.map(([x, y]) => project(x / gw, y / gh));
  const vw = frameW(), vh = frameH();
  const sx = Math.max(0, Math.floor(Math.min(...pts.map(p => p[0]))));
  const sy = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1]))));
  const ex = Math.min(vw, Math.ceil(Math.max(...pts.map(p => p[0]))));
  const ey = Math.min(vh, Math.ceil(Math.max(...pts.map(p => p[1]))));

  // 同じ瞬間の映像から、切り出し（OCR 用）と、残す形（白い面用）の両方を取る。
  // 同じフレームで複数のまとまりを読ませることがあるので、切り出しはまとまりごとに別のキャンバス
  full.width = vw; full.height = vh;
  drawFrame(fctx, vw, vh);
  const crop = document.createElement('canvas');
  crop.width = ex - sx; crop.height = ey - sy;
  crop.getContext('2d').drawImage(full, sx, sy, ex - sx, ey - sy, 0, 0, ex - sx, ey - sy);
  const shape = traceShape(b, gridMask);
  const blob = await new Promise(r => crop.toBlob(r, 'image/png'));
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
  if (tr.name !== 'reading') return;    // 読んでいるあいだに動かされた

  const text = res.ok ? (res.text || '') : '';
  if (!text) {
    tr.name = 'unread';
    log('', res.ok ? `${res.ms}ms` : 'エラー');
    $('lastRead').textContent = `読めず（${crop.width}×${crop.height}px を渡した）`;
    return;
  }
  tr.name = 'read'; tr.text = text; tr.readT = now();
  log(text, `確信度 ${(+res.conf).toFixed(2)} ・ ${res.ms}ms`);
  $('lastRead').textContent = `「${text}」（${crop.width}×${crop.height}px を渡した）`;
  ch.postMessage({
    type: 'read', id, text, gw, gh, mask: gridMask, shape,
    bbox: { x0: b.x0 / gw, y0: b.y0 / gh, x1: (b.x1 + 1) / gw, y1: (b.y1 + 1) / gh },
  });

  const e = EMOJI[text];
  if (e) {
    const t = now();
    if (t - (lastEmoji[text] ?? -1e9) >= FLOW.COOLDOWN_SEC) {
      ch.postMessage({ type: 'emoji', ch: e });
      pausedUntil = t + FLOW.SEC + 0.3;   // 流れている絵文字を部品と取り違えないよう、そのあいだは見ない
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
  // 小さい塊の基準を、この形の画素の大きさに換算して渡す（白い面が飛ばす前の切り分けで同じ基準を使う）
  const k = w / (b.x1 + 1 - b.x0);
  return { w, h, data, minPx: minAreaPx() * k * k };
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

function progress(tr, t) {
  let p = 0;
  if (tr.name === 'settling') p = (t - tr.refT) / TIME.STILL_SEC;
  if (tr.name === 'read') p = (t - tr.readT) / TIME.HOLD_SEC;
  if (tr.name === 'fixed') p = 1;
  return Math.min(1, Math.max(0, p));
}

const trLabel = tr => STATE_VIEW[tr.name][1] + (tr.name === 'read' || tr.name === 'fixed' ? `「${tr.text}」` : '');

function renderState(t) {
  const bar = $('bar').firstChild;
  const list = $('groups');
  if (S.calib) { setState('settling', '四隅合わせ中', 'このあいだは読まない'); bar.style.width = '0'; list.replaceChildren(); return; }
  const pausedNote = t < pausedUntil ? '絵文字が流れているあいだはカメラを見ない' : null;
  if (trackers.length <= 1) {
    const tr = trackers[0];
    const name = tr ? tr.name : 'empty';
    setState(name, tr ? trLabel(tr) : undefined, pausedNote ?? undefined);
    bar.style.width = `${tr ? progress(tr, t) * 100 : 0}%`;
    bar.style.background = STATE_VIEW[name][0];
    list.replaceChildren();
    return;
  }
  // 何人かが別々に組んでいる。全体は数だけにして、まとまりごとの状態を並べる
  setState('settling', `${trackers.length}つのまとまり`, pausedNote ?? 'それぞれ別に読ませ、別に残す');
  $('stateDot').style.background = '#1d1d1b';
  bar.style.width = '0';
  list.replaceChildren(...trackers.map(tr => {
    const li = document.createElement('li');
    const color = STATE_VIEW[tr.name][0];
    li.innerHTML = '<i></i><span></span><div class="bar"><div></div></div>';
    li.querySelector('i').style.background = color;
    li.querySelector('span').textContent = trLabel(tr);
    const fill = li.querySelector('.bar div');
    fill.style.width = `${progress(tr, t) * 100}%`;
    fill.style.background = color;
    return li;
  }));
}

const camCtx = $('cam').getContext('2d');
function drawCam(det) {
  const c = $('cam'), W = c.width, H = c.height;
  drawFrame(camCtx, W, H);
  if (!Hm) return;
  const k = W / frameW();
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
  const i = PLACE.inset, R = S.gatherR + GATHER.margin;
  poly([P(i, i), P(1 - i, i), P(1 - i, 1 - i), P(i, 1 - i)], 'rgba(255,255,255,.7)', [6, 6], 1.5);
  poly(Array.from({ length: 48 }, (_, k) => P(GATHER.x + R * Math.cos(k / 48 * Math.PI * 2), GATHER.y + R * Math.sin(k / 48 * Math.PI * 2))),
    'rgba(255,255,255,.7)', [6, 6], 1.5);
  // まとまりごとの枠。読めた・残したものは光の色、それ以外は赤
  for (const g of det ? det.groups : []) {
    const tr = trackers.find(x => x.g === g);
    const lit = tr && (tr.name === 'read' || tr.name === 'fixed');
    poly([P(g.x0 / gw, g.y0 / gh), P((g.x1 + 1) / gw, g.y0 / gh), P((g.x1 + 1) / gw, (g.y1 + 1) / gh), P(g.x0 / gw, (g.y1 + 1) / gh)],
      lit ? '#ffb01f' : '#e5484d', null, 2.5);
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
const KIND_RGB = { part: [229, 72, 77], small: [62, 155, 224], edge: [240, 160, 32], static: [120, 120, 120] };
function drawRect(det) {
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
  // ひとまとまり（1語として読む範囲）を点線の枠で。地は白っぽいので、枠は暗い色にする
  rectCtx.save();
  rectCtx.strokeStyle = '#1d1d1b';
  rectCtx.lineWidth = 1.5;
  rectCtx.setLineDash([4, 3]);
  for (const g of det.groups) rectCtx.strokeRect(g.x0 - 2.5, g.y0 - 2.5, g.x1 - g.x0 + 6, g.y1 - g.y0 + 6);
  rectCtx.restore();
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

// 小さい塊の目盛りは対数。0.001〜1% を均等に割ると、使う 0.01〜0.1% が左端に潰れてしまう
const AREA_LO = Math.log10(0.001), AREA_HI = Math.log10(1);
const areaToPos = pct => Math.round((Math.log10(Math.max(0.001, pct)) - AREA_LO) / (AREA_HI - AREA_LO) * 1000);
const posToArea = pos => Math.pow(10, AREA_LO + (AREA_HI - AREA_LO) * pos / 1000);
function minAreaPx() { return Math.max(2, placeArea * S.minAreaPct / 100); }
$('minArea').value = areaToPos(S.minAreaPct);
$('minArea').oninput = e => { S.minAreaPct = posToArea(+e.target.value); save(); };
$('groupGap').value = S.groupGapPct;
$('groupGap').oninput = e => { S.groupGapPct = +e.target.value; save(); };
$('level').value = S.surfaceLevel;
$('level').oninput = e => { S.surfaceLevel = +e.target.value; save(); pushSurfaceSettings(); };
$('glow').value = S.glow;
$('glow').oninput = e => { S.glow = e.target.value; save(); pushSurfaceSettings(); };
$('gather').min = GATHER.rMin; $('gather').max = GATHER.rMax;
$('gather').value = S.gatherR;
// 動かしているあいだも検出の範囲を作り直す（格子1枚ぶんの射影なので、手で動かす速さなら追いつく）
$('gather').oninput = e => {
  S.gatherR = +e.target.value;
  rebuildLut();
  resetArrangement();
  pushSurfaceSettings();
};
$('gather').onchange = () => save();

$('calib').onclick = () => {
  S.calib = !S.calib;
  $('calib').classList.toggle('on', S.calib);
  pushSurfaceSettings();
  resetArrangement();
};
$('wipe').onclick = () => { ch.postMessage({ type: 'wipe' }); memory = []; };
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
    const det = detect(t, S.calib || t < pausedUntil);
    step(det, t, dt);
    drawCam(det);
    drawRect(det);
    drawHist();
    renderState(t);
    const counts = { part: 0, small: 0, edge: 0, static: 0 };
    for (let i = 1; i < comps.length; i++) counts[comps[i].kind]++;
    $('counts').textContent = `部品 ${counts.part}（${det.groups.length}つのまとまり）　小さいので無視 ${counts.small}　縁に触れたので無視 ${counts.edge}　動かないので無視 ${counts.static}`;
    const p = S.minAreaPct;
    $('minAreaVal').textContent = `${p < 0.1 ? p.toFixed(3) : p.toFixed(2)}%（${Math.round(minAreaPx())}画素未満）`;
    $('groupGapVal').textContent = `${S.groupGapPct.toFixed(1)}%`;
    $('levelVal').textContent = S.surfaceLevel;
    $('gatherVal').textContent = S.gatherR.toFixed(2);
  }
  requestAnimationFrame(loop);
}

renderPolarity();
setState('empty', 'カメラを待っている', '');
ch.postMessage({ type: 'ping' });
openCamera(S.cameraId).then(() => requestAnimationFrame(loop));
