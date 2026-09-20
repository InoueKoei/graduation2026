// ============================================================
//  script.js — 活字パズル ゲーム版（本体）
//  反転活字ブロック裏面の ArUco マーカーをカメラで読み取り、
//  左から並んだ順に単語を作って出題語と照合する。
//
//  出題語は「理想の組版」でもある。水平・等間隔・角度ゼロからのずれを
//  弾かずに「にじみ」として刷り上がりに出す（template.js / renderer.js）。
// ============================================================

import { loadOpenCv, startEnvironmentCamera, ArucoScanner, toDegrees } from './aruco-core.js';
import { GAME_CONFIG } from './config.js';
import { buildTemplate, deviations, disorder } from './template.js';
import { Renderer } from './renderer.js';
import * as ui from './ui.js';

const renderer = new Renderer(ui.canvas);

// ── アプリ状態 ──────────────────────────────────────────────
const state = {
  scanner: null,
  stream: null,
  camReady: false,
  running: false,     // ゲーム進行中か
  finished: false,
  questions: [],
  index: 0,
  currentWord: '',    // いま検出できている単語
  startTime: 0,
  timerId: null,
  rafId: null,
  frameCount: 0,
  fpsLastTs: 0,
};

const currentTarget = () => state.questions[state.index];

// ── 出題ロジック ────────────────────────────────────────────
/** Fisher–Yates シャッフル（元配列は変更しない） */
function shuffled(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** レベルごとに指定数だけランダムに選び、レベル順に並べた問題集を作る */
function buildQuestions() {
  const set = [];
  for (const level of [1, 2, 3]) {
    const count = GAME_CONFIG.counts[level] ?? 0;
    set.push(...shuffled(GAME_CONFIG.levels[level]).slice(0, count));
  }
  return set;
}

function showCurrentQuestion() {
  const target = currentTarget();
  if (target) ui.setTargetWord(target);
  else finishGame();
}

// ── タイマー ────────────────────────────────────────────────
function startTimer() {
  state.startTime = Date.now();
  updateTimer();
  state.timerId = setInterval(updateTimer, 500);
}

function updateTimer() {
  const diff = Date.now() - state.startTime;
  const m = String(Math.floor(diff / 60000)).padStart(2, '0');
  const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
  ui.setTimer(`Time: ${m}:${s}`);
}

function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
}

// ── ゲーム進行 ──────────────────────────────────────────────
function initGame() {
  state.questions = buildQuestions();
  state.index = 0;
  state.running = true;
  state.finished = false;
  ui.buttons.check.disabled = false;
  ui.buttons.restart.hidden = true;
  ui.setResult('', '');
  // 出題語を大きく表示する画面から開始（手元でブロックを組む間はカメラ非表示）
  ui.showTargetPanel(true);
  showCurrentQuestion();
  startTimer();
  ui.addLog(`ゲーム開始（全 ${state.questions.length} 問）`);
}

function finishGame() {
  stopTimer();
  state.running = false;
  state.finished = true;
  ui.buttons.check.disabled = true;
  ui.showTargetPanel(true);
  ui.setTargetWord('CLEAR!');
  ui.addLog(`★全問クリア！ ${ui.timerText()}`);
  ui.buttons.restart.hidden = false;
}

function checkAnswer() {
  if (!state.running) return;
  const target = currentTarget();

  // 正誤はあくまで「どの字を並べたか」。置き方の丁寧さ（にじみ）は別の軸に保つ。
  if (state.currentWord === target) {
    ui.setResult('ok', '正解');
    ui.addLog(`OK: ${target}`);
    setTimeout(() => {
      ui.setResult('', '');
      state.index++;
      showCurrentQuestion();
    }, GAME_CONFIG.feedbackMs);
  } else {
    ui.setResult('ng', '不正解');
    ui.addLog(`NG: 出題「${target}」／読み取り「${state.currentWord || '空'}」`);
    setTimeout(() => ui.setResult('', ''), GAME_CONFIG.feedbackMs);
  }
}

// ── 検出ループ ──────────────────────────────────────────────
function loop() {
  state.rafId = requestAnimationFrame(loop);
  if (!state.camReady) return;

  const w = ui.video.videoWidth;
  const h = ui.video.videoHeight;
  if (w === 0) return; // まだ映像が来ていない

  renderer.drawVideo(ui.video, w, h);

  let markers;
  try {
    markers = state.scanner.detect(renderer.readFrame(w, h));
  } catch (err) {
    console.error(err);
    return;
  }

  // 大きく傾いたものは「まだ置いていない／誤検出」として外す。
  // それ以内の傾きは弾かず、にじみとして表に出す。
  const placed = markers
    .filter((m) => Math.abs(toDegrees(m.angleRad)) <= GAME_CONFIG.angleTolerantDeg)
    .sort((a, b) => a.cx - b.cx);

  state.currentWord = placed.map((m) => m.char).join('');

  // 出題語の文字数を、あるべきスロット数として渡す
  const template = buildTemplate(placed, currentTarget()?.length);
  const devs = deviations(placed, template, GAME_CONFIG.bleed);

  renderer.drawTemplate(template);
  if (template) renderer.drawBlocks(placed, devs, template.size);

  ui.setStats({
    word: state.currentWord,
    count: markers.length,
    resolution: `${w}×${h}`,
    disorder: placed.length ? disorder(devs) : null,
  });
  updateFps();
}

function updateFps() {
  state.frameCount++;
  const now = performance.now();
  if (now - state.fpsLastTs >= 1000) {
    ui.setFps(state.frameCount);
    state.frameCount = 0;
    state.fpsLastTs = now;
  }
}

// ── イベント配線 ────────────────────────────────────────────
ui.bindControls({
  onSetupCamera: async () => {
    ui.buttons.setupCam.disabled = true;
    try {
      state.stream = await startEnvironmentCamera(ui.video, { width: 1280, height: 720 });
      state.camReady = true;
      ui.showTargetPanel(false); // 準備できたら映像を見せる
      ui.buttons.startGame.disabled = false;
      ui.buttons.toggleVid.disabled = false;
      ui.addLog('カメラ準備完了');
      state.fpsLastTs = performance.now();
      loop();
    } catch (err) {
      ui.buttons.setupCam.disabled = false;
      ui.showError(`カメラを起動できません: ${err.message}`);
    }
  },

  onStartGame: () => {
    ui.buttons.startGame.hidden = true;
    initGame();
  },

  onRestart: initGame,

  onToggleView: () => {
    if (state.finished) return;
    const showingCamera = ui.isCameraVisible();
    ui.showTargetPanel(showingCamera);
    if (showingCamera && !state.running) ui.setTargetWord('READY?');
  },

  onCheck: checkAnswer,

  onThemeChange: () => renderer.syncTheme(),
});

window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(state.rafId);
  stopTimer();
  state.scanner?.dispose();
  state.stream?.getTracks().forEach((t) => t.stop());
});

// ── 起動 ────────────────────────────────────────────────────
(async function boot() {
  try {
    const cv = await loadOpenCv(undefined, {
      onProgress: (stage) => ui.setLoaderState(`opencv.js を${stage}中…`),
    });
    state.scanner = new ArucoScanner(cv);
    ui.setLoaderState('✅ OpenCV.js 準備完了', 'ready');
    ui.buttons.setupCam.disabled = false;
  } catch (err) {
    ui.setLoaderState(`❌ ${err.message}`, 'error');
    ui.showError(err.message);
  }
})();
