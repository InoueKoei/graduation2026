// ============================================================
//  ui.js — DOM の取り回し
//  HUD・チップ・フィルムストリップ・テーマ・較正オーバーレイをここへ閉じ込め、
//  認識と描画のコードから DOM の知識を切り離す。
// ============================================================

import { SNAPSHOT } from './config.js';

const $ = (id) => document.getElementById(id);

export const video = $('webcam');
export const canvas = $('output_canvas');
export const stage = document.querySelector('.stage');

const hud = {
  fingers: $('hud-fingers'),
  row: $('hud-row'),
  vowel: $('hud-vowel'),
  gauge: $('hud-gauge'),
  gaugeBar: $('hud-gauge-bar'),
  modGauge: $('hud-mod-gauge'),
  modBar: $('hud-mod-bar'),
  modType: $('hud-mod-type'),
  eye: $('hud-eye'),
  bpm: $('hud-bpm'),
  beat: $('hud-beat'),
};

const currentCharDisp = $('current-char');
const textBufferDisp = $('text-buffer');
const statusEl = $('status');
const filmstrip = $('filmstrip');

const cal = {
  overlay: $('calibration'),
  vowel: $('cal-vowel'),
  step: $('cal-step'),
  phase: $('cal-phase'),
  bar: $('cal-bar'),
};

const pct = (v) => Math.floor(v * 100);

// ── 状態表示 ────────────────────────────────────────────────
export function setStatus(text) {
  statusEl.textContent = text;
  statusEl.hidden = false;
}

export function hideStatus() {
  if (!statusEl.hidden) statusEl.hidden = true;
}

export function setText(text) {
  textBufferDisp.textContent = text;
}

/** チップは「いまの状態」だけを出す。実際の字は canvas に大きく描く */
export function setCurrentChar(text) {
  currentCharDisp.textContent = text;
}

export function setHand(totalFingers, rowName) {
  hud.fingers.textContent = totalFingers;
  hud.row.textContent = rowName;
}

export function setFace(vowel, eyeClosed) {
  hud.vowel.textContent = vowel === 'close' ? 'ー' : vowel;
  hud.eye.textContent = eyeClosed ? '閉' : '開';
}

/**
 * 確認用ページの値で動いていることを画面に出す。
 * これが出ていないのに見え方が違う、という迷い方をしないための印。
 */
export function setTuningMark(tuned) {
  $('hud-tuned').hidden = !tuned;
}

/** 心拍の表示。点が脈に合わせてふくらむ（センサ無しの合成波） */
export function setHeart({ bpm, pulse }) {
  hud.bpm.textContent = Math.round(bpm);
  hud.beat.style.transform = `scale(${(0.7 + 0.55 * pulse).toFixed(3)})`;
  hud.beat.style.opacity = (0.3 + 0.7 * pulse).toFixed(3);
}

export function setCharGauge(progress) {
  const p = pct(progress);
  hud.gauge.textContent = p;
  hud.gaugeBar.style.width = `${p}%`;
}

export function setModifierGauge(progress, label) {
  const p = pct(progress);
  hud.modGauge.textContent = p;
  hud.modBar.style.width = `${p}%`;
  hud.modType.textContent = label;
}

// ── スナップショット記録（文字＋顔・このセッション画面内のみ） ──
const thumbCanvas = document.createElement('canvas');
const thumbCtx = thumbCanvas.getContext('2d');
const snapshots = []; // { char }（画像は DOM の <img> が保持）
const FILMSTRIP_VIEWS = ['glyph', 'face', 'both'];

/** いま表示中のフレーム（鏡像済みカメラ全体）を、比を保ったまま縮小して data URL 化 */
function captureThumb() {
  const w = SNAPSHOT.thumbWidth;
  const h = Math.max(1, Math.round((w * canvas.height) / canvas.width));
  if (thumbCanvas.width !== w || thumbCanvas.height !== h) {
    thumbCanvas.width = w;
    thumbCanvas.height = h;
  }
  thumbCtx.drawImage(canvas, 0, 0, w, h);
  return thumbCanvas.toDataURL('image/jpeg', SNAPSHOT.jpegQuality);
}

