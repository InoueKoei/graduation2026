import { CONFIG } from './config.js';
import { SensorFeed } from './sensor.js';
import { TypeStyler } from './type.js';
import { VoiceInput } from './voice.js';

const editor = document.getElementById('editor');
const hudStats = document.getElementById('stats');
const dot = document.getElementById('dot');
const simPanel = document.getElementById('simPanel');
const simTemp = document.getElementById('simTemp');
const simHum = document.getElementById('simHum');
const simTempVal = document.getElementById('simTempVal');
const simHumVal = document.getElementById('simHumVal');

const sensor = new SensorFeed();
const styler = new TypeStyler();
sensor.start();

// 書体は config で指定（ローカルフォント可）
editor.style.fontFamily = CONFIG.fontFamily;

// --- 音声入力（キーボード併用） ---
const micBtn = document.getElementById('micBtn');
const voice = new VoiceInput(editor, micBtn, (state) => {
  micBtn.classList.toggle('listening', state === 'listening');
  if (state === 'unsupported') {
    micBtn.classList.add('disabled');
    micBtn.title = 'このブラウザは音声入力非対応(Chrome推奨)';
  }
  if (state === 'denied') {
    micBtn.classList.remove('listening');
    micBtn.title = 'マイクがブロックされてる。アドレスバーの🎤アイコンから許可して';
  }
});
micBtn.addEventListener('pointerdown', (e) => e.preventDefault()); // フォーカスを奪わない
micBtn.addEventListener('click', () => voice.toggle());

// 開発用フック (例: __thermo.sensor.simTemp = 35)
window.__thermo = { sensor, styler, voice };

// どこをクリックしても入力にフォーカス
addEventListener('pointerdown', (e) => {
  if (!simPanel.contains(e.target)) editor.focus();
});
editor.focus();

// シミュレーション用スライダ
simTemp.addEventListener('input', () => { sensor.simTemp = parseFloat(simTemp.value); });
simHum.addEventListener('input', () => { sensor.simHum = parseFloat(simHum.value); });

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;

  const { temp, humidity } = sensor.value;
  styler.update(dt, temp, humidity);

  // HUD
  const t = temp != null ? temp.toFixed(1) : '--';
  const h = humidity != null ? humidity.toFixed(1) : '--';
  const w = styler.out.wght ?? '--';
  const b = styler.out.bleed != null ? styler.out.bleed.toFixed(1) : '--';
  hudStats.textContent = `${t}°C ${h}%  →  wght ${w} ・ 滲み ${b}px`;
  dot.className = 'dot ' + (sensor.connected ? 'ok' : sensor.simActive ? 'sim' : 'ng');

  // スライダの表示切替と数値表示
  simPanel.hidden = !sensor.simActive;
  if (sensor.simActive) {
    simTempVal.textContent = sensor.simTemp.toFixed(1) + '°C';
    simHumVal.textContent = sensor.simHum.toFixed(1) + '%';
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
