import { CONFIG } from './config.js';
import { SensorFeed } from './sensor.js';
import { LineChart } from './charts.js';
import { BubbleLevel } from './level.js';

const $ = (id) => document.getElementById(id);

const sensor = new SensorFeed();
sensor.start();
window.__deck = { sensor };

// チャート群(温度と湿度は軸が違うので別チャート / 加速度は同スケールなので1つ)
const chartTemp = new LineChart($('chartTemp'),
  [{ key: 'temp', label: '温度', colorVar: '--series-1' }], { unit: '°C' });
const chartHum = new LineChart($('chartHum'),
  [{ key: 'hum', label: '湿度', colorVar: '--series-2' }], { unit: '%' });
const chartAcc = new LineChart($('chartAcc'), [
  { key: 'ax', label: 'X', colorVar: '--series-1' },
  { key: 'ay', label: 'Y', colorVar: '--series-2' },
  { key: 'az', label: 'Z', colorVar: '--series-3' },
], { unit: 'g', fixedRange: CONFIG.accRange });
const level = new BubbleLevel($('levelHolder'));

// REC
const recBtn = $('recBtn');
recBtn.addEventListener('click', () => {
  if (sensor.recording) {
    const n = sensor.stopRecAndDownload();
    recBtn.classList.remove('on');
    recBtn.textContent = '● REC';
    if (n > 0) recBtn.title = `${n}行を書き出した`;
  } else {
    sensor.startRec();
    recBtn.classList.add('on');
  }
});

const fmt = (v, d = 1) => (v == null ? '--' : v.toFixed(d));

function frame() {
  const d = sensor.latest;
  const mpu = d && d.mpu;

  // タイル
  if (d) {
    const shtOk = d.sht !== false;
    $('tTemp').textContent = shtOk ? fmt(d.temp) : '--';
    $('tHum').textContent = shtOk ? fmt(d.humidity) : '--';
    const mmT = sensor.minmax('temp');
    const mmH = sensor.minmax('hum');
    if (mmT) $('tTempSub').textContent = `min ${mmT[0].toFixed(1)} / max ${mmT[1].toFixed(1)}`;
    if (mmH) $('tHumSub').textContent = `min ${mmH[0].toFixed(1)} / max ${mmH[1].toFixed(1)}`;
    if (mpu) {
      const tiltDeg = Math.atan2(Math.hypot(d.ax, d.ay), Math.abs(d.az)) * 180 / Math.PI;
      $('tTilt').textContent = tiltDeg.toFixed(0);
      $('tTiltSub').textContent = `x ${d.ax.toFixed(2)} / y ${d.ay.toFixed(2)}`;
      const shake = Math.abs(Math.hypot(d.ax, d.ay, d.az) - 1);
      $('tShake').textContent = shake.toFixed(2);
    } else {
      $('tTilt').textContent = '--';
      $('tShake').textContent = '--';
    }
  }

  // ステータスチップ
  $('dot').className = 'dot ' + (sensor.connected ? 'ok' : 'ng');
  $('endpoint').textContent = sensor.connected ? sensor.endpoint : '切断';
  $('latency').textContent = sensor.latencyMs != null ? Math.round(sensor.latencyMs) + 'ms' : '--';
  const rate = sensor.successRate;
  $('rate').textContent = rate != null ? Math.round(rate * 100) + '%' : '--';
  $('shtFlag').textContent = d ? (d.sht !== false ? 'OK' : 'NG') : '--';
  $('mpuFlag').textContent = d ? (mpu ? 'OK' : '--') : '--';
  if (sensor.recording) recBtn.textContent = `■ ${sensor.recRows.length}行`;

  // チャート
  chartTemp.draw(sensor.history);
  chartHum.draw(sensor.history);
  chartAcc.draw(sensor.history);
  level.draw(mpu ? d.ax : null, mpu ? d.ay : null);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
