import { CONFIG } from './config.js';
import { SensorFeed } from './sensor.js';
import { Kingyo } from './game.js';

const $ = (id) => document.getElementById(id);

const sensor = new SensorFeed();
sensor.start();
const game = new Kingyo($('pond'));
window.__kingyo = { sensor, game };

// 持ち上げ入力
//   センサー: 上へ素早く振ると すくい上げ / 下へ振ると 沈める
//   代替:     スペース or 押しっぱなし
let lifting = false;
let manualLift = false;      // キー/クリックによる保持
let liftTimer = 0;           // 振り上げてからの経過(自然に沈む)
let jerkCool = 0;

addEventListener('keydown', (e) => {
  if (e.code === 'Space') { manualLift = true; e.preventDefault(); }
});
addEventListener('keyup', (e) => { if (e.code === 'Space') manualLift = false; });
addEventListener('pointerdown', (e) => { if (e.target.id !== 'again') manualLift = true; });
addEventListener('pointerup', () => { manualLift = false; });

// マウス代替(センサー未接続時): カーソル位置が傾き
addEventListener('pointermove', (e) => {
  const cx = innerWidth / 2, cy = innerHeight / 2;
  const s = Math.min(innerWidth, innerHeight) / 2;
  sensor.simTilt.x = Math.max(-1, Math.min(1, (e.clientX - cx) / s)) * CONFIG.tiltRange;
  sensor.simTilt.y = Math.max(-1, Math.min(1, (e.clientY - cy) / s)) * CONFIG.tiltRange;
});

$('again').addEventListener('click', () => game.reset());

// ポイ残数の表示を作る
function renderPoiLeft() {
  const el = $('poiLeft');
  if (el.childElementCount !== CONFIG.poiCount) {
    el.innerHTML = '';
    for (let i = 0; i < CONFIG.poiCount; i++) el.appendChild(document.createElement('span'));
  }
  [...el.children].forEach((s, i) => s.classList.toggle('used', i >= game.poiLeft));
}

const tilt = { x: 0, y: 0 };
let prev = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  // 持ち上げ: 上への振り(jerk)で起こし、下への振り/時間切れで沈める
  if (jerkCool > 0) jerkCool -= dt;
  if (!sensor.usingSim && jerkCool <= 0) {
    if (sensor.jerk > CONFIG.jerkUp) {
      lifting = true; liftTimer = 0; jerkCool = CONFIG.jerkCooldown;
    } else if (sensor.jerk < -CONFIG.jerkDown) {
      lifting = false; jerkCool = CONFIG.jerkCooldown;
    }
  }
  if (lifting) {
    liftTimer += dt;
    if (liftTimer > CONFIG.liftHold) lifting = false;   // 自然に沈む
  }
  const lift = lifting || manualLift;

  // 傾き→画面上の目標位置
  const t = sensor.tilt;
  const k = Math.min(1, CONFIG.tiltEase * dt);
  tilt.x += (t.x - tilt.x) * k;
  tilt.y += (t.y - tilt.y) * k;
  const nx = Math.max(-1, Math.min(1, tilt.x / CONFIG.tiltRange));
  const ny = Math.max(-1, Math.min(1, tilt.y / CONFIG.tiltRange));
  const target = {
    x: game.w / 2 + nx * (game.w / 2 - CONFIG.poiRadius),
    y: game.h / 2 + ny * (game.h / 2 - CONFIG.poiRadius),
  };

  game.step(dt, target, lift);
  game.render();

  // HUD
  $('score').textContent = game.score;
  renderPoiLeft();
  const wetBar = $('wetBar');
  const wetPct = Math.round((game.poi.wet * 0.55 + game.poi.tear * 0.45) * 100);
  wetBar.style.width = wetPct + '%';
  wetBar.classList.toggle('hot', game.poi.tear > 0.35);
  const stateEl = $('state');
  const up = game.poi.lift > 0.45;
  stateEl.textContent = up ? '持ち上げ' : '水中';
  stateEl.classList.toggle('up', up);
  $('dot').className = 'dot ' + (sensor.usingSim ? 'sim' : sensor.connected ? 'ok' : '');

  const msgEl = $('msg');
  msgEl.textContent = game.msg;
  msgEl.classList.toggle('show', game.msgT > 0);

  if (game.score > 0 || game.time > 10) $('hint').classList.add('hide');

  const overEl = $('over');
  if (game.over && overEl.hidden) {
    const won = game.fish.every(f => f.scored);
    $('overTitle').textContent = won ? 'ぜんぶすくった' : 'ポイぎれ';
    $('finalScore').textContent = game.score;
    $('finalTime').textContent = game.time.toFixed(0);
    overEl.hidden = false;
  } else if (!game.over && !overEl.hidden) {
    overEl.hidden = true;
    $('hint').classList.remove('hide');
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
