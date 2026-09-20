// ============================================================
//  script.js — 活字パズル シンプル版（投影用）
//  検出したかなを「下部スクリーン」に物理角度そのままで描画し、
//  同時に「上部テキスト」へ左から順に並べる、インスタレーション表示。
// ============================================================

import { loadOpenCv, startEnvironmentCamera, ArucoScanner } from '../aruco-core.js';
import { DISPLAY_CONFIG } from './config.js';

// ── 解像度・比率（config から導出） ──────────────────────────
const FULL_W = DISPLAY_CONFIG.camera.width;
const FULL_H = DISPLAY_CONFIG.camera.height;
const DISP_W = DISPLAY_CONFIG.screen.width;
const DISP_H = DISPLAY_CONFIG.screen.height;
const OFFSET_Y = FULL_H - DISP_H;      // 下部だけを見せるための切り取り量
const SCALE = DISP_W / FULL_W;          // フルフレーム → 表示スクリーンの縮尺

// ── DOM 参照 ────────────────────────────────────────────────
const video          = document.getElementById('video');
const hiddenCanvas   = document.getElementById('hiddenCanvas');
const canvas         = document.getElementById('output');
const startBtn       = document.getElementById('start-btn');
const startOverlay   = document.getElementById('start-overlay');
const startStatus    = document.getElementById('start-status');
const stringContainer = document.getElementById('current-string-container');

const ctx  = canvas.getContext('2d');
const hCtx  = hiddenCanvas.getContext('2d', { willReadFrequently: true });

let scanner = null;
let running = false;

// ── 起動フロー ──────────────────────────────────────────────
(async function boot() {
  try {
    const cv = await loadOpenCv(undefined, {
      onProgress: (stage) => { startStatus.textContent = `opencv.js を${stage}中…`; },
    });
    scanner = new ArucoScanner(cv);
    startStatus.textContent = 'READY';
    startBtn.disabled = false;
  } catch (err) {
    startStatus.textContent = `⚠️ ${err.message}`;
  }
})();

startBtn.addEventListener('click', async () => {
  if (!scanner || running) return;
  startBtn.disabled = true;
  startStatus.textContent = 'カメラを起動中…';
  try {
    await startEnvironmentCamera(video, { width: FULL_W, height: FULL_H });
    hiddenCanvas.width = FULL_W;
    hiddenCanvas.height = FULL_H;
    canvas.width = DISP_W;
    canvas.height = DISP_H;
    startOverlay.hidden = true;
    running = true;
    requestAnimationFrame(loop);
  } catch (err) {
    startBtn.disabled = false;
    startStatus.textContent = `⚠️ カメラを起動できません: ${err.message}`;
  }
});

// ── メインループ ────────────────────────────────────────────
function loop() {
  if (!running) return;
  requestAnimationFrame(loop);

  // フル解像度でフレームを取り込み（検出用）
  hCtx.drawImage(video, 0, 0, FULL_W, FULL_H);

  // 表示スクリーンには下部 2:1 だけを見せる
  ctx.clearRect(0, 0, DISP_W, DISP_H);
  ctx.drawImage(hiddenCanvas, 0, -OFFSET_Y * SCALE, DISP_W, FULL_H * SCALE);

  let markers;
  try {
    markers = scanner.detect(hCtx.getImageData(0, 0, FULL_W, FULL_H));
  } catch (err) {
    console.error(err);
    return;
  }

  const detected = markers.map((m) => {
    const renderX = m.cx * SCALE;
    const renderY = (m.cy - OFFSET_Y) * SCALE;
    drawArChar(m.char, renderX, renderY, m.angleRad);
    return { char: m.char, x: renderX, angle: m.angleRad };
  });

  updateUpperText(detected);
}

// ── 下部スクリーンへの描画（原点は「底辺中央」＝ハード側都合） ──
function drawArChar(text, x, y, angle) {
  ctx.save();
  ctx.translate(DISP_W / 2, DISP_H);       // 原点を中央下へ
  ctx.translate(x - DISP_W / 2, y - DISP_H); // 絶対座標 → 原点からの相対座標
  ctx.rotate(angle);                        // ブロックの物理角度そのまま

  ctx.font = DISPLAY_CONFIG.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = DISPLAY_CONFIG.shadow.color;
  ctx.shadowBlur = DISPLAY_CONFIG.shadow.blur;
  ctx.fillStyle = 'white';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// ── 上部テキスト（左から順に、角度を CSS で同期） ─────────────
const PLACEHOLDER = '<span class="placeholder">---</span>';

function updateUpperText(detectedArray) {
  if (detectedArray.length === 0) {
    if (stringContainer.innerHTML !== PLACEHOLDER) stringContainer.innerHTML = PLACEHOLDER;
    return;
  }
  detectedArray.sort((a, b) => a.x - b.x);
  const frag = document.createDocumentFragment();
  for (const d of detectedArray) {
    const span = document.createElement('span');
    span.className = 'sync-char-span';
    span.textContent = d.char;
    span.style.transform = `rotate(${d.angle}rad)`;
    frag.appendChild(span);
  }
  stringContainer.replaceChildren(frag);
}

window.addEventListener('beforeunload', () => {
  running = false;
  scanner?.dispose();
  video.srcObject?.getTracks().forEach((t) => t.stop());
});
