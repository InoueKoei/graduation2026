// 文字ころがし — 入力した文字のアウトラインがコースになり、その中を赤いボールが転がる。
//
// 編集モード: 文字を打って Enter で配置。ドラッグで寄せると、接したところが複合パスになる。
// 操作モード: 字の中をクリックしてボールを置き、傾けて転がす。
//             M5Stack CoreS3 を USB でつなぐと加速度センサで操作できる（右下の ⇄ USB）。

import { CONFIG } from './config.js';
import { FONT_WEIGHTS } from './fonts.js';
import { loadFont } from './glyph.js';
import { createFontMenu } from './fontmenu.js';
import { Course } from './course.js';
import { Editor } from './editor.js';
import { Ball, WallIndex } from './ball.js';
import { Renderer } from './render.js';
import { SensorFeed } from './sensor.js';
import { analyzePassability } from './passability.js';
import { makeView } from './view.js';
import { supported as localFontsSupported, listJapaneseFamilies, faceBuffer, isCollection } from './localfonts.js';
import './serial.js'; // 右下に「⇄ USB」ボタンを出す副作用のため

const el = {
  canvas: document.getElementById('canvas'),
  text: document.getElementById('text'),
  size: document.getElementById('size'),
  clear: document.getElementById('clear'),
  localFonts: document.getElementById('local-fonts'),
  modeEdit: document.getElementById('mode-edit'),
  modePlay: document.getElementById('mode-play'),
  hint: document.getElementById('hint'),
  status: document.getElementById('status'),
};

const course = new Course();
const renderer = new Renderer(el.canvas);
const ball = new Ball(CONFIG.ball);
const sensor = new SensorFeed();
const editor = new Editor({
  canvas: el.canvas,
  course,
  onChange: () => { previewDirty = true; },
  getView: () => view,
});

// --- 傾きの向き合わせ -------------------------------------------------------
//
// config.js を書き換えると Vite がページを読み込み直し、そのたびに USB がいったん切れる。
// 向き合わせは実機をつないだまま何度も試す作業なので、それだと調整にならない。
// 操作モードで X / Y / S を押せばその場で反転でき、選んだ値は localStorage に残る。
// （config.js の値は「初期値」という位置づけになる）

const AXIS_KEY = 'korogashi.axis';

function loadAxis() {
  try {
    const saved = JSON.parse(localStorage.getItem(AXIS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const k of ['invertX', 'invertY', 'swapXY']) {
        if (typeof saved[k] === 'boolean') CONFIG[k] = saved[k];
      }
    }
  } catch (_) { /* 壊れていたら初期値のまま */ }
}

function saveAxis() {
  const { invertX, invertY, swapXY } = CONFIG;
  try { localStorage.setItem(AXIS_KEY, JSON.stringify({ invertX, invertY, swapXY })); } catch (_) {}
}

function axisLabel() {
  return `左右 ${CONFIG.invertX ? '反転' : '正'} / 上下 ${CONFIG.invertY ? '反転' : '正'}`
    + `${CONFIG.swapXY ? ' / 縦横いれかえ' : ''}`;
}

loadAxis();

let mode = 'edit';
let font = null;
let fontKey = 'b:0';
let size = CONFIG.size.default;
let preview = [];
let previewDirty = true;
let walls = new WallIndex([]);
let wallsVersion = -1;
let passable = null;
let passTimer = 0;
// 盤面の見え方。クリック位置を盤面座標に戻すのにも使う
let view = makeView({ w: 0, h: 0, tilt: { x: 0, y: 0 }, cfg: CONFIG.view, focus: null });
// カメラの寄り。玉を追いかける。makeView は毎フレーム作り直すので、状態はここに置く
const focus = { x: 0, y: 0, zoom: 1, ready: false };

el.size.min = String(CONFIG.size.min);
el.size.max = String(CONFIG.size.max);
el.size.value = String(size);

// --- 書体 -----------------------------------------------------------------
//
// 書体の指定は文字列 1 本で持つ。
//   'b:<index>'  … public/fonts/ に同梱したもの（fonts.js の FONT_WEIGHTS）
//   'l:<family>' … OS に入っているもの（localfonts.js が拾ってくる）

let fontMenu = null;
let localFamilies = [];          // { family, faces, face }
const localCache = new Map();    // family → opentype.Font

