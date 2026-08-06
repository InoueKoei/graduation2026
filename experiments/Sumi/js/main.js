import { CONFIG } from './config.js';
import { SensorFeed } from './sensor.js';
import { Sumi } from './game.js';

const $ = (id) => document.getElementById(id);

const sensor = new SensorFeed();
sensor.start();
const game = new Sumi($('dish'));
window.__sumi = { sensor, game };

// フォールバック: マウスで傾き、押している間は「揺らしている」扱い
let mouseShake = 0;
addEventListener('pointermove', (e) => {
  const cx = innerWidth / 2, cy = innerHeight / 2;
  const s = Math.min(innerWidth, innerHeight) / 2;
  sensor.simTilt.x = Math.max(-1, Math.min(1, (e.clientX - cx) / s));
  sensor.simTilt.y = Math.max(-1, Math.min(1, (e.clientY - cy) / s));
});
addEventListener('pointerdown', (e) => {
  if (e.target.id !== 'again') mouseShake = 0.28;
});
addEventListener('pointerup', () => { mouseShake = 0; });

$('again').addEventListener('click', () => {
  game.reset();
  $('over').hidden = true;
});

const tilt = { x: 0, y: 0 };
let prev = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  const t = sensor.tilt;
  const k = Math.min(1, CONFIG.tiltEase * dt);
  tilt.x += (t.x - tilt.x) * k;
  tilt.y += (t.y - tilt.y) * k;

  const shake = sensor.usingSim ? mouseShake : sensor.rawShake;
  game.step(dt, tilt, shake);
  game.render();

  // HUD
  $('score').textContent = game.score;
  const bar = $('inkBar');
  bar.style.width = game.ink + '%';
  bar.classList.toggle('low', game.ink < 30);
  const calm = game.wave < 0.12;
  $('calm').textContent = calm ? '静' : '揺';
  $('calmLabel').textContent = calm ? 'しずか' : 'なみ';
  $('dot').className = 'dot ' + (sensor.usingSim ? 'sim' : sensor.connected ? 'ok' : '');

  if (game.score > 0 || game.time > 8) $('hint').classList.add('hide');

  // ゲームオーバー表示は game.over と常に同期させる(リセット時に確実に消える)
  const overEl = $('over');
  if (game.over && overEl.hidden) {
    $('finalScore').textContent = game.score;
    $('finalTime').textContent = game.time.toFixed(0);
    overEl.hidden = false;
  } else if (!game.over && !overEl.hidden) {
    overEl.hidden = true;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
