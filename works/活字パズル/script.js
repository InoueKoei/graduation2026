// ============================================================
//  script.js — 活字パズル ゲーム版
//  反転活字ブロック裏面の ArUco マーカーをカメラで読み取り、
//  左から並んだ順に単語を作って出題語と照合する。
// ============================================================

import {
  loadOpenCv,
  startEnvironmentCamera,
  ArucoScanner,
  toDegrees,
} from './aruco-core.js';
import { GAME_CONFIG } from './config.js';

// ── DOM 参照 ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const cvStatus       = $('cvStatus');
const errorBanner    = $('errorBanner');
const setupCamBtn    = $('setupCamBtn');
const startGameBtn   = $('startGameBtn');
const toggleVidBtn   = $('toggleVidBtn');
const checkBtn       = $('checkBtn');
const restartBtn     = $('restartBtn');

const viewContainer  = $('viewContainer');
const targetDisplay  = $('targetDisplay');
const targetWordText = $('targetWordText');
const resultStatus   = $('resultStatus');
const resultChip     = $('resultChip');
const timerDisplay   = $('timerDisplay');

const countVal       = $('countVal');
const fpsVal         = $('fpsVal');
const resVal         = $('resVal');
const idsList        = $('idsList');
const logEl          = $('log');

const video  = $('video');
const canvas = $('output');
const ctx    = canvas.getContext('2d');

// ── アプリ状態 ──────────────────────────────────────────────
const state = {
  scanner: null,      // ArucoScanner
  stream: null,       // MediaStream
  camReady: false,
  running: false,     // ゲーム進行中か
  finished: false,
  questions: [],      // 出題語の配列
  index: 0,           // 現在の出題インデックス
  currentWord: '',    // いま検出できている単語
  startTime: 0,
  timerId: null,
  rafId: null,
  // FPS 計測用
  frameCount: 0,
  fpsLastTs: 0,
};

// ── ログ / エラー表示 ────────────────────────────────────────
function addLog(msg) {
  const line = document.createElement('div');
  line.textContent = msg;
  logEl.prepend(line);
  while (logEl.children.length > 60) logEl.removeChild(logEl.lastChild);
}

function showError(msg) {
  errorBanner.textContent = `⚠️ ${msg}`;
  errorBanner.hidden = false;
  addLog(`ERROR: ${msg}`);
}

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
  const target = state.questions[state.index];
  if (target) {
    targetWordText.textContent = target;
  } else {
    finishGame();
  }
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
  timerDisplay.textContent = `Time: ${m}:${s}`;
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
  checkBtn.disabled = false;
  restartBtn.hidden = true;
  setResult('', '');
  // 出題語を大きく表示する画面から開始（手元でブロックを組む間はカメラ非表示）
  showTargetPanel(true);
  showCurrentQuestion();
  startTimer();
  addLog(`ゲーム開始（全 ${state.questions.length} 問）`);
}

function finishGame() {
  stopTimer();
  state.running = false;
  state.finished = true;
  checkBtn.disabled = true;
  showTargetPanel(true);
  targetWordText.textContent = 'CLEAR!';
  addLog(`★全問クリア！ ${timerDisplay.textContent}`);
  restartBtn.hidden = false;
}

/** 正誤表示（モノクロのチップ。cls: 'ok' | 'ng' | ''） */
function setResult(cls, text) {
  resultStatus.className = cls;
  resultChip.textContent = text;
}

function checkAnswer() {
  if (!state.running) return;
  const target = state.questions[state.index];

  if (state.currentWord === target) {
    setResult('ok', '正解');
    addLog(`OK: ${target}`);
    setTimeout(() => {
      setResult('', '');
      state.index++;
      showCurrentQuestion();
    }, GAME_CONFIG.feedbackMs);
  } else {
    setResult('ng', '不正解');
    addLog(`NG: 出題「${target}」／読み取り「${state.currentWord || '空'}」`);
    setTimeout(() => setResult('', ''), GAME_CONFIG.feedbackMs);
  }
}