function bundledOptions() {
  return FONT_WEIGHTS.map((f, i) => {
    // メニューの各項目をその書体自身で描くために CSS 側にも登録しておく
    const family = `korogashi-${i}`;
    new FontFace(family, `url(${f.url})`).load()
      .then((loaded) => document.fonts.add(loaded))
      .catch(() => {});
    return { value: `b:${i}`, label: f.label, family };
  });
}

function rebuildFontMenu(selected) {
  const options = bundledOptions();
  localFamilies.forEach((lf, i) => {
    options.push({
      value: `l:${lf.family}`,
      label: lf.family,
      family: lf.family,      // OS の書体なので CSS からそのまま使える
      groupHead: i === 0,     // 同梱書体との境目に線を引く
    });
  });
  fontMenu.setOptions(options, selected ?? fontKey);
}

async function setupFonts() {
  fontMenu = createFontMenu({
    button: document.getElementById('font-menu-button'),
    current: document.getElementById('font-menu-current'),
    list: document.getElementById('font-menu-list'),
    onChange: (v) => { void useFont(v); },
  });

  const idx = Math.max(0, FONT_WEIGHTS.findIndex((f) => f.isDefault));
  fontKey = `b:${idx}`;
  rebuildFontMenu(fontKey);
  await useFont(fontKey);
}

/** 書体キー → opentype.Font。読めなければ null。 */
async function resolveFont(key) {
  if (key.startsWith('b:')) {
    const entry = FONT_WEIGHTS[Number(key.slice(2))];
    if (!entry) return null;
    return loadFont(entry.url);
  }
  if (key.startsWith('l:')) {
    const family = key.slice(2);
    if (localCache.has(family)) return localCache.get(family);
    const lf = localFamilies.find((f) => f.family === family);
    if (!lf) return null;
    const buf = await faceBuffer(lf.face);
    // .ttc は opentype.js が扱えない。読ませる前に見分けて、理由を出せるようにする
    if (isCollection(buf)) {
      const err = new Error('ttc');
      err.code = 'ttc';
      throw err;
    }
    const f = await loadFont(buf);
    localCache.set(family, f);
    return f;
  }
  return null;
}

async function useFont(key) {
  const prevKey = fontKey;
  let next;
  try {
    next = await resolveFont(key);
  } catch (err) {
    if (err && err.code === 'ttc') {
      say('この書体は .ttc（複数書体が 1 ファイル）なので読めない', true);
    } else {
      say('この書体は読めなかった', true);
      console.error(err);
    }
    // 前の書体に戻す。メニューの選択状態も戻す
    fontMenu?.select?.(prevKey, false);
    return;
  }
  if (!next) { fontMenu?.select?.(prevKey, false); return; }

  font = next;
  fontKey = key;

  // 置いてある文字を新しい書体で作り直す
  for (const p of course.pieces) {
    p.font = font;
    p.fontKey = key;
    p.build();
  }
  course.invalidate();
  previewDirty = true;
}

/** OS の書体を拾ってメニューに足す。許可ダイアログが出るのでボタンから呼ぶ。 */
async function addLocalFonts() {
  if (!localFontsSupported()) {
    say('この環境では OS の書体を読めない（Chrome / Edge のデスクトップのみ）', true);
    return;
  }
  el.localFonts.disabled = true;
  say('OS の書体を調べている…');
  try {
    const res = await listJapaneseFamilies();
    if (!res.ok) {
      say(res.reason === 'denied' ? '書体へのアクセスが許可されなかった' : 'この環境では OS の書体を読めない', true);
      return;
    }
    localFamilies = res.families;
    rebuildFontMenu();
    if (localFamilies.length === 0) {
      say(`かなを持つ書体が見つからなかった（${res.scanned} ファミリー中）`, true);
    } else {
      say(`かなのある書体を ${localFamilies.length} 件追加（${res.scanned} ファミリー中）`);
      el.localFonts.textContent = `ローカル書体 ${localFamilies.length}`;
    }
  } finally {
    el.localFonts.disabled = false;
  }
}

// --- モード ---------------------------------------------------------------

function setMode(next) {
  mode = next;
  document.body.classList.toggle('mode-edit', mode === 'edit');
  document.body.classList.toggle('mode-play', mode === 'play');
  el.modeEdit.classList.toggle('is-on', mode === 'edit');
  el.modePlay.classList.toggle('is-on', mode === 'play');
  editor.setEnabled(mode === 'edit');
  if (mode === 'play') {
    preview = [];
    el.text.blur();
  } else {
    ball.remove();
    previewDirty = true;
    el.text.focus();
  }
  updateHint();
}

