// ============================================================
//  script.js — Sessan（空中タイピング）本体
//  MediaPipe Holistic（レガシー solution）で手・顔を同時追跡する。
//  Holistic / Camera は CDN の classic script が window に載せたものを使う。
//
//  指の本数で「行」、口形（母音）で「段」を選び、静止保持で確定する。
//  母音は口腔の面積と縦横比で判別する（typing-core.js）。
//  確定中の字は、顔を近づけるほど大きく描かれる（renderer.js）。
// ============================================================

import {
  CAMERA, HOLD_FRAMES, GOJUON, GYO_NAMES, DAKUTEN, HANDAKUTEN,
  VOWEL_TARGETS, EYE_TARGETS, HOLISTIC_OPTIONS, CALIBRATION, HEARTBEAT, SNAPSHOT,
  GLYPH, TUNING, FINGERS,
} from './config.js';
import {
  countFingers, analyzeFace, classifyVowel, isEyeClosed, withModifier, HoldGate, FingerVote,
} from './typing-core.js';
import { Calibration, loadTargets, saveTargets, clearTargets, hasSaved } from './calibration.js';
import { Renderer } from './renderer.js';
import { HeartSim } from './heartbeat.js';
import { loadTuning, hasTuning } from './tuning.js';
import * as ui from './ui.js';

// 確認用ページ（_preview-glyph.html）で詰めた値があれば、それで動く。
// 無ければ config.js の既定値。プレビューと画面を同じ値で動かすための口。
const glyphConfig = loadTuning(TUNING.glyphKey, GLYPH);
const heartConfig = loadTuning(TUNING.heartKey, HEARTBEAT);
const tuned = hasTuning(TUNING.glyphKey) || hasTuning(TUNING.heartKey);

const renderer = new Renderer(ui.canvas, ui.stage, glyphConfig);
const calibration = new Calibration(CALIBRATION);
/** センサが無いので合成波で代用している。実センサに差し替えるならここ */
const heart = new HeartSim(heartConfig);

ui.setTuningMark(tuned);

// ── 状態 ────────────────────────────────────────────────────
let typedText = '';
let lastSelectedChar = '';
/** 直前に確定したときの「近さ」と「心拍」。濁点で字形を刷り直すのに要る */
let lastConfirm = null;
/** 較正済みなら保存値、無ければ config の既定値 */
let vowelTargets = loadTargets(CALIBRATION.storageKey, VOWEL_TARGETS);

const charGate = new HoldGate(HOLD_FRAMES.char);
const bsGate = new HoldGate(HOLD_FRAMES.backspace);
const modGate = new HoldGate(HOLD_FRAMES.modifier);

// 本数の読みを数フレームの多数決でならす。
// 1フレームぶれるだけで選択字が変わり、保持が振り出しに戻るのを防ぐ。
const fingerVote = new FingerVote(FINGERS.voteFrames);
const fistVote = new FingerVote(FINGERS.voteFrames);

ui.setCalibrationState(hasSaved(CALIBRATION.storageKey));

ui.bindControls({
  onCalibrate: () => calibration.start(performance.now()),
  onCancelCalibration: () => {
    calibration.cancel();
    ui.hideCalibration();
  },
  onResetCalibration: () => {
    clearTargets(CALIBRATION.storageKey);
    vowelTargets = { ...VOWEL_TARGETS };
    ui.setCalibrationState(false);
    ui.setStatus('較正を初期値に戻しました');
    setTimeout(ui.hideStatus, 1500);
  },
  onThemeChange: () => renderer.syncTheme(),
});

