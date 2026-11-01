// ============================================================
//  ui.js — DOM の取り回し（展示版）
//  状態表示・モード・調整スライダー・シャッターをここに閉じ込め、
//  推定と描画のコードから DOM の知識を切り離す。
//  画面は Figma のフレーム pose（幅 1920）で組み、窓の幅いっぱいに縮める。
// ============================================================

import { APP_CONFIG, POSE_SETS, DEFAULT_POSE_SET } from './config.js';

export const video = document.getElementById('webcam');
export const canvas = document.getElementById('output_canvas');
export const records = document.getElementById('records');

const statusEl = document.getElementById('status');
const registerUi = document.getElementById('register-ui');
const kanaInput = document.getElementById('kana-input');
const registerBtn = document.getElementById('register-btn');
/** 選んでいる組に登録できるか（締め切り済みの組では false） */
let registerAvailable = true;
const currentChar = document.getElementById('current-char');
const shapeCount = document.getElementById('shape-count');
const panel = document.getElementById('panel');
const panelToggle = document.getElementById('panel-toggle');
const shutterBtn = document.getElementById('shutter-btn');
const flash = document.getElementById('flash');

/** UI から調整できる値。描画ループはここを毎フレーム読む */
// 組の構成を変えたらキーも改める（前の選択が残って新しい既定に切り替わらない、を防ぐ）
const POSE_SET_KEY = 'kanadance.poseSet.v2';
function initialPoseSet() {
  try {
    const saved = localStorage.getItem(POSE_SET_KEY);
    if (saved && POSE_SETS[saved]) return saved;
  } catch { /* 読めなければ既定 */ }
  return DEFAULT_POSE_SET;
}

export const settings = {
  matchThreshold: APP_CONFIG.matchThreshold,
  videoOpacity: APP_CONFIG.videoOpacity,
  poseOpacity: APP_CONFIG.poseOpacity,
  recordPhotoOpacity: APP_CONFIG.recordPhotoOpacity,
  /** 判定に使うポーズの組（config.js の POSE_SETS のキー） */
  poseSet: initialPoseSet(),
  ...APP_CONFIG.blend,
};

/**
 * スライダー定義。value は表示単位、settings へは ×scale して入れる。
 * （例：さかのぼる時間は「秒」で操作し、settings.windowMs には ms で入る）
 */
const CONTROLS = [
  // apply があるスライダーは、値を settings に入れるだけでなく画面にも即反映する
  {
    id: 'pose-opacity', key: 'poseOpacity', scale: 1,
    format: (v) => (v === 0 ? '消す' : `${Math.round(v * 100)}%`),
    apply: (v) => { canvas.style.opacity = String(v); },
  },
  {
    id: 'record-photo-opacity', key: 'recordPhotoOpacity', scale: 1,
    format: (v) => (v === 0 ? '消す' : `${Math.round(v * 100)}%`),
    apply: (v) => { document.documentElement.style.setProperty('--record-photo-opacity', String(v)); },
  },
  {
    id: 'video-opacity', key: 'videoOpacity', scale: 1,
    format: (v) => (v === 0 ? '消す' : `${Math.round(v * 100)}%`),
    apply: (v) => { video.style.opacity = String(v); },
  },
  { id: 'match-threshold', key: 'matchThreshold', scale: 1,    format: (v) => v.toFixed(2) },
  { id: 'blend-window',    key: 'windowMs',       scale: 1000, format: (v) => `${v.toFixed(1)} 秒` },
  { id: 'blend-interval',  key: 'intervalMs',     scale: 1000, format: (v) => `${Math.round(v * 1000)} ms` },
  { id: 'blend-steps',     key: 'steps',          scale: 1,    format: (v) => `${v} 段` },
  { id: 'blend-width',     key: 'width',          scale: 1,    format: (v) => `${v} px` },
  { id: 'blend-tail',      key: 'tailOpacity',    scale: 1,    format: (v) => v.toFixed(2) },
];

export const currentMode = () =>
  document.querySelector('input[name="app-mode"]:checked').value;

export function setStatus(msg) {
  statusEl.textContent = msg;
  statusEl.classList.remove('error');
}

export function setError(msg) {
  statusEl.textContent = `⚠️ ${msg}`;
  statusEl.classList.add('error');
  console.error(msg);
}

/** 判定中の字を「今のもじ」に出す（null で空にする。枠は残す） */
export function setCurrentChar(letter) {
  currentChar.classList.toggle('is-empty', !letter);
  currentChar.textContent = letter ?? '';
}