// --- 入力 -----------------------------------------------------------------

el.text.addEventListener('input', () => {
  // 長すぎると 1 文字ごとの輪郭生成で待たされるので上限を切る
  if ([...el.text.value].length > 8) el.text.value = [...el.text.value].slice(0, 8).join('');
  previewDirty = true;
});

el.text.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (!preview.length) return;
  editor.place(preview);
  preview = [];
  el.text.value = '';
  previewDirty = true;
});

el.size.addEventListener('input', () => {
  size = Number(el.size.value);
  // 選択中の文字があればそれを、無ければ次に置く文字の大きさを変える
  if (editor.selected) {
    editor.selected.resize(size);
    course.invalidate();
  }
  previewDirty = true;
});

el.localFonts.addEventListener('click', () => { void addLocalFonts(); });

el.clear.addEventListener('click', () => {
  editor.clear();
  ball.remove();
  say('');
});

el.modeEdit.addEventListener('click', () => setMode('edit'));
el.modePlay.addEventListener('click', () => setMode('play'));

document.addEventListener('keydown', (e) => {
  const typing = document.activeElement === el.text;
  if (e.key === 'Tab') {
    e.preventDefault();
    setMode(mode === 'edit' ? 'play' : 'edit');
    return;
  }
  if (typing) return;
  if (mode === 'edit' && (e.key === 'Delete' || e.key === 'Backspace')) {
    e.preventDefault();
    editor.deleteSelected();
    return;
  }
  if (mode !== 'play') return;
  if (e.key === 'r' || e.key === 'R') { ball.remove(); updateHint(); return; }

  // 実機の向き合わせ。つないだまま押せる
  const k = e.key.toLowerCase();
  if (k === 'x' || k === 'y' || k === 's') {
    if (k === 'x') CONFIG.invertX = !CONFIG.invertX;
    if (k === 'y') CONFIG.invertY = !CONFIG.invertY;
    if (k === 's') CONFIG.swapXY = !CONFIG.swapXY;
    saveAxis();
    say(axisLabel());
  }
});

// --- キャンバスの操作 -----------------------------------------------------

el.canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'play') return;
  const rect = el.canvas.getBoundingClientRect();
  // 板が倒れているぶんを戻して、盤面の座標に直す
  const [x, y] = view.unproject(e.clientX - rect.left, e.clientY - rect.top);
  if (walls.empty) { say('先に文字を置く', true); return; }
  if (!walls.contains(x, y)) { say('字の中をクリックするとボールが出る', true); return; }
  ball.place(x, y);
  say('');
  updateHint();
});

// マウスを擬似的な傾きとして使う（センサ未接続のとき）
el.canvas.addEventListener('pointermove', (e) => {
  const rect = el.canvas.getBoundingClientRect();
  sensor.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  sensor.mouse.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;

  if (mode === 'edit') {
    const b = editor.toBoard(e.clientX - rect.left, e.clientY - rect.top);
    el.canvas.classList.toggle('is-over', !!editor.pick(b.x, b.y));
  }
});

window.addEventListener('resize', () => renderer.resize());

// --- 表示まわり -----------------------------------------------------------

function say(text, warn = false) {
  el.status.textContent = text;
  el.status.classList.toggle('is-shown', !!text);
  el.status.classList.toggle('is-warn', warn);
}

let lastHint = null;

function updateHint() {
  let text;
  if (mode === 'edit') {
    text = course.pieces.length ? 'ドラッグで寄せる／Tab で操作モード' : '文字を入力して Enter';
  } else if (!ball.alive) {
    text = '字の中をクリックして玉を置く';
  } else {
    text = sensor.usingSim
      ? 'マウスの位置が傾き（⇄ USB で実機）'
      : `傾けてころがす　感度 ${sensor.gain.toFixed(1)}（本体の画面で増減）　X 左右 / Y 上下 / S 縦横`;
  }
  // 毎フレーム呼ぶので、変わったときだけ書き換える
  if (text === lastHint) return;
  lastHint = text;
  el.hint.textContent = text;
}