// ── Holistic セットアップ ───────────────────────────────────
if (!window.Holistic || !window.Camera) {
  ui.setStatus('⚠️ MediaPipe の読み込みに失敗しました（ネットワーク接続を確認してください）');
} else {
  const holistic = new window.Holistic({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`,
  });
  holistic.setOptions(HOLISTIC_OPTIONS);
  holistic.onResults(onResults);

  const camera = new window.Camera(ui.video, {
    onFrame: async () => { await holistic.send({ image: ui.video }); },
    width: CAMERA.width,
    height: CAMERA.height,
  });
  camera.start()
    .then(() => ui.hideStatus())
    .catch((err) => ui.setStatus(`⚠️ カメラを起動できません: ${err.message}`));
}

// ── フレーム処理 ────────────────────────────────────────────
function onResults(results) {
  ui.hideStatus(); // フレームが流れ始めたら「準備中…」を確実に隠す
  renderer.drawMirroredFrame(results.image, ui.video.videoWidth, ui.video.videoHeight);

  // 心拍は入力の有無に関わらず進める（較正中も止めない）
  const beat = heart.sample(performance.now());
  ui.setHeart(beat);

  const metrics = results.faceLandmarks ? analyzeFace(results.faceLandmarks) : null;

  // 較正中は入力を止め、口形の取り込みだけを行う
  if (calibration.active) {
    runCalibration(metrics);
    return;
  }

  const leftF = results.leftHandLandmarks ? countFingers(results.leftHandLandmarks, FINGERS) : -1;
  const rightF = results.rightHandLandmarks ? countFingers(results.rightHandLandmarks, FINGERS) : -1;
  // 読みは生のままでは使わない。多数決を通してから行と修飾を決める
  const totalF = fingerVote.push((leftF > 0 ? leftF : 0) + (rightF > 0 ? rightF : 0));
  const fistCount = fistVote.push((leftF === 0 ? 1 : 0) + (rightF === 0 ? 1 : 0));

  if (metrics) {
    const vowel = classifyVowel(metrics, vowelTargets);
    const closed = isEyeClosed(metrics, EYE_TARGETS);
    ui.setFace(vowel, closed);

    const vowelIdx = vowel === 'close' ? -1 : { あ: 0, い: 1, う: 2, え: 3, お: 4 }[vowel];

    handleBackspace(closed);
    handleModifier(closed, totalF, fistCount);
    handleCharInput(closed, totalF, vowelIdx, metrics.proximity, beat);
  }

  ui.setHand(totalF, totalF > 0 ? `${GYO_NAMES[totalF - 1]}行` : '待機');
}

/** 較正の進行と、終わったときの保存 */
function runCalibration(metrics) {
  const now = performance.now();
  ui.showCalibration(calibration.vowel, calibration.stepText, calibration.phase, calibration.progress(now));

  const result = calibration.feed(metrics, now);
  if (!result) return;

  // 較正しなかった 'close' などは既定値のまま残る
  vowelTargets = { ...vowelTargets, ...result };
  saveTargets(CALIBRATION.storageKey, result);
  ui.setCalibrationState(true);
  ui.hideCalibration();
  ui.setStatus('較正しました');
  setTimeout(ui.hideStatus, 1500);
}

// ── 各操作の状態機械 ────────────────────────────────────────
/** 目を閉じ続けたら1字削除（バックスペース） */
function handleBackspace(closed) {
  if (closed) {
    if (bsGate.tick()) {
      typedText = typedText.slice(0, -1);
      ui.setText(typedText);
      ui.popSnapshot(); // 記録も1件戻す
      lastConfirm = null; // 消した字の位相は、もう刷り直す先がない
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
      ui.setText(typedText);
      if (typedText) {
        // 濁点がついた字を、確定したときと同じ位相で刷り直す（顔は撮り直さない）
        const last = typedText.slice(-1);
        const glyph = lastConfirm
          ? renderer.captureGlyph(last, lastConfirm.proximity, lastConfirm.heart, SNAPSHOT.thumbWidth)
          : null;
        ui.relabelLastSnapshot(last, glyph);
      }
    }
    ui.setModifierGauge(modGate.progress(), fistCount === 1 ? '[濁点]' : '[半濁点]');
  } else {
    modGate.resetCounter();
    ui.setModifierGauge(0, '');
    // 指も拳も無い（手を下ろした）状態に戻ったらロック解除
    if (totalF === 0 && fistCount === 0) modGate.unlock();
  }
}

/** 同じ字を保持し続けたら確定入力。確定中の字は顔の近さで大きさが決まる */
function handleCharInput(closed, totalF, vowelIdx, proximity, heartbeat) {
  const valid = !closed && totalF > 0 && vowelIdx !== -1;

  if (!valid) {
    ui.setCurrentChar(closed ? '消' : 'ー');
    charGate.reset();
    ui.setCharGauge(0);
    if (!closed) lastSelectedChar = '';
    return;
  }

  const char = GOJUON[totalF - 1][vowelIdx];
  ui.setCurrentChar(char);

  if (char !== lastSelectedChar) {
    lastSelectedChar = char;
    charGate.reset();
  } else if (charGate.tick()) {
    typedText += char;
    ui.setText(typedText);
    // 確定＝この瞬間の字形（心拍の位相ごと）と顔を記録する。
    // 字形は画面と同じ手で刷るので、見えていた形がそのまま残る。
    lastConfirm = { proximity, heart: heartbeat };
    ui.recordSnapshot(
      char,
      renderer.captureGlyph(char, proximity, heartbeat, SNAPSHOT.thumbWidth),
      heartbeat?.bpm,
    );
  }

  ui.setCharGauge(charGate.progress());
  // 顔を近づけるほど大きく、保持するほど濃く、心拍の位相で短冊がずれる
  renderer.drawCurrentChar(char, proximity, charGate.progress(), heartbeat);
}
