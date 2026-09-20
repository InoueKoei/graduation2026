// 傾きの供給係。experiments/Sumi/js/sensor.js の SensorFeed を USB 専用に削ったもの。
//
// あちらは 有線(Web Serial) > WiFi(HTTPポーリング) > マウス の 3 段だったが、
// この制作は USB でつなぐと決めたので WiFi の段を落としてある。
// マウスのフォールバックは残す。センサが無くても体験を確認でき、
// 展示前の調整でも要るため。

import { CONFIG } from './config.js';
import { serial } from './serial.js';

export class SensorFeed {
  constructor() {
    this.ax = 0;
    this.ay = 0;
    this.az = 1;
    this.connected = false;
    this.mpuOk = false;
    // 実機側で決めた「傾きの効き」。本体の画面で増減できる（firmware 参照）
    this.gain = 1;

    // マウス擬似傾き（画面中心からのずれ。-1〜1）
    this.mouse = { x: 0, y: 0 };

    // なまし済みの出力
    this.tilt = { x: 0, y: 0 };
  }

  /** 生の加速度を CONFIG の向き合わせに通す。実機ではここを必ず調整することになる。 */
  _mapped() {
    let x = this.ax;
    let y = this.ay;
    if (CONFIG.swapXY) [x, y] = [y, x];
    if (CONFIG.invertX) x = -x;
    if (CONFIG.invertY) y = -y;
    return { x, y };
  }

  get usingSim() { return !this.connected || !this.mpuOk; }

  /** 毎フレーム呼ぶ。 */
  update(dt) {
    if (serial.active && serial.latest && typeof serial.latest.ax === 'number') {
      const d = serial.latest;
      this.ax = d.ax;
      this.ay = d.ay;
      this.az = d.az ?? 1;
      this.mpuOk = d.mpu !== false;
      // 実機が感度を持っていればそれに従う。古いファームなら 1 のまま
      this.gain = typeof d.gain === 'number' && d.gain > 0 ? d.gain : 1;
      this.connected = true;
    } else {
      this.connected = false;
      this.mpuOk = false;
    }

    let target;
    if (this.usingSim) {
      target = { x: this.mouse.x * CONFIG.mouseTiltGain, y: this.mouse.y * CONFIG.mouseTiltGain };
    } else {
      // 感度は傾きベクトルに掛ける。こうすると見た目の傾き（view.js）と
      // 玉にかかる力が同じ値から出たままになり、二つがズレない
      const m = this._mapped();
      target = { x: m.x * this.gain, y: m.y * this.gain };
    }

    // 死帯。置いたままなのに勝手に転がり出すのを防ぐ
    const mag = Math.hypot(target.x, target.y);
    if (mag < CONFIG.tiltDeadzone) target = { x: 0, y: 0 };

    // 指数なまし（フレームレート非依存）
    const k = 1 - Math.exp(-CONFIG.tiltEase * dt);
    this.tilt.x += (target.x - this.tilt.x) * k;
    this.tilt.y += (target.y - this.tilt.y) * k;
  }

  /** 揺れ: |a| の 1g からのズレ。今は使っていないが、実機の生存確認に便利なので残す。 */
  get shake() {
    if (this.usingSim) return 0;
    return Math.abs(Math.hypot(this.ax, this.ay, this.az) - 1);
  }
}