/**
 * 確定した文字を、**その瞬間の字形**と**その瞬間の顔**の2枚で記録する。
 * 字形は renderer が焼いた PNG（心拍の位相ごと残る）。顔は出力フレームの縮小。
 * どちらを見せるかは下のビュー切替で決める。
 */
export function recordSnapshot(char, glyphUrl, bpm) {
  const figure = document.createElement('figure');
  figure.className = 'frame';

  const glyph = new Image();
  glyph.className = 'thumb glyph';
  glyph.src = glyphUrl ?? '';
  glyph.alt = `${char} — そのときの字形`;

  const face = new Image();
  face.className = 'thumb face';
  face.src = captureThumb();
  face.alt = `${char} — そのときの顔`;

  const cap = document.createElement('figcaption');
  const ch = document.createElement('span');
  ch.className = 'ch';
  ch.textContent = char;
  const hb = document.createElement('span');
  hb.className = 'hb';
  hb.textContent = Number.isFinite(bpm) ? `${Math.round(bpm)}` : '';
  cap.append(ch, hb);

  figure.append(glyph, face, cap);
  filmstrip.append(figure);
  snapshots.push({ char });

  while (snapshots.length > SNAPSHOT.maxEntries) {
    snapshots.shift();
    filmstrip.firstElementChild?.remove();
  }
  filmstrip.scrollLeft = filmstrip.scrollWidth; // 最新を表示
}

/** バックスペースで末尾の記録も1件戻す（テキストと同期） */
export function popSnapshot() {
  if (!snapshots.length) return;
  snapshots.pop();
  filmstrip.lastElementChild?.remove();
}

/**
 * 濁点等で末尾文字が変わったときの更新。顔はそのまま（撮り直さない）。
 * 字形は、確定したときと同じ位相で刷り直せるなら差し替える（glyphUrl が来たとき）。
 */
export function relabelLastSnapshot(char, glyphUrl) {
  if (!snapshots.length) return;
  snapshots[snapshots.length - 1].char = char;
  const figure = filmstrip.lastElementChild;
  const capEl = figure?.querySelector('figcaption .ch');
  if (capEl) capEl.textContent = char;
  const glyphEl = figure?.querySelector('img.glyph');
  if (glyphEl && glyphUrl) {
    glyphEl.src = glyphUrl;
    glyphEl.alt = `${char} — そのときの字形`;
  }
}

