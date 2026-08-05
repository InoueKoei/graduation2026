// ============================================================
//  script.js — Sessan（空中タイピング）本体
//  MediaPipe Holistic（レガシー solution）で手・顔を同時追跡する。
//  Holistic / Camera は CDN の classic script が window に載せたものを使う。
// ============================================================

import { CAMERA, HOLD_FRAMES, GOJUON, GYO_NAMES, DAKUTEN, HANDAKUTEN, VOWEL_TARGETS, EYE_TARGETS, HOLISTIC_OPTIONS, SNAPSHOT } from './config.js';
import { countFingers, analyzeFace, classifyVowel, isEyeClosed, withModifier, HoldGate } from './typing-core.js';

// ── DOM 参照 ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const videoElement = $('webcam');
const canvasElement = $('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

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
};
const currentCharDisp = $('current-char');
const textBufferDisp = $('text-buffer');
const statusEl = $('status');
const filmstrip = $('filmstrip');
const stageEl = document.querySelector('.stage');

$('toggle-hud-btn').addEventListener('click', () => $('hud').classList.toggle('hidden'));

// ライト / ダーク切替（sumi は data-theme で反転）
$('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

// ── 状態 ────────────────────────────────────────────────────
let typedText = '';
let lastSelectedChar = '';
const charGate = new HoldGate(HOLD_FRAMES.char);
const bsGate = new HoldGate(HOLD_FRAMES.backspace);
const modGate = new HoldGate(HOLD_FRAMES.modifier);

const pct = (v) => Math.floor(v * 100);
function commitBuffer() { textBufferDisp.textContent = typedText; }

// ── スナップショット記録（文字＋顔・このセッション画面内のみ） ──
const thumbCanvas = document.createElement('canvas');
const thumbCtx = thumbCanvas.getContext('2d');
const snapshots = []; // { char }（画像は DOM の <img> が保持）

/** いま表示中のフレーム（鏡像済みカメラ全体）を、比を保ったまま縮小して data URL 化 */
function captureThumb() {
  const w = SNAPSHOT.thumbWidth;
  const h = Math.max(1, Math.round((w * canvasElement.height) / canvasElement.width));
  if (thumbCanvas.width !== w || thumbCanvas.height !== h) {
    thumbCanvas.width = w;
    thumbCanvas.height = h;
  }
  thumbCtx.drawImage(canvasElement, 0, 0, w, h);
  return thumbCanvas.toDataURL('image/jpeg', SNAPSHOT.jpegQuality);
}

/** 確定した文字と、その瞬間の顔をフィルムストリップに追加 */
function recordSnapshot(char) {
  const figure = document.createElement('figure');
  figure.className = 'frame';
  const img = new Image();
  img.src = captureThumb();
  img.alt = char;
  const cap = document.createElement('figcaption');
  cap.textContent = char;
  figure.append(img, cap);
  filmstrip.append(figure);
  snapshots.push({ char });

  while (snapshots.length > SNAPSHOT.maxEntries) {
    snapshots.shift();
    filmstrip.firstElementChild?.remove();
  }
  filmstrip.scrollLeft = filmstrip.scrollWidth; // 最新を表示
}

/** バックスペースで末尾の記録も1件戻す（テキストと同期） */
function popSnapshot() {
  if (!snapshots.length) return;
  snapshots.pop();
  filmstrip.lastElementChild?.remove();
}

/** 濁点等で末尾文字が変わったら、最後の記録のラベルだけ更新（顔はそのまま） */
function relabelLastSnapshot(char) {
  if (!snapshots.length) return;
  snapshots[snapshots.length - 1].char = char;
  const cap = filmstrip.lastElementChild?.querySelector('figcaption');
  if (cap) cap.textContent = char;
}

// ── Holistic セットアップ ───────────────────────────────────
if (!window.Holistic || !window.Camera) {
  statusEl.textContent = '⚠️ MediaPipe の読み込みに失敗しました（ネットワーク接続を確認してください）';
} else {
  const holistic = new window.Holistic({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`,
  });
  holistic.setOptions(HOLISTIC_OPTIONS);
  holistic.onResults(onResults);

  const camera = new window.Camera(videoElement, {
    onFrame: async () => { await holistic.send({ image: videoElement }); },
    width: CAMERA.width,
    height: CAMERA.height,
  });
  camera.start()
    .then(() => { statusEl.hidden = true; })
    .catch((err) => { statusEl.textContent = `⚠️ カメラを起動できません: ${err.message}`; });
}

// ── フレーム処理 ────────────────────────────────────────────
function onResults(results) {
  if (!statusEl.hidden) statusEl.hidden = true; // フレームが流れ始めたら「準備中…」を確実に隠す
  drawMirroredFrame(results.image);

  const leftF = results.leftHandLandmarks ? countFingers(results.leftHandLandmarks) : -1;
  const rightF = results.rightHandLandmarks ? countFingers(results.rightHandLandmarks) : -1;
  const totalF = (leftF > 0 ? leftF : 0) + (rightF > 0 ? rightF : 0);
  const fistCount = (leftF === 0 ? 1 : 0) + (rightF === 0 ? 1 : 0);

  if (results.faceLandmarks) {
    const metrics = analyzeFace(results.faceLandmarks);
    const vowel = classifyVowel(metrics, VOWEL_TARGETS);
    const closed = isEyeClosed(metrics, EYE_TARGETS);

    hud.vowel.textContent = vowel === 'close' ? 'ー' : vowel;
    hud.eye.textContent = closed ? '閉' : '開';
    const vowelIdx = vowel === 'close' ? -1 : { あ: 0, い: 1, う: 2, え: 3, お: 4 }[vowel];

    handleBackspace(closed);
    handleModifier(closed, totalF, fistCount);
    handleCharInput(closed, totalF, vowelIdx);
  }

  hud.fingers.textContent = totalF;
  hud.row.textContent = totalF > 0 ? `${GYO_NAMES[totalF - 1]}行` : '待機';
}

/**
 * 実映像の解像度にキャンバスと表示比を追従させる。
 * 高さの上限は CSS 側（--stage-max-h）で決め、幅はこの比から逆算される。
 * ＝切り抜きも余白もなしに、iPad 縦置きでも縦に伸びすぎない。
 */
let srcW = 0;
let srcH = 0;
function syncFrameSize(w, h) {
  if (!w || !h || (w === srcW && h === srcH)) return;
  srcW = w;
  srcH = h;
  canvasElement.width = w;
  canvasElement.height = h;
  stageEl.style.aspectRatio = `${w} / ${h}`;
  // CSS が「高さ上限 × 比」で幅を決められるよう、数値の比も渡す
  document.documentElement.style.setProperty('--cam-ar', (w / h).toFixed(4));
}

/** カメラ映像を左右反転して背景に描く（等倍・切り抜きなし・歪みなし） */
function drawMirroredFrame(image) {
  syncFrameSize(image.width || videoElement.videoWidth, image.height || videoElement.videoHeight);
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.translate(canvasElement.width, 0);
  canvasCtx.scale(-1, 1);
  canvasCtx.drawImage(image, 0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.restore();
}

// ── 各操作の状態機械 ────────────────────────────────────────
/** 目を閉じ続けたら1字削除（バックスペース） */
function handleBackspace(closed) {
  if (closed) {
    if (bsGate.tick()) {
      typedText = typedText.slice(0, -1);
      commitBuffer();
      popSnapshot(); // 記録も1件戻す
    }
  } else {
    bsGate.reset();
  }
}

/** グーを保持したら末尾に濁点／半濁点。手を完全に緩めるまで再適用しない */
function handleModifier(closed, totalF, fistCount) {
  const active = !closed && totalF === 0 && fistCount > 0;
  if (active) {
    if (modGate.tick()) {
      typedText = withModifier(typedText, fistCount === 1 ? 'd' : 'h', DAKUTEN, HANDAKUTEN);
      commitBuffer();
      if (typedText) relabelLastSnapshot(typedText.slice(-1)); // 末尾字の記録ラベルを更新
    }
    const p = pct(modGate.progress());
    hud.modGauge.textContent = p;
    hud.modBar.style.width = `${p}%`;
    hud.modType.textContent = fistCount === 1 ? '[濁点]' : '[半濁点]';
  } else {
    modGate.resetCounter();
    hud.modGauge.textContent = 0;
    hud.modBar.style.width = '0%';
    hud.modType.textContent = '';
    // 指も拳も無い（手を下ろした）状態に戻ったらロック解除
    if (totalF === 0 && fistCount === 0) modGate.unlock();
  }
}

/** 同じ字を保持し続けたら確定入力 */
function handleCharInput(closed, totalF, vowelIdx) {
  const valid = !closed && totalF > 0 && vowelIdx !== -1;
  if (valid) {
    const char = GOJUON[totalF - 1][vowelIdx];
    currentCharDisp.textContent = char;
    if (char === lastSelectedChar) {
      if (charGate.tick()) {
        typedText += char;
        commitBuffer();
        recordSnapshot(char); // 確定＝この瞬間の顔を記録
      }
      const p = pct(charGate.progress());
      hud.gauge.textContent = p;
      hud.gaugeBar.style.width = `${p}%`;
    } else {
      lastSelectedChar = char;
      charGate.reset();
    }
  } else {
    currentCharDisp.textContent = closed ? '消' : 'ー';
    charGate.reset();
    hud.gauge.textContent = 0;
    hud.gaugeBar.style.width = '0%';
    if (!closed) lastSelectedChar = '';
  }
}
