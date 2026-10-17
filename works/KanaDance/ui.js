// ============================================================
//  ui.js — DOM の取り回し（sumi UI）
//  状態表示・モード・調整スライダー・テーマ切替をここに閉じ込め、
//  推定と描画のコードから DOM の知識を切り離す。
// ============================================================

import { APP_CONFIG } from './config.js';

export const video = document.getElementById('webcam');
export const canvas = document.getElementById('output_canvas');

const statusEl = document.getElementById('status');
const registerUi = document.getElementById('register-ui');
const stage = document.querySelector('.stage');
const kanaInput = document.getElementById('kana-input');
const registerBtn = document.getElementById('register-btn');
const currentChar = document.getElementById('current-char');
const shapeCount = document.getElementById('shape-count');
const panel = document.getElementById('panel');

/** UI から調整できる値。描画ループはここを毎フレーム読む */
export const settings = {
  matchThreshold: APP_CONFIG.matchThreshold,
  videoOpacity: APP_CONFIG.videoOpacity,
  ...APP_CONFIG.blend,
};

/**
 * スライダー定義。value は表示単位、settings へは ×scale して入れる。
 * （例：さかのぼる時間は「秒」で操作し、settings.windowMs には ms で入る）
 */
const CONTROLS = [
  // apply があるスライダーは、値を settings に入れるだけでなく画面にも即反映する
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

/** 判定中の字を大きく出す（null で消す） */
export function setCurrentChar(letter) {
  currentChar.hidden = !letter;
  currentChar.textContent = letter ?? '';
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
 * 高さの上限は CSS の --stage-max-h、幅はそこから --cam-ar で逆算されるので、
 * どんな比が来ても切り抜きも余白も歪みも出ない。
 *
 * @returns {boolean} サイズが変わったフレームだけ true
 */
export function syncFrameSize(w, h) {
  if (!w || !h || (canvas.width === w && canvas.height === h)) return false;
  canvas.width = w;
  canvas.height = h;
  stage.style.aspectRatio = `${w} / ${h}`;
  document.documentElement.style.setProperty('--cam-ar', (w / h).toFixed(4));
  return true;
}

// ── 表示の大きさと縦横比（端のつまみでドラッグ）──────────────
// 右＝幅、下＝高さ、右下の角＝両方。幅と高さを別々に持てるので、
// 縦長のカメラに合わせて縦の箱にもできる。
//
// canvas の内部解像度は映像のままなので、線の太さの見え方は変わらない。
// 映像と canvas は同じ内在比で同じ object-fit が掛かるため、
// 箱の形をカメラの比から外しても線が身体からずれることはない。
const STAGE_KEY = 'kanadance.stageBox';
const FIT_KEY = 'kanadance.fitMode';
const MIN_STAGE = 200;

/** 画面からはみ出さない上限 */
const maxStageW = () => window.innerWidth - 32;
const maxStageH = () => window.innerHeight * 0.88;

const clamp = (v, lo, hi) => Math.round(Math.max(lo, Math.min(v, hi)));

/**
 * 箱の大きさを当てる。width / height は省略可（省略した軸は触らない）。
 * height を立てると aspect-ratio より優先され、比がカメラから外れる。
 */
function applyStageBox({ width, height }) {
  const root = document.documentElement.style;
  if (width != null) root.setProperty('--stage-w', `${clamp(width, MIN_STAGE, maxStageW())}px`);
  if (height != null) root.setProperty('--stage-h', `${clamp(height, MIN_STAGE, maxStageH())}px`);
}

/** カメラの比の既定サイズに戻す */
function resetStageBox() {
  document.documentElement.style.removeProperty('--stage-w');
  document.documentElement.style.removeProperty('--stage-h');
  try { localStorage.removeItem(STAGE_KEY); } catch { /* 消せなくてもよい */ }
}

function saveStageBox() {
  const r = stage.getBoundingClientRect();
  const explicitH = document.documentElement.style.getPropertyValue('--stage-h');
  try {
    localStorage.setItem(STAGE_KEY, JSON.stringify({
      width: Math.round(r.width),
      // 高さを一度も触っていなければ保存しない（カメラの比に追従させたままにする）
      height: explicitH ? Math.round(r.height) : null,
    }));
  } catch { /* 保存できなくてもその場では効いている */ }
}

/** 前回の大きさを復元する。展示で毎回合わせ直さずに済むように */
function restoreStageBox() {
  try {
    const saved = JSON.parse(localStorage.getItem(STAGE_KEY) || 'null');
    if (saved) applyStageBox(saved);
  } catch { /* 読めなければ既定のまま */ }

  try {
    const fit = localStorage.getItem(FIT_KEY);
    if (fit) applyFit(fit);
  } catch { /* 同上 */ }
}

/** 箱の形がカメラの比と違うときの収め方（cover: 切る / contain: 余白） */
function applyFit(mode) {
  document.documentElement.style.setProperty('--fit', mode);
  const select = document.getElementById('fit-mode');
  if (select) select.value = mode;
}

function bindStageResizers() {
  for (const handle of document.querySelectorAll('.stage-resizer')) {
    const axis = handle.dataset.axis;      // 'x' | 'y' | 'xy'
    let startX = 0, startY = 0, startW = 0, startH = 0;

    const onMove = (e) => {
      // ステージは中央寄せなので、右端は動かした量の半分しか動かない。
      // つまみが指についてくるよう、横の差分だけ倍にして渡す。
      // 下端は上が固定なので、縦はそのままでよい。
      applyStageBox({
        width: axis.includes('x') ? startW + (e.clientX - startX) * 2 : null,
        height: axis.includes('y') ? startH + (e.clientY - startY) : null,
      });
    };

    const onUp = (e) => {
      handle.releasePointerCapture?.(e.pointerId);
      handle.classList.remove('dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      saveStageBox();
    };

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startW = r.width; startH = r.height;
      // 高さを触る操作に入った時点で、比の追従をやめて実寸に固定する
      if (axis.includes('y')) applyStageBox({ height: startH });
      handle.setPointerCapture?.(e.pointerId);
      handle.classList.add('dragging');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    handle.addEventListener('dblclick', resetStageBox);

    // キーボードでも変えられるように（Tab で入って矢印キー）
    handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 80 : 20;
      const r = stage.getBoundingClientRect();
      const moves = {
        ArrowRight: { width: r.width + step },
        ArrowLeft: { width: r.width - step },
        ArrowDown: { height: r.height + step },
        ArrowUp: { height: r.height - step },
      };
      if (e.key === 'Escape') { resetStageBox(); return; }
      const move = moves[e.key];
      if (!move) return;
      // 幅のつまみで縦を、縦のつまみで幅を変えないよう、軸に合う操作だけ通す
      if ((move.width != null && !axis.includes('x')) ||
          (move.height != null && !axis.includes('y'))) return;
      e.preventDefault();
      applyStageBox(move);
      saveStageBox();
    });
  }

  const fitSelect = document.getElementById('fit-mode');
  fitSelect?.addEventListener('change', () => {
    applyFit(fitSelect.value);
    try { localStorage.setItem(FIT_KEY, fitSelect.value); } catch { /* 任意 */ }
  });

  // 窓の大きさが変わったら上限を超えていないか見直す
  window.addEventListener('resize', () => {
    const root = document.documentElement.style;
    const w = root.getPropertyValue('--stage-w');
    const h = root.getPropertyValue('--stage-h');
    applyStageBox({ width: w ? parseFloat(w) : null, height: h ? parseFloat(h) : null });
  });
}

/** カメラが来るまでの仮のサイズ（config の希望値）。映像が来たら上書きされる */
export function setupLayout() {
  const { width, height } = APP_CONFIG.video;
  syncFrameSize(width, height);
  bindStageResizers();
  restoreStageBox();
}

/**
 * UI のイベントを配線する。
 * @param {(letter:string) => Promise<void>} onRegister  登録ボタンの処理
 * @param {() => void} onThemeChange                     テーマ切替（canvas の墨色を取り直す）
 */
export function bindControls({ onRegister, onThemeChange }) {
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
      registerBtn.disabled = false;
    }
  });

  document.getElementById('panel-toggle').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });

  // sumi は data-theme で反転する
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    onThemeChange?.();
  });
}

export function clearKanaInput() {
  kanaInput.value = '';
}