/** 記録の見せ方を切り替える（字形 / 顔 / 両方）。実体は CSS 側の出し分け */
export function setFilmstripView(view) {
  const v = FILMSTRIP_VIEWS.includes(view) ? view : 'both';
  filmstrip.dataset.view = v;
  for (const btn of document.querySelectorAll('.seg-btn[data-view]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === v));
  }
  try {
    localStorage.setItem('sessan.filmstripView.v1', v);
  } catch { /* プライベートモード等。憶えられなくても動きは変わらない */ }
}

// ── 較正オーバーレイ ────────────────────────────────────────
export function showCalibration(vowel, stepText, phase, progress) {
  cal.overlay.hidden = false;
  cal.vowel.textContent = vowel ?? '';
  cal.step.textContent = stepText;
  cal.phase.textContent = phase === 'ready' ? 'この口の形をつくって…' : '取り込み中';
  cal.bar.style.width = `${pct(progress)}%`;
}

export function hideCalibration() {
  cal.overlay.hidden = true;
  cal.bar.style.width = '0%';
}

export function setCalibrationState(calibrated) {
  $('reset-cal-btn').hidden = !calibrated;
}

// ── ステージの大きさをドラッグで変える ──────────────────────
//  右下のつまみを引くと縦横が変わる。映像は canvas の object-fit: contain なので
//  比が変わっても歪まない（入りきらないぶんは地色の帯になる）。
//  カメラの比に近づいたら吸い付かせるので、帯の出ない大きさは取りやすい。
const STAGE_SIZE_KEY = 'sessan.stageSize.v1';
const STAGE_MIN = Object.freeze({ w: 220, h: 165 });
/** カメラの比とこれくらい近ければ、ぴたりと合わせる */
const SNAP_RATIO = 0.06;

const stageLimits = () => ({
  maxW: Math.max(STAGE_MIN.w, window.innerWidth - 24),
  maxH: Math.max(STAGE_MIN.h, window.innerHeight - 24),
});

/** null を渡すと inline 指定を外して CSS の既定へ戻す */
function applyStageSize(w, h) {
  const root = document.documentElement.style;
  if (w == null) {
    root.removeProperty('--stage-w');
    root.removeProperty('--stage-h');
    return;
  }
  root.setProperty('--stage-w', `${Math.round(w)}px`);
  root.setProperty('--stage-h', `${Math.round(h)}px`);
}

function camAspect() {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cam-ar'));
  return Number.isFinite(v) && v > 0 ? v : 4 / 3;
}

function bindStageResize() {
  const handle = $('stage-resize');
  if (!handle) return;

  // 前回の大きさ。画面が小さくなっていることもあるので、その場で挟み直す
  try {
    const saved = JSON.parse(localStorage.getItem(STAGE_SIZE_KEY) ?? 'null');
    if (saved?.w > 0 && saved?.h > 0) {
      const { maxW, maxH } = stageLimits();
      applyStageSize(
        Math.min(maxW, Math.max(STAGE_MIN.w, saved.w)),
        Math.min(maxH, Math.max(STAGE_MIN.h, saved.h)),
      );
    }
  } catch { /* 読めなくても既定の大きさで動く */ }

  let start = null;

  handle.addEventListener('pointerdown', (e) => {
    const r = stage.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    const { maxW, maxH } = stageLimits();
    const w = Math.min(maxW, Math.max(STAGE_MIN.w, start.w + (e.clientX - start.x)));
    let h = Math.min(maxH, Math.max(STAGE_MIN.h, start.h + (e.clientY - start.y)));
    const ar = camAspect();
    if (Math.abs(w / h - ar) / ar < SNAP_RATIO) h = w / ar; // 帯の出ない比へ吸い付く
    applyStageSize(w, h);
  });

  const finish = (e) => {
    if (!start) return;
    start = null;
    try { handle.releasePointerCapture(e.pointerId); } catch { /* 既に解放済み */ }
    const r = stage.getBoundingClientRect();
    try {
      localStorage.setItem(STAGE_SIZE_KEY, JSON.stringify({ w: r.width, h: r.height }));
    } catch { /* 憶えられなくても動きは変わらない */ }
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);

  // ダブルクリック／ダブルタップで既定の大きさへ戻す
  handle.addEventListener('dblclick', () => {
    applyStageSize(null);
    try { localStorage.removeItem(STAGE_SIZE_KEY); } catch { /* 消せなくてよい */ }
  });
}

// ── 配線 ────────────────────────────────────────────────────
export function bindControls(handlers) {
  $('toggle-hud-btn').addEventListener('click', () => $('hud').classList.toggle('hidden'));
  $('calibrate-btn').addEventListener('click', handlers.onCalibrate);
  $('reset-cal-btn').addEventListener('click', handlers.onResetCalibration);
  $('cal-cancel-btn').addEventListener('click', handlers.onCancelCalibration);

  for (const btn of document.querySelectorAll('.seg-btn[data-view]')) {
    btn.addEventListener('click', () => setFilmstripView(btn.dataset.view));
  }
  let saved = null;
  try { saved = localStorage.getItem('sessan.filmstripView.v1'); } catch { /* 読めなくてよい */ }
  setFilmstripView(saved ?? filmstrip.dataset.view);

  bindStageResize();

  // sumi は data-theme で反転する
  $('theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    handlers.onThemeChange?.();
  });
}
