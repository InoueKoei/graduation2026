import { CONFIG } from './config.js';
import { SensorFeed } from './sensor.js';
import { Kei } from './game.js';

const $ = (id) => document.getElementById(id);

const sensor = new SensorFeed();
sensor.start();
const game = new Kei($('river'));
window.__kei = { sensor, game };

// マウス代替(センサー未接続時): カーソルの左右位置が傾き
addEventListener('pointermove', (e) => {
  const nx = (e.clientX - innerWidth / 2) / (innerWidth / 2);
  sensor.simTilt.x = Math.max(-1, Math.min(1, nx)) * CONFIG.tiltRange;
});
// どこを押してもやり直し(死んだあと)
addEventListener('pointerdown', () => { if (game.over) restart(); });
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && game.over) { restart(); e.preventDefault(); }
});
$('again').addEventListener('click', (e) => { e.stopPropagation(); restart(); });

let best = Number(localStorage.getItem('kei.best') || 0);

function restart() {
  game.reset();
  $('over').hidden = true;
  $('hint').classList.remove('hide');
}

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  // 傾き→左右の操作量(-1..1)
  const t = sensor.tilt;
  const steer = Math.max(-1, Math.min(1, t.x / CONFIG.tiltRange));

  game.step(dt, steer);
  game.render();

  const sun = Math.floor(game.dist / 30);      // 30px = 1すん
  $('dist').textContent = sun;
  $('dot').className = 'dot ' + (sensor.usingSim ? 'sim' : sensor.connected ? 'ok' : '');
  if (game.dist > 260) $('hint').classList.add('hide');

  // 表示は game.over と常に同期させる(古い記録が残らないように)
  const overEl = $('over');
  if (game.over && overEl.hidden) {
    if (sun > best) { best = sun; localStorage.setItem('kei.best', String(best)); }
    $('finalDist').textContent = sun;
    $('best').textContent = `（最長 ${best}）`;
    overEl.hidden = false;
  } else if (!game.over && !overEl.hidden) {
    overEl.hidden = true;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