/**
 * コースの状態を伝える。
 *
 * 「線がつながったか」と「玉が通れるか」は別なので、両方見る。
 * 重ねて輪郭が 1 本になっても、くびれが玉より細ければ玉は渡れない
 * （passability.js の冒頭に実測を書いた）。ここで気づけるようにしておく。
 */
function updateStatus() {
  if (course.pieces.length === 0) { say(''); return; }

  const need = CONFIG.ball.radius * 2 * CONFIG.minStrokeRatio;
  const thin = course.pieces.filter((p) => p.ok && p.strokeWidth < need);
  if (thin.length) {
    const chars = [...new Set(thin.map((p) => p.char))].join('');
    say(`「${chars}」の線が細い。大きくすると玉が通る`, true);
    return;
  }

  passable = analyzePassability(course.walls, ball.r);
  if (passable && passable.count === 0) {
    say('どこにも玉が入れない。文字を大きく', true);
  } else if (passable && passable.count > 1) {
    say(`玉が通れる範囲が ${passable.count} か所に分かれている。もっと重ねると 1 つになる`, true);
  } else {
    say('');
  }
}

// --- ループ ---------------------------------------------------------------

let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20); // タブ復帰時の巨大な dt を切る
  last = now;

  if (previewDirty) {
    previewDirty = false;
    preview = (mode === 'edit' && font && el.text.value)
      ? editor.layout(el.text.value, font, fontKey, size, renderer.w / 2, renderer.h / 2)
      : [];
    updateHint();
  }

  // 壁が作り直されていたら、当たり判定のインデックスを張り直す
  const rings = course.walls;
  if (course.version !== wallsVersion) {
    wallsVersion = course.version;
    walls = new WallIndex(rings, Math.max(24, CONFIG.ball.radius * 3));
    // 通行可能かの判定はラスタライズを伴うので、ドラッグ中は回さず、
    // 手が止まってから 1 回だけ走らせる
    clearTimeout(passTimer);
    passTimer = setTimeout(updateStatus, 150);
  }

  sensor.update(dt);
  if (mode === 'play') ball.step(dt, sensor.tilt, walls);

  // 見た目の傾きと玉にかかる力を同じ値から出す。ここが一致していないと
  // 「坂を下っているから転がる」に見えない
  // カメラの寄り。玉が出ているあいだだけ、玉を追って寄る。
  // 追従をわざと遅らせてあるのは、真ん中に張り付くと玉が動いて見えなくなるため。
  const wantZoom = (mode === 'play' && ball.alive) ? CONFIG.view.followZoom : 1;
  const wantX = ball.alive ? ball.x : renderer.w / 2;
  const wantY = ball.alive ? ball.y : renderer.h / 2;
  if (!focus.ready) {
    focus.x = wantX; focus.y = wantY; focus.zoom = wantZoom; focus.ready = true;
  } else {
    const k = 1 - Math.exp(-CONFIG.view.followEase * dt);
    focus.x += (wantX - focus.x) * k;
    focus.y += (wantY - focus.y) * k;
    focus.zoom += (wantZoom - focus.zoom) * k;
  }

  // 編集モードでも同じ俯角で見せる（見え方が揃うし、モードを切り替えても飛ばない）。
  // ただし傾きは乗せない。マウスが傾きを兼ねているので、
  // ドラッグしようとカーソルを動かすと盤まで動いて掴めなくなるため。
  view = makeView({
    w: renderer.w, h: renderer.h,
    tilt: mode === 'play' ? sensor.tilt : { x: 0, y: 0 },
    cfg: CONFIG.view,
    focus: Math.abs(focus.zoom - 1) > 1e-3 ? focus : null,
  });
  // USB がつながった／外れた、玉が消えた、などをヒントに反映する
  updateHint();

  renderer.draw({ course, ball, mode, selected: editor.selected, preview, view });
  requestAnimationFrame(frame);
}

// 開発中の覗き窓。傾きの向き合わせや当たりの確認をコンソールからやるため。
if (import.meta.env?.DEV) {
  window.__korogashi = {
    get course() { return course; },
    get editor() { return editor; },
    get walls() { return walls; },
    get view() { return view; },
    ball, sensor, CONFIG,
    get mode() { return mode; },
    setMode,
  };
}

// --- 起動 -----------------------------------------------------------------

setMode('edit');
updateHint();
setupFonts().then(() => {
  el.text.value = 'ころ';
  previewDirty = true;
  el.text.focus();
});
requestAnimationFrame(frame);
