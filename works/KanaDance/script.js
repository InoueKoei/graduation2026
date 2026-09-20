// ============================================================
//  script.js — KanaDance 本体（初期化と描画ループ）
//  カメラで身体を捉え、ポーズを「かな字形」として登録／判別する。
//   登録モード: いまのポーズを字と紐づけて Supabase に保存
//   判別モード: 最も近い字を推定し、一筆書き（または巨大文字）を重ねて描く
//  一筆書きは時間のブレンド：直近 1 秒を 0.1 秒ごとに取り、
//  隣り合う字形の間を補間して重ねる（Illustrator のブレンドツールのイメージ）。
// ============================================================

import { PoseLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs';
import { APP_CONFIG } from './config.js';
import { loadReferencePoses, savePose } from './pose-store.js';
import { normalizePose, toPixelPoints, matchLetter } from './pose-matcher.js';
import { PoseHistory } from './pose-history.js';
import { Renderer } from './renderer.js';
import * as ui from './ui.js';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

ui.setupLayout();
const renderer = new Renderer(ui.canvas);
const history = new PoseHistory(APP_CONFIG.limits.bufferMs);

// ── 状態 ────────────────────────────────────────────────────
let poseLandmarker = null;
let references = { poses: {}, lines: {} };
let latestNormalized = null;   // 直近フレームの正規化ポーズ（登録に使う）
let lastVideoTime = -1;
// 直近に一致した字。動いている最中は一致が外れやすいので、
// さかのぼる時間ぶんだけ保持して、尾のブレンドを描き切る。
let latched = { letter: null, atMs: -Infinity };

ui.bindControls({
  onRegister: registerCurrentPose,
  onThemeChange: () => renderer.syncTheme(),
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
    ui.setError(`参照ポーズを読み込めません（判別不可・登録は可能）: ${err.message}`);
  }

  // 3) 姿勢推定モデル（判別・描画に必要。無くてもカメラ映像は出る）
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
    });
  } catch (err) {
    ui.setError(`姿勢推定モデルを読み込めません: ${err.message}`);
  }
})();

async function startCamera() {
  try {
    // ideal で「希望」を伝えるだけにする。exact にすると、その解像度を出せない
    // カメラで起動そのものが失敗する。来たサイズには画面のほうを合わせる。
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: APP_CONFIG.video.width },
        height: { ideal: APP_CONFIG.video.height },
      },
      audio: false,
    });
    ui.video.srcObject = stream;
    ui.video.addEventListener('loadeddata', () => {
      ui.setStatus(`カメラを許可しました（${ui.video.videoWidth}×${ui.video.videoHeight}）。ポーズをとってください…`);
      requestAnimationFrame(renderLoop);
    }, { once: true });
  } catch (err) {
    ui.setError(`カメラを起動できません: ${err.message}`);
  }
}

// ── 描画ループ ──────────────────────────────────────────────
function renderLoop() {
  requestAnimationFrame(renderLoop);
  if (!poseLandmarker || ui.video.currentTime === lastVideoTime) return;
  lastVideoTime = ui.video.currentTime;

  // 実際に来ている解像度に毎フレーム追従する。
  // 変わったら軌跡は捨てる（前の解像度のピクセル座標が混ざると掃きが飛ぶ）
  const w = ui.video.videoWidth;
  const h = ui.video.videoHeight;
  if (ui.syncFrameSize(w, h)) history.clear();

  renderer.clear();
  const now = performance.now();
  const results = poseLandmarker.detectForVideo(ui.video, now);
  if (!results.landmarks?.length) return;

  const landmarks = results.landmarks[0];
  latestNormalized = normalizePose(landmarks);

  const pixelPoints = toPixelPoints(landmarks, w, h);
  history.push(now, pixelPoints);

  renderer.drawJoints(pixelPoints);

  if (ui.currentMode() !== 'detect') return;
  drawDetection(now);
}

/** 判別モードの描画とステータス表示 */
function drawDetection(now) {
  const refCount = Object.keys(references.poses).length;
  if (refCount === 0) {
    ui.setStatus('参照ポーズが読み込めていません（DB未接続）');
    return;
  }

  const { matchThreshold, windowMs, intervalMs } = ui.settings;
  const { letter, error } = matchLetter(latestNormalized, references.poses);
  const matched = letter && error < matchThreshold;

  if (matched) {
    latched = { letter, atMs: now };
    ui.setStatus(`判定結果:「${letter}」 誤差 ${error.toFixed(2)} / しきい値 ${matchThreshold.toFixed(2)}`);
  } else {
    // 一致しないときも「最も近い候補と誤差」を出す＝どれだけ惜しいか可視化しスライダーで調整できる
    ui.setStatus(`最も近い:「${letter ?? '—'}」誤差 ${error.toFixed(2)}（一致=しきい値 ${matchThreshold.toFixed(2)} 未満）／登録 ${refCount} 件`);
  }

  // 一致が切れても、さかのぼる時間のあいだは尾を描き続ける
  if (!latched.letter || now - latched.atMs > windowMs) {
    ui.setCurrentChar(null);
    ui.setShapeCount(0);
    return;
  }
  ui.setCurrentChar(latched.letter);

  const lines = references.lines[latched.letter];
  if (!lines?.length) {
    renderer.drawBigChar(latched.letter); // 線データが無い字（ノ/フ/リ等）は巨大文字表示
    ui.setShapeCount(0);
    return;
  }

  const frames = history.keyframes(windowMs, intervalMs, APP_CONFIG.limits.maxKeyframes);
  ui.setShapeCount(renderer.drawKanaBlend(lines, frames, ui.settings));
}

// ── 登録 ────────────────────────────────────────────────────
async function registerCurrentPose(letter) {
  if (!latestNormalized) { ui.setError('身体が検出されていません'); return; }

  ui.setStatus('Supabase に送信中…');
  try {
    await savePose(letter, latestNormalized);
    references = await loadReferencePoses(); // 追加分を即反映
    ui.clearKanaInput();
    ui.setStatus(`✅ 「${letter}」を登録しました`);
  } catch (err) {
    ui.setError(`登録に失敗しました: ${err.message}`);
  }
}

window.addEventListener('beforeunload', () => {
  ui.video.srcObject?.getTracks().forEach((t) => t.stop());
});
