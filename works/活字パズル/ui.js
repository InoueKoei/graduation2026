// ============================================================
//  ui.js — DOM の取り回し
//  ツールバー・ステータス・ログ・テーマ切替をここへ閉じ込め、
//  検出と描画のコードから DOM の知識を切り離す。
// ============================================================

const $ = (id) => document.getElementById(id);

export const video = $('video');
export const canvas = $('output');

export const buttons = {
  setupCam: $('setupCamBtn'),
  startGame: $('startGameBtn'),
  toggleVid: $('toggleVidBtn'),
  check: $('checkBtn'),
  restart: $('restartBtn'),
};

const cvStatus = $('cvStatus');
const errorBanner = $('errorBanner');
const viewContainer = $('viewContainer');
const targetDisplay = $('targetDisplay');
const targetWordText = $('targetWordText');
const resultStatus = $('resultStatus');
const resultChip = $('resultChip');
const timerDisplay = $('timerDisplay');
const logEl = $('log');

const stats = {
  count: $('countVal'),
  fps: $('fpsVal'),
  res: $('resVal'),
  disorder: $('disorderVal'),
  word: $('idsList'),
};

// ── ログ・状態表示 ──────────────────────────────────────────
export function addLog(msg) {
  const line = document.createElement('div');
  line.textContent = msg;
  logEl.prepend(line);
  while (logEl.children.length > 60) logEl.removeChild(logEl.lastChild);
}

export function showError(msg) {
  errorBanner.textContent = `⚠️ ${msg}`;
  errorBanner.hidden = false;
  addLog(`ERROR: ${msg}`);
}

export function setLoaderState(text, cls) {
  cvStatus.textContent = text;
  cvStatus.classList.remove('ready', 'error');
  if (cls) cvStatus.classList.add(cls);
}

/** 正誤表示（モノクロのチップ。cls: 'ok' | 'ng' | ''） */
export function setResult(cls, text) {
  resultStatus.className = cls;
  resultChip.textContent = text;
}

export function setTargetWord(text) {
  targetWordText.textContent = text;
}

export function setTimer(text) {
  timerDisplay.textContent = text;
}

export const timerText = () => timerDisplay.textContent;

/** true でターゲット表示、false でカメラ表示に切り替える */
export function showTargetPanel(showTarget) {
  targetDisplay.hidden = !showTarget;
  viewContainer.hidden = showTarget;
}

export const isCameraVisible = () => !viewContainer.hidden;

/**
 * 検出のようすを出す。
 * disorder は「組版の乱れ」＝各ブロックのにじみ量の平均。
 * 揃えて置くほど 0 に近づく。
 */
export function setStats({ word, count, resolution, disorder }) {
  stats.word.textContent = word || '— none —';
  stats.count.textContent = String(count);
  stats.res.textContent = resolution;
  stats.disorder.textContent = disorder === null ? '—' : disorder.toFixed(2);
}

export function setFps(value) {
  stats.fps.textContent = String(value);
}

// ── 配線 ────────────────────────────────────────────────────
/**
 * @param {Object} handlers クリック時の処理
 * @param {() => void} handlers.onThemeChange canvas の墨色を取り直す
 */
export function bindControls(handlers) {
  buttons.setupCam.addEventListener('click', handlers.onSetupCamera);
  buttons.startGame.addEventListener('click', handlers.onStartGame);
  buttons.restart.addEventListener('click', handlers.onRestart);
  buttons.toggleVid.addEventListener('click', handlers.onToggleView);
  buttons.check.addEventListener('click', handlers.onCheck);

  // sumi は data-theme で反転する
  $('theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    handlers.onThemeChange?.();
  });
}
