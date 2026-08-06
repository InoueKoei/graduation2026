import { CONFIG } from './config.js';
import { SensorFeed } from './sensor.js';
import { Horizon, Plumb, Ring, Field } from './views.js';

const sensor = new SensorFeed();
sensor.start();
window.__motion = { sensor };

// 4つのビューを同じデータで駆動する
const views = [];
for (const cell of document.querySelectorAll('.cell')) {
  const kind = cell.dataset.view;
  const V = { horizon: Horizon, plumb: Plumb, ring: Ring, field: Field }[kind];
  views.push(new V(cell));
}

// フォールバック: マウス位置が傾きになる
addEventListener('pointermove', (e) => {
  const cx = innerWidth / 2, cy = innerHeight / 2;
  const s = Math.min(innerWidth, innerHeight) / 2;
  sensor.simTilt.x = Math.max(-1, Math.min(1, (e.clientX - cx) / s));
  sensor.simTilt.y = Math.max(-1, Math.min(1, (e.clientY - cy) / s));
});

// なめらかな現在値(全ビュー共有の state)
const state = { tilt: { x: 0, y: 0 }, roll: 0, mag: 0, shake: 0, t: 0 };

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  state.t = now / 1000;

  // 傾き: なめらかに追従
  const target = sensor.tilt;
  const k = Math.min(1, CONFIG.tiltEase * dt);
  state.tilt.x += (target.x - state.tilt.x) * k;
  state.tilt.y += (target.y - state.tilt.y) * k;
  state.mag = Math.min(1, Math.hypot(state.tilt.x, state.tilt.y));
  if (state.mag > 0.02) state.roll = Math.atan2(state.tilt.y, state.tilt.x);

  // 揺れ: 速く立ち上がり、ゆっくり冷める(余韻)
  const raw = Math.min(1, sensor.rawShake * 2.5);
  const kk = raw > state.shake ? CONFIG.shakeAttack : CONFIG.shakeDecay;
  state.shake += (raw - state.shake) * Math.min(1, kk * dt);

  for (const v of views) v.draw(state, dt);

  const dot = document.getElementById('dot');
  dot.className = 'dot ' + (sensor.usingSim ? 'sim' : sensor.connected ? 'ok' : '');

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