/** シャッターの手応え。撮れたら白く光らせ、字が無くて撮れなかったら小さく揺らす */
export function showShutter(ok) {
  const [el, cls] = ok ? [flash, 'is-on'] : [shutterBtn, 'is-miss'];
  el.classList.remove(cls);
  void el.offsetWidth; // 続けて押してもアニメーションを頭から流し直す
  el.classList.add(cls);
}

// ── 体型合わせ ──────────────────────────────────────────────
const cal = {
  overlay: document.getElementById('calibration'),
  letter: document.getElementById('cal-letter'),
  phase: document.getElementById('cal-phase'),
  bar: document.getElementById('cal-bar'),
};

/** 体型合わせの案内を出す */
export function showCalibration(letter, phase, reason, progress) {
  cal.overlay.hidden = false;
  cal.letter.textContent = letter;
  cal.phase.textContent = reason
    || (phase === 'ready' ? '正面を向いて、このポーズをとってください' : 'そのまま止まって…');
  // 動いて溜め直しになったら、メーターも 0 に戻して見せる
  cal.bar.style.width = `${Math.round(progress * 100)}%`;
}

export function hideCalibration() {
  cal.overlay.hidden = true;
  cal.bar.style.width = '0%';
}

/** 体型合わせが効いているか（↺ で解除できるようにする） */
export function setCalibrated(on) {
  document.getElementById('reset-cal-btn').hidden = !on;
}

/** 登録ボタンを使えるかどうか。締め切り済みの組では押せなくする */
export function setRegisterAvailable(ok, reason = '') {
  registerAvailable = ok;
  registerBtn.disabled = !ok;
  registerBtn.title = reason;
}

/**
 * ポーズの組の状況を出す。新ポーズはまだ撮っていない字があるので、
 * どこまで判定に使えるかと、残りがどれかを見えるようにする。
 */
export function setPoseSetInfo({ label, ready, pending }) {
  const el = document.getElementById('pose-set-info');
  if (!el) return;
  const total = ready.length + pending.length;
  el.textContent = pending.length
    ? `${label}：${ready.length} / ${total} 字を判定に使用。未登録 ${pending.length} 字（${pending.join('')}）`
    : `${label}：${ready.length} 字を判定に使用`;
}

/** 1 フレームに描いた形の枚数（調整の負荷めやす） */
export function setShapeCount(n) {
  shapeCount.textContent = n ? `いま ${n} 枚を重ねている。` : '';
}

/**
 * 実際に来た映像の解像度へ、キャンバスと表示比を合わせる。
 * カメラは希望どおりのサイズをくれるとは限らない（内蔵・外付け・iPad で違う）ので、
 * config の値を信じずに毎フレーム実寸を見る。
 *
 * 展示版は映像の枠が Figma どおり 1920×840 に決まっているので、比の違いは
 * object-fit（調整の「映像の収め方」）で吸収する。映像と canvas は同じ内在比なので線はずれない。
 *
 * @returns {boolean} サイズが変わったフレームだけ true
 */
export function syncFrameSize(w, h) {
  if (!w || !h || (canvas.width === w && canvas.height === h)) return false;
  canvas.width = w;
  canvas.height = h;
  document.documentElement.style.setProperty('--cam-ar', (w / h).toFixed(4));
  return true;
}

// ── 舞台の縮尺と映像の収め方 ────────────────────────────────
const FIT_KEY = 'kanadance.fitMode';
const SETTINGS_KEY = 'kanadance.exhibition.settings.v1';
const PANEL_KEY = 'kanadance.exhibition.panelOpen';

/**
 * 幅 1920 の舞台を窓の幅いっぱいに縮める。高さは CSS が窓に合わせ、余り・不足は映像の高さで吸収する
 * （16:9 の窓なら Figma のフレームそのまま）
 */
function fitScreen() {
  const s = window.innerWidth / 1920;
  document.documentElement.style.setProperty('--scale', s.toFixed(4));
}

/** 枠の形がカメラの比と違うときの収め方（cover: 切る / contain: 余白） */
function applyFit(mode) {
  document.documentElement.style.setProperty('--fit', mode);
  const select = document.getElementById('fit-mode');
  if (select) select.value = mode;
}

/** カメラが来るまでの仮のサイズ（config の希望値）。映像が来たら上書きされる */
export function setupLayout() {
  const { width, height } = APP_CONFIG.video;
  syncFrameSize(width, height);
  fitScreen();
  window.addEventListener('resize', fitScreen);

  try {
    const fit = localStorage.getItem(FIT_KEY);
    if (fit) applyFit(fit);
  } catch { /* 読めなければ既定のまま */ }
  const fitSelect = document.getElementById('fit-mode');
  fitSelect?.addEventListener('change', () => {
    applyFit(fitSelect.value);
    try { localStorage.setItem(FIT_KEY, fitSelect.value); } catch { /* 任意 */ }
  });
}