/** true でターゲット表示、false でカメラ表示に切り替える */
function showTargetPanel(showTarget) {
  targetDisplay.hidden = !showTarget;
  viewContainer.hidden = showTarget;
}

// ── 検出ループ ──────────────────────────────────────────────
function loop() {
  state.rafId = requestAnimationFrame(loop);
  if (!state.camReady) return;

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w === 0) return; // まだ映像が来ていない

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);

  let markers;
  try {
    markers = state.scanner.detect(ctx.getImageData(0, 0, w, h));
  } catch (err) {
    console.error(err);
    return;
  }

  // まっすぐ置かれたマーカーだけを単語の対象にする
  const valid = [];
  for (const m of markers) {
    const straight = Math.abs(toDegrees(m.angleRad)) <= GAME_CONFIG.angleLimitDeg;
    drawMarker(m, straight);
    if (straight) valid.push(m);
  }
  valid.sort((a, b) => a.cx - b.cx);
  state.currentWord = valid.map((m) => m.char).join('');

  idsList.textContent = state.currentWord || '— none —';
  countVal.textContent = String(markers.length);
  resVal.textContent = `${w}×${h}`;
  updateFps();
}

function updateFps() {
  state.frameCount++;
  const now = performance.now();
  if (now - state.fpsLastTs >= 1000) {
    fpsVal.textContent = String(state.frameCount);
    state.frameCount = 0;
    state.fpsLastTs = now;
  }
}

/** 検出したマーカーの枠と文字をオーバーレイ描画する */
function drawMarker(marker, straight) {
  const c = marker.corners;
  // sumi 準拠でモノクロ。まっすぐ＝白の実線（太）、傾き＝半透明の白（細）で区別
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 4;
  ctx.strokeStyle = straight ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = straight ? 5 : 2;
  ctx.beginPath();
  ctx.moveTo(c[0], c[1]);
  for (let j = 1; j < 4; j++) ctx.lineTo(c[j * 2], c[j * 2 + 1]);
  ctx.closePath();
  ctx.stroke();

  ctx.fillStyle = straight ? '#fff' : 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 28px "Hiragino Mincho ProN", serif';
  ctx.fillText(marker.char, c[0], c[1] - 10);
  ctx.restore();
}

// ── イベント配線 ────────────────────────────────────────────
setupCamBtn.addEventListener('click', async () => {
  setupCamBtn.disabled = true;
  try {
    state.stream = await startEnvironmentCamera(video, { width: 1280, height: 720 });
    state.camReady = true;
    showTargetPanel(false); // カメラ映像を表示（準備できたら映像を見せる）
    startGameBtn.disabled = false;
    toggleVidBtn.disabled = false;
    addLog('カメラ準備完了');
    state.fpsLastTs = performance.now();
    loop();
  } catch (err) {
    setupCamBtn.disabled = false;
    showError(`カメラを起動できません: ${err.message}`);
  }
});

startGameBtn.addEventListener('click', () => {
  startGameBtn.hidden = true;
  initGame();
});

restartBtn.addEventListener('click', initGame);

toggleVidBtn.addEventListener('click', () => {
  if (state.finished) return;
  const showingCamera = !viewContainer.hidden;
  showTargetPanel(showingCamera);
  if (showingCamera && !state.running) targetWordText.textContent = 'READY?';
});

checkBtn.addEventListener('click', checkAnswer);

// ライト / ダーク切替（sumi の2モード＝data-theme 反転）
$('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
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
    const cv = await loadOpenCv();
    state.scanner = new ArucoScanner(cv);
    cvStatus.textContent = '✅ OpenCV.js 準備完了';
    cvStatus.classList.add('ready');
    setupCamBtn.disabled = false;
  } catch (err) {
    cvStatus.textContent = `❌ ${err.message}`;
    cvStatus.classList.add('error');
    showError(err.message);
  }
})();
