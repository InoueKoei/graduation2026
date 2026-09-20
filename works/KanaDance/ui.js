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
  ...APP_CONFIG.blend,
};

/**
 * スライダー定義。value は表示単位、settings へは ×scale して入れる。
 * （例：さかのぼる時間は「秒」で操作し、settings.windowMs には ms で入る）
 */
const CONTROLS = [
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

/** カメラが来るまでの仮のサイズ（config の希望値）。映像が来たら上書きされる */
export function setupLayout() {
  const { width, height } = APP_CONFIG.video;
  syncFrameSize(width, height);
}

/**
 * UI のイベントを配線する。
 * @param {(letter:string) => Promise<void>} onRegister  登録ボタンの処理
 * @param {() => void} onThemeChange                     テーマ切替（canvas の墨色を取り直す）
 */
export function bindControls({ onRegister, onThemeChange }) {
  for (const { id, key, scale, format } of CONTROLS) {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-value`);
    const show = (v) => { output.textContent = format(v); };

    input.value = String(settings[key] / scale);
    show(parseFloat(input.value));
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      settings[key] = v * scale;
      show(v);
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
