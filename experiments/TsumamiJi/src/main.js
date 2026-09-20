// エントリ。文字と書体の差し替え、ポインタ操作、描画ループ。

import { CONFIG } from './config.js';
import { FONT_WEIGHTS } from './fonts.js';
import { loadFont, buildOutlineRings } from './glyph.js';
import { createRubber } from './rubber.js';
import { createFontMenu } from './fontmenu.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const charInput = document.getElementById('char');
const hintEl = document.getElementById('hint');
const statusEl = document.getElementById('status');

const rubber = createRubber(CONFIG);

let font = null;
let char = CONFIG.char;
let cx = 0; // キャンバス中心（字形の原点をここに置く）
let cy = 0;
let statusTimer = 0;

// 次のフレームで描き直す必要があるか。
// キャンバスは幅・高さを代入した時点で中身が消えるので、リサイズのたびに立てる。
// これが無いと「静止していて計算を休んでいる間にリサイズ」→ 白いまま、になる。
let needsDraw = true;

// --- キャンバス -----------------------------------------------------------

// いまキャンバスに反映してある画面サイズ。変化の検出に使う。
let appliedW = 0;
let appliedH = 0;
let appliedDpr = 0;

/**
 * 画面サイズが変わっていたらキャンバスを合わせ直す。
 *
 * resize イベントに頼らず、毎フレーム自分で見に行く。
 * タブが隠れている間にウィンドウの大きさが変わると、
 *   - 隠れている間は innerWidth が 0 なので、その時の resize は無視するしかない
 *   - 表示に戻ったときには resize イベントがもう飛んでこない
 * となり、古い大きさのまま取り残される。毎フレーム比べれば取りこぼさない。
 * 比較 3 回ぶんの費用しかかからないうえ、DPR の変化（画面をまたぐ移動）も拾える。
 *
 * @returns {boolean} 合わせ直したか
 */
function syncSize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w === 0 || h === 0) return false; // 隠れている間は触らない

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (w === appliedW && h === appliedH && dpr === appliedDpr) return false;

  appliedW = w;
  appliedH = h;
  appliedDpr = dpr;

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = w / 2;
  cy = h / 2;
  needsDraw = true;
  return true;
}

/** 画面の短辺から字面の大きさを決める */
function glyphSize() {
  const short = Math.min(appliedW, appliedH);
  // 起動直後は画面サイズがまだ取れていないことがある。0 で組むと輪郭が潰れて
  // 「この書体にその字は無い」と誤判定するため下限を置く。
  // 正しい大きさは、その後 syncSize が拾って組み直す。
  return Math.max(48, Math.min(short * CONFIG.sizeRatio, CONFIG.sizeMax));
}

// --- 字形の組み直し -------------------------------------------------------

/**
 * いまの font / char / 画面サイズで輪郭を作り直してばね網に載せる。
 * 組み直した直後は静止状態＝描画ループは休むので、明示的に描画を要求する。
 * @returns {boolean} 組めたか（グリフが無い書体だと false）
 */
function rebuild() {
  if (!font) return false;
  // 掴みの半径や伸びの上限は「字面に対する比」で持っているので、
  // 字の大きさが決まるここで px に直しておく（config.js の頭のコメント参照）。
  const size = glyphSize();
  const rings = buildOutlineRings(font, char, size, CONFIG.nodeSpacingEm * size);
  if (!rings) return false;
  rubber.setScale(size);
  rubber.setRings(rings);
  needsDraw = true;
  return true;
}

function showStatus(text) {
  statusEl.textContent = text;
  statusEl.classList.add('is-shown');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusEl.classList.remove('is-shown'), 2200);
}

// --- 描画 -----------------------------------------------------------------

/**
 * 節点列を Catmull-Rom で滑らかにつなぐ。
 * 引き伸ばすと線が細くなって折れ線の粗さが出るため、直線でつながずに曲線にする。
 * 一様 Catmull-Rom → 3次ベジェの標準的な変換（制御点は前後の点の差の 1/6）。
 */
function ringToPath(path, start, count, px, py) {
  // リング内の添字。前後にはみ出したら巻き戻す（閉じた輪なので）
  const idx = (i) => start + (((i % count) + count) % count);

  const first = idx(0);
  path.moveTo(px[first], py[first]);
  for (let i = 0; i < count; i++) {
    const a = idx(i - 1);
    const b = idx(i);
    const c = idx(i + 1);
    const d = idx(i + 2);
    path.bezierCurveTo(
      px[b] + (px[c] - px[a]) / 6,
      py[b] + (py[c] - py[a]) / 6,
      px[c] - (px[d] - px[b]) / 6,
      py[c] - (py[d] - py[b]) / 6,
      px[c],
      py[c],
    );
  }
  path.closePath();
}

const INK =
  getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#1c1a19';

function draw() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (rubber.count === 0) return;

  const path = new Path2D();
  rubber.forEachRing((start, count, px, py) => {
    ringToPath(path, start, count, px, py);
  });

  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = INK;
  // 塗り分けは nonzero（既定）。evenodd ではない。
  //   フォントの輪郭は外周とカウンター（穴）が逆回りに作られているので、
  //   nonzero でも穴はきちんと抜ける。
  //   その上で、引っ張って輪郭が自分自身と重なった部分は、nonzero なら
  //   塗りつぶされたままになる。evenodd だとそこが白く抜けて、
  //   伸ばした線に切れ目や破れが入ったように見えてしまう。
  ctx.fill(path);
  ctx.restore();
}

