// ============================================================
//  script.js — KanaDance 本体
//  カメラで身体を捉え、ポーズを「かな字形」として登録／判別する。
//   登録モード: いまのポーズを字と紐づけて Supabase に保存
//   判別モード: 最も近い字を推定し、一筆書き（または巨大文字）を重ねて描く
// ============================================================

import { PoseLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs';
import { APP_CONFIG } from './config.js';
import { loadReferencePoses, savePose } from './pose-store.js';
import { normalizePose, toPixelPoints, matchLetter, resolvePoint } from './pose-matcher.js';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// ── DOM 参照 ────────────────────────────────────────────────
const video       = document.getElementById('webcam');
const canvas      = document.getElementById('output_canvas');
const ctx         = canvas.getContext('2d');
const resultDiv   = document.getElementById('result');
const registerUi  = document.getElementById('register-ui');
const container   = document.getElementById('canvas-container');
const kanaInput   = document.getElementById('kana-input');
const registerBtn = document.getElementById('register-btn');

// キャンバス・コンテナのサイズを設定に合わせる
const { width: W, height: H } = APP_CONFIG.video;
video.width = W; video.height = H;
canvas.width = W; canvas.height = H;
container.style.width = `${W}px`;
container.style.maxWidth = '100%';
container.style.aspectRatio = `${W} / ${H}`;

// ── 状態 ────────────────────────────────────────────────────
let poseLandmarker = null;
let references = { poses: {}, lines: {} };
let latestNormalized = null;   // 直近フレームの正規化ポーズ（登録に使う）
let lastVideoTime = -1;
let matchThreshold = APP_CONFIG.matchThreshold; // スライダーで調整可能

const currentMode = () => document.querySelector('input[name="app-mode"]:checked').value;

// ── しきい値スライダー ──────────────────────────────────────
const thresholdInput = document.getElementById('threshold-input');
const thresholdValue = document.getElementById('threshold-value');
if (thresholdInput && thresholdValue) {
  thresholdInput.value = String(matchThreshold);
  thresholdValue.textContent = matchThreshold.toFixed(2);
  thresholdInput.addEventListener('input', () => {
    matchThreshold = parseFloat(thresholdInput.value);
    thresholdValue.textContent = matchThreshold.toFixed(2);
  });
}

function setStatus(msg) {
  resultDiv.textContent = msg;
  resultDiv.classList.remove('error');
}
function setError(msg) {
  resultDiv.textContent = `⚠️ ${msg}`;
  resultDiv.classList.add('error');
  console.error(msg);
}

// ── モード切り替え ──────────────────────────────────────────
document.querySelectorAll('input[name="app-mode"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    const register = e.target.value === 'register';
    registerUi.hidden = !register;
    setStatus(register ? '登録モード：ポーズをとって DB に登録してください' : '判別モード：ポーズを探しています…');
  });
});

// ── 初期化 ──────────────────────────────────────────────────
// カメラ起動を最優先にし、DB／モデルの読み込み失敗に巻き込まれないようにする。
(async function init() {
  // 1) カメラ（映像が最優先。ここが他の読み込みに引きずられて止まらないこと）
  await startCamera();

  // 2) 参照ポーズ（失敗しても致命ではない：登録は可能・判別のみ不可）
  try {
    references = await loadReferencePoses();
  } catch (err) {
    console.error(err);
    setError(`参照ポーズを読み込めません（判別不可・登録は可能）: ${err.message}`);
  }

  // 3) 姿勢推定モデル（判別・描画に必要。無くてもカメラ映像は出る）
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
    });
  } catch (err) {
    setError(`姿勢推定モデルを読み込めません: ${err.message}`);
  }
})();

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: W, height: H },
      audio: false,
    });
    video.srcObject = stream;
    video.addEventListener('loadeddata', () => {
      setStatus('カメラを許可しました。ポーズをとってください…');
      requestAnimationFrame(renderLoop);
    }, { once: true });
  } catch (err) {
    setError(`カメラを起動できません: ${err.message}`);
  }
}

// ── 描画ループ ──────────────────────────────────────────────
function renderLoop() {
  requestAnimationFrame(renderLoop);
  if (!poseLandmarker || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const results = poseLandmarker.detectForVideo(video, performance.now());
  if (!results.landmarks?.length) return;

  const landmarks = results.landmarks[0];
  latestNormalized = normalizePose(landmarks);
  const pixelPoints = toPixelPoints(landmarks, canvas.width, canvas.height);

  drawJoints(pixelPoints);

  if (currentMode() !== 'detect') return;

  const refCount = Object.keys(references.poses).length;
  if (refCount === 0) {
    setStatus('参照ポーズが読み込めていません（DB未接続）');
    return;
  }

  // 最も近い字とその誤差を毎フレーム求める（しきい値判定はここで）
  const { letter, error } = matchLetter(latestNormalized, references.poses);
  if (letter && error < matchThreshold) {
    setStatus(`判定結果:「${letter}」 誤差 ${error.toFixed(2)} / しきい値 ${matchThreshold.toFixed(2)}`);
    const lines = references.lines[letter];
    if (lines?.length) {
      drawKanaLines(lines, pixelPoints);
    } else {
      drawBigChar(letter); // 線データが無い字（ノ/フ/リ等）は巨大文字表示
    }
  } else {
    // 一致しないときも「最も近い候補と誤差」を出す＝どれだけ惜しいか可視化しスライダーで調整できる
    setStatus(`最も近い:「${letter ?? '—'}」誤差 ${error.toFixed(2)}（一致=しきい値 ${matchThreshold.toFixed(2)} 未満）／登録 ${refCount} 件`);
  }
}

// ── 描画パーツ ──────────────────────────────────────────────
function drawJoints(pixelPoints) {
  ctx.fillStyle = APP_CONFIG.dotColor;
  for (const p of Object.values(pixelPoints)) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, APP_CONFIG.jointRadius, 0, 2 * Math.PI);
    ctx.fill();
  }
}

/** 一筆書き記述に沿って身体上に線を引く */
function drawKanaLines(lines, pixelPoints) {
  ctx.strokeStyle = APP_CONFIG.line.color;
  ctx.lineWidth = APP_CONFIG.line.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const lineStr of lines) {
    const tokens = lineStr.split('-');
    const start = resolvePoint(tokens[0], pixelPoints);
    if (!start) continue;

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < tokens.length; i++) {
      const pt = resolvePoint(tokens[i], pixelPoints);
      if (pt) ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  }
}

/** 線データが無い字は、鏡像を打ち消して中央に大きく表示する */
function drawBigChar(letter) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.font = `bold ${APP_CONFIG.fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(-1, 1); // canvas は CSS で左右反転しているので文字だけ元に戻す
  ctx.fillText(letter, 0, 0);
  ctx.restore();
}

// ── 登録 ────────────────────────────────────────────────────
registerBtn.addEventListener('click', async () => {
  const letter = kanaInput.value.trim();
  if (!letter) { setError('文字を入力してください'); return; }
  if (!latestNormalized) { setError('身体が検出されていません'); return; }

  registerBtn.disabled = true;
  setStatus('Supabase に送信中…');
  try {
    await savePose(letter, latestNormalized);
    references = await loadReferencePoses(); // 追加分を即反映
    kanaInput.value = '';
    setStatus(`✅ 「${letter}」を登録しました`);
  } catch (err) {
    setError(`登録に失敗しました: ${err.message}`);
  } finally {
    registerBtn.disabled = false;
  }
});

window.addEventListener('beforeunload', () => {
  video.srcObject?.getTracks().forEach((t) => t.stop());
});
