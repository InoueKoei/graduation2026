// ============================================================
//  script.js — KanaDance 本体（初期化と描画ループ）
//  カメラで身体を捉え、ポーズを「かな字形」として登録／判別する。
//   登録モード: いまのポーズを字と紐づけて Supabase に保存
//   判別モード: 最も近い字を推定し、一筆書き（または巨大文字）を重ねて描く
//  一筆書きは時間のブレンド：直近 1 秒を 0.1 秒ごとに取り、
//  隣り合う字形の間を補間して重ねる（Illustrator のブレンドツールのイメージ）。
// ============================================================

import { APP_CONFIG, LANDMARKS, BODY_CALIBRATION } from './config.js';
import { RUNTIME } from './runtime-config.js';
import { loadReferencePoses, savePose } from './pose-store.js';
import {
  normalizePose, toPixelPoints, matchLetter,
  lengthRatios, rescalePose, isFacingFront, allVisible,
} from './pose-matcher.js';
import { BodyCalibration } from './body-calibration.js';
import { PoseHistory } from './pose-history.js';
import { Renderer } from './renderer.js';
import * as ui from './ui.js';

ui.setupLayout();
const renderer = new Renderer(ui.canvas);
const history = new PoseHistory(APP_CONFIG.limits.bufferMs);
const calibration = new BodyCalibration(BODY_CALIBRATION);

// ── 状態 ────────────────────────────────────────────────────
let poseLandmarker = null;
let references = { poses: {}, lines: {}, pending: [] };
let latestNormalized = null;   // 直近フレームの正規化ポーズ（登録に使う）
let lastVideoTime = -1;
// 直近に一致した字。動いている最中は一致が外れやすいので、
// さかのぼる時間ぶんだけ保持して、尾のブレンドを描き切る。
let latched = { letter: null, atMs: -Infinity };
// 体型合わせの倍率（体節ごと）。null なら合わせていない＝登録ポーズをそのまま使う
let ratios = null;
// 判定に使う登録ポーズ。体型を合わせたときは、その人の体型に組み直したもの
let activeRefs = {};

ui.bindControls({
  onRegister: registerCurrentPose,
  onThemeChange: () => renderer.syncTheme(),
  onCalibrate: startCalibration,
  onCancelCalibration: () => {
    calibration.cancel();
    ui.hideCalibration();
  },
  onResetCalibration: () => {
    ratios = null;
    applyCalibration();
    ui.setCalibrated(false);
    ui.setStatus('体型合わせを解除しました');
  },
});

// ── 初期化 ──────────────────────────────────────────────────
// カメラ起動を最優先にし、DB／モデルの読み込み失敗に巻き込まれないようにする。
(async function init() {
  // 1) カメラ（映像が最優先。ここが他の読み込みに引きずられて止まらないこと）
  await startCamera();

  // 2) 参照ポーズ（失敗しても致命ではない：登録は可能・判別のみ不可）
  await reloadReferences();

  // 3) 姿勢推定モデル（判別・描画に必要。無くてもカメラ映像は出る）
  //    取得元は runtime-config.js。USB 版では同梱した vendor/ を指す。
  try {
    const { PoseLandmarker, FilesetResolver } = await import(RUNTIME.assets.visionBundle);
    const vision = await FilesetResolver.forVisionTasks(RUNTIME.assets.wasmRoot);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: RUNTIME.assets.poseModel, delegate: 'GPU' },
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
  if (!results.landmarks?.length) {
    if (calibration.active) stepCalibration(now, null, null);
    return;
  }

  const landmarks = results.landmarks[0];
  latestNormalized = normalizePose(landmarks);

  const pixelPoints = toPixelPoints(landmarks, w, h);
  history.push(now, pixelPoints);

  renderer.drawJoints(pixelPoints);

  if (calibration.active) {
    stepCalibration(now, latestNormalized, landmarks);
    return;
  }

  if (ui.currentMode() !== 'detect') return;
  drawDetection(now);
}

/** 判別モードの描画とステータス表示 */
function drawDetection(now) {
  const refCount = Object.keys(activeRefs).length;
  if (refCount === 0) {
    ui.setStatus('登録済みの字がありません');
    return;
  }

  const { matchThreshold, windowMs, intervalMs } = ui.settings;
  const { letter, error } = matchLetter(latestNormalized, activeRefs);
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

// ── 体型合わせ ──────────────────────────────────────────────
// 体験の最初に、正面を向いてイのポーズで静止してもらい、その人の体節の長さを測る。
// 登録したイと比べた倍率で、登録ポーズを全部その人の体型に組み直す。

/** 判定に使う登録ポーズを作り直す（倍率が無ければそのまま） */
function applyCalibration() {
  activeRefs = ratios
    ? Object.fromEntries(Object.entries(references.poses).map(([l, p]) => [l, rescalePose(p, ratios)]))
    : references.poses;
}

function startCalibration() {
  // 同じポーズ（イ）どうしで比べるので、イが登録されていないと倍率が出せない
  if (!references.poses[BODY_CALIBRATION.letter]) {
    ui.setError(`体型合わせには「${BODY_CALIBRATION.letter}」の登録が必要です`);
    return;
  }
  calibration.start(performance.now());
}

/** 体型合わせ中の1フレーム。測り終えたら倍率を決めて判定に反映する */
function stepCalibration(now, pose, landmarks) {
  const checks = landmarks
    ? {
      visible: allVisible(landmarks, LANDMARKS, BODY_CALIBRATION.minVisibility),
      facing: isFacingFront(landmarks, BODY_CALIBRATION.facingTol),
    }
    : { visible: false, facing: false };

  const measured = calibration.feed(pose, now, checks);
  ui.showCalibration(BODY_CALIBRATION.letter, calibration.phase, calibration.reason, calibration.progress(now));
  if (!measured) return;

  ratios = lengthRatios(measured, references.poses[BODY_CALIBRATION.letter]);
  applyCalibration();
  ui.hideCalibration();
  ui.setCalibrated(true);
  history.clear();
  const arm = (ratios.upper_arm + ratios.forearm) / 2;
  const leg = (ratios.thigh + ratios.shin) / 2;
  ui.setStatus(`体型を合わせました（腕 ×${arm.toFixed(2)}・脚 ×${leg.toFixed(2)}・頭 ×${ratios.neck_head.toFixed(2)}）`);
}

// ── 参照ポーズ ──────────────────────────────────────────────
/** 参照ポーズを読み直す（登録のあとにも呼ぶ） */
async function reloadReferences() {
  try {
    references = await loadReferencePoses();
    applyCalibration();
    ui.setKanaInfo({
      ready: Object.keys(references.poses),
      pending: references.pending,
    });
  } catch (err) {
    references = { poses: {}, lines: {}, pending: [] };
    applyCalibration();
    ui.setError(`参照ポーズを読み込めません（判別不可・登録は可能）: ${err.message}`);
  }
  latched = { letter: null, atMs: -Infinity };
}

// ── 登録 ────────────────────────────────────────────────────
async function registerCurrentPose(letter) {
  if (!latestNormalized) { ui.setError('身体が検出されていません'); return; }

  ui.setStatus('Supabase に送信中…');
  try {
    await savePose(letter, latestNormalized);
    await reloadReferences(); // 追加分を即反映
    ui.clearKanaInput();
    ui.setStatus(`✅ 「${letter}」を登録しました`);
  } catch (err) {
    ui.setError(`登録に失敗しました: ${err.message}`);
  }
}

window.addEventListener('beforeunload', () => {
  ui.video.srcObject?.getTracks().forEach((t) => t.stop());
});