// --- ループ ---------------------------------------------------------------

let last = performance.now();

function loop(now) {
  const dt = (now - last) / 1000;
  last = now;

  // 画面サイズが変わったら、字面の大きさも変わるので輪郭ごと組み直す。
  // 歪みは持ち越さずに元の字形へ戻す。
  if (syncSize()) {
    rubber.release();
    canvas.classList.remove('is-grabbing');
    if (rebuild()) rubber.snapToRest();
  }

  // 掴んでおらず、揺れも収まっていれば計算を休む
  if (!rubber.isSettled()) {
    rubber.step(dt);
    needsDraw = true;
  }
  if (needsDraw) {
    draw();
    needsDraw = false;
  }
  requestAnimationFrame(loop);
}

// --- ポインタ -------------------------------------------------------------

// 字形の原点（画面中央）を基準にした座標へ直す
function toLocal(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left - cx, y: e.clientY - rect.top - cy };
}

canvas.addEventListener('pointerdown', (e) => {
  const p = toLocal(e);
  if (!rubber.grab(p.x, p.y)) return;
  // 指が画面の外へ出ても引き続けられるように捕捉する。
  // 捕捉できない状況（既にポインタが離れている等）でも、掴み自体は続行してよい。
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* 捕捉できなくても、キャンバスは全面なのでだいたい追える */
  }
  canvas.classList.add('is-grabbing');
  e.preventDefault();
});

canvas.addEventListener('pointermove', (e) => {
  const p = toLocal(e);
  if (rubber.grabbing) {
    rubber.drag(p.x, p.y);
    advanceHint('drag');
  } else {
    // つまめる場所であることを、カーソルで示す
    canvas.classList.toggle('is-over', rubber.canGrab(p.x, p.y));
  }
});

function endGrab(e) {
  if (!rubber.grabbing) return;
  rubber.release();
  canvas.classList.remove('is-grabbing');
  advanceHint('release');
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
}

canvas.addEventListener('pointerup', endGrab);
canvas.addEventListener('pointercancel', endGrab);

// --- ヒント（スケッチの言葉のまま進む） -----------------------------------

let hintStep = 0; // 0:ひっぱる → 1:はなす と もどる → 2:消える

function advanceHint(event) {
  if (hintStep === 0 && event === 'drag') {
    hintStep = 1;
    hintEl.textContent = 'はなす と もどる';
  } else if (hintStep === 1 && event === 'release') {
    hintStep = 2;
    hintEl.classList.add('is-done');
  }
}

// --- 文字の差し替え -------------------------------------------------------

// maxlength で 1 文字に縛ると、IME の変換中の入力を弾いてしまうブラウザがある。
// そこで縛らずに受け、確定後に 1 文字へ切り詰める。
//
// 切り詰めるとき「最後の1文字」ではなく「いま出ている字と違うほう」を採る。
// カーソルが既存の字の手前にあると、打った字は先頭に入る（例: あ → 「の」を打って "のあ"）。
// 単純に最後を採ると、打ったはずの字ではなく元の字が残ってしまう。
function pickChar(value) {
  const chars = [...value]; // サロゲートペア対策
  if (chars.length === 0) return null;
  if (chars.length === 1) return chars[0];
  const fresh = chars.filter((c) => c !== char);
  return fresh.length > 0 ? fresh[fresh.length - 1] : chars[chars.length - 1];
}

function applyChar() {
  const next = pickChar(charInput.value);
  if (!next) return;

  if (next !== char) {
    const prev = char;
    char = next;
    if (!rebuild()) {
      char = prev;
      showStatus('この書体に その字は ありません');
    }
  }
  // 採用できてもできなくても、欄はいま出ている 1 文字に揃える
  charInput.value = char;
}

charInput.addEventListener('input', (e) => {
  if (e.isComposing) return; // 変換中は触らない（触ると変換が壊れる）
  applyChar();
});
charInput.addEventListener('compositionend', applyChar);
// focus だけだと、既に focus 済みの欄を押し直したとき選択されない
charInput.addEventListener('focus', () => charInput.select());
charInput.addEventListener('click', () => charInput.select());

// --- 書体（ウェイト）の切替 -----------------------------------------------

const fontMenu = createFontMenu({
  button: document.getElementById('font-menu-button'),
  current: document.getElementById('font-menu-current'),
  list: document.getElementById('font-menu-list'),
  onChange: (value) => selectWeight(Number(value)),
});

async function selectWeight(index) {
  const weight = FONT_WEIGHTS[index];
  if (!weight) return;
  try {
    font = await loadFont(weight.url);
  } catch (err) {
    console.error(err);
    showStatus('書体を よみこめません');
    return;
  }
  if (!rebuild()) showStatus('この書体に その字は ありません');
}

// --- 起動 -----------------------------------------------------------------

async function start() {
  syncSize();
  charInput.value = char;

  const defaultIndex = Math.max(0, FONT_WEIGHTS.findIndex((w) => w.isDefault));
  fontMenu.setOptions(
    FONT_WEIGHTS.map((w, i) => ({ value: String(i), label: w.label, family: null })),
    String(defaultIndex),
  );

  await selectWeight(defaultIndex);
  requestAnimationFrame(loop);
}

start();
