import { CONFIG } from './config.js';
import { SensorFeed } from './sensor.js';
import { FogLayer } from './fog.js';
import { BG_MODES, drawBackground } from './background.js';

const bg = document.getElementById('bg');
const fogCanvas = document.getElementById('fog');
const hudStats = document.getElementById('stats');
const dot = document.getElementById('dot');
const hint = document.getElementById('hint');
const cursor = document.getElementById('cursor');

const sensor = new SensorFeed();
const fog = new FogLayer(fogCanvas);
sensor.start();

// 開発用: コンソールから状態をいじれる窓口 (例: __glass.fog.level = 1)
window.__glass = { sensor, fog };

// --- 背景（右上のセレクタで切替、選択は記憶される） ---
const bgSelect = document.getElementById('bgSelect');
let bgMode = localStorage.getItem('glasstype.bg') || CONFIG.background;
for (const m of BG_MODES) {
  const opt = document.createElement('option');
  opt.value = m.value;
  opt.textContent = '背景: ' + m.label;
  bgSelect.appendChild(opt);
}
bgSelect.value = bgMode;
bgSelect.addEventListener('change', () => {
  bgMode = bgSelect.value;
  localStorage.setItem('glasstype.bg', bgMode);
  drawBackground(bg, bgMode);
});
drawBackground(bg, bgMode);

// --- 入力（マウス/タッチ共通のpointerイベント） ---
let wiping = false;
let last = null;
let interacted = false;

const toBuf = (e) => ({ x: e.clientX * fog.dpr, y: e.clientY * fog.dpr });

fogCanvas.addEventListener('pointerdown', (e) => {
  try { fogCanvas.setPointerCapture(e.pointerId); } catch (_) {}
  wiping = true;
  last = toBuf(e);
  fog.wipe(last.x, last.y, last.x, last.y);
  interacted = true;
});
addEventListener('pointermove', (e) => {
  cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  cursor.style.opacity = 1;
  if (!wiping) return;
  const p = toBuf(e);
  fog.wipe(last.x, last.y, p.x, p.y);
  last = p;
});
addEventListener('pointerup', () => { wiping = false; last = null; });

addEventListener('resize', () => {
  drawBackground(bg, bgMode);
  fog.resize();
});

// --- メインループ ---
let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;

  sensor.update(dt);
  fog.update(dt, sensor.fogTarget);
  fog.render();

  const t = sensor.temp != null ? sensor.temp.toFixed(1) : '--';
  const h = sensor.humidity != null ? sensor.humidity.toFixed(1) : '--';
  const f = Math.round(fog.level * 100);
  const mode = sensor.simActive ? '｜シミュレーション中: SPACE長押し＝息' : '';
  hudStats.textContent = `${t}°C  ${h}%  曇り ${f}%${mode}`;
  dot.className = 'dot ' + (sensor.connected ? 'ok' : sensor.simActive ? 'sim' : 'ng');

  if (interacted && fog.level > 0.3) hint.classList.add('hide');

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