/** スライダーの値は展示のたびに詰め直すので残す。壊れた値でも起動は止めない */
function loadSliderValues() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    for (const { key } of CONTROLS) {
      if (Number.isFinite(saved[key])) settings[key] = saved[key];
    }
  } catch { /* 既定のまま */ }
}

function saveSliderValues() {
  const values = Object.fromEntries(CONTROLS.map(({ key }) => [key, settings[key]]));
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(values)); } catch { /* 任意 */ }
}

function setPanelOpen(open) {
  panel.hidden = !open;
  panelToggle.setAttribute('aria-expanded', String(open));
}

/**
 * UI のイベントを配線する。
 * @param {(letter:string) => Promise<void>} onRegister  登録ボタンの処理
 * @param {() => void} onShutter                         シャッター（ボタン・Space・Enter）
 */
export function bindControls({
  onRegister, onPoseSetChange, onShutter, onClearRecords,
  onCalibrate, onCancelCalibration, onResetCalibration,
}) {
  shutterBtn.addEventListener('click', () => onShutter?.());
  document.getElementById('clear-records-btn').addEventListener('click', () => onClearRecords?.());
  // 係の人がキーボードやフットスイッチ（キー入力として届くもの）でも切れるように
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.target.closest?.('input, select, textarea, button')) return;
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    shutterBtn.classList.add('is-pressed');
    setTimeout(() => shutterBtn.classList.remove('is-pressed'), 120);
    onShutter?.();
  });

  document.getElementById('calibrate-btn').addEventListener('click', () => onCalibrate?.());
  document.getElementById('cal-cancel-btn').addEventListener('click', () => onCancelCalibration?.());
  document.getElementById('reset-cal-btn').addEventListener('click', () => onResetCalibration?.());

  // ポーズの組の切り替え（旧／新）。選んだ組は覚えておく
  const poseSetSelect = document.getElementById('pose-set');
  if (poseSetSelect) {
    poseSetSelect.replaceChildren(...Object.entries(POSE_SETS).map(([key, set]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = set.label;
      return opt;
    }));
    poseSetSelect.value = settings.poseSet;
    // 組が1つしか無いときは切り替えを出さない（登録状況の行だけ残す）
    poseSetSelect.closest('.ctrl').hidden = Object.keys(POSE_SETS).length < 2;
    poseSetSelect.addEventListener('change', () => {
      settings.poseSet = poseSetSelect.value;
      try { localStorage.setItem(POSE_SET_KEY, settings.poseSet); } catch { /* 任意 */ }
      onPoseSetChange?.();
    });
  }

  loadSliderValues();
  for (const { id, key, scale, format, apply } of CONTROLS) {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-value`);
    const show = (v) => { output.textContent = format(v); };

    input.value = String(settings[key] / scale);
    show(parseFloat(input.value));
    apply?.(parseFloat(input.value)); // 既定値も起動時に反映させる
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      settings[key] = v * scale;
      show(v);
      apply?.(v);
      saveSliderValues();
    });
  }

  document.querySelectorAll('input[name="app-mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const register = e.target.value === 'register';
      registerUi.hidden = !register;
      if (register) setCurrentChar(null);
      setStatus(register
        ? '登録モード：ポーズをとって DB に登録してください'
        : '判別モード：ポーズを探しています…');
    });
  });

  registerBtn.addEventListener('click', async () => {
    const letter = kanaInput.value.trim();
    if (!letter) { setError('文字を入力してください'); return; }

    registerBtn.disabled = true;
    try {
      await onRegister(letter);
    } finally {
      registerBtn.disabled = !registerAvailable; // 送信が終わっても、締め切り済みなら押せないまま
    }
  });

  // 初めは「調整」の札だけ。開けば次からも開いたまま出る
  let open = false;
  try { open = localStorage.getItem(PANEL_KEY) === '1'; } catch { /* 閉じたまま */ }
  setPanelOpen(open);
  panelToggle.addEventListener('click', () => {
    const next = panel.hidden;
    setPanelOpen(next);
    try { localStorage.setItem(PANEL_KEY, next ? '1' : '0'); } catch { /* 任意 */ }
  });
}

export function clearKanaInput() {
  kanaInput.value = '';
}
