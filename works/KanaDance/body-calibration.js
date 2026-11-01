// ============================================================
//  body-calibration.js — 体型合わせの進行
//  「正面を向いて、イのポーズで静止」を見届けて、体節の長さを測る。
//
//    ready   … ポーズを作ってもらう時間
//    holding … 静止している間、毎フレーム長さを溜める。
//              動いた・横を向いた・手足が映っていない ときは溜め直し
//    done    … 長さが出た
//
//  ここで測るのはポーズの形ではなく体節の長さなので、
//  イを多少崩して作っても結果はほとんど狂わない。
// ============================================================

import { segmentLengths, summarizeLengths } from './pose-matcher.js';

/** 静止の判定に使う、体の端のほうの部位 */
const WATCH = ['head', 'l_elbow', 'r_elbow', 'l_hand', 'r_hand', 'l_knee', 'r_knee', 'l_leg', 'r_leg'];

export class BodyCalibration {
  #config;
  #phase = 'idle';
  #phaseStart = 0;
  #anchor = null;
  #samples = [];
  #reason = '';

  constructor(config) {
    this.#config = config;
  }

  get active() { return this.#phase === 'ready' || this.#phase === 'holding'; }
  get phase() { return this.#phase; }
  /** 溜め直しになった理由（画面の案内に出す） */
  get reason() { return this.#reason; }

  start(nowMs) {
    this.#enter('ready', nowMs);
  }

  cancel() {
    this.#phase = 'idle';
    this.#samples = [];
  }

  #enter(phase, nowMs) {
    this.#phase = phase;
    this.#phaseStart = nowMs;
    this.#samples = [];
    this.#anchor = null;
  }

  /** いまの段の進み具合 0〜1 */
  progress(nowMs) {
    if (!this.active) return 0;
    const span = this.#phase === 'ready' ? this.#config.readyMs : this.#config.holdMs;
    return Math.min(1, (nowMs - this.#phaseStart) / span);
  }

  /**
   * 毎フレーム呼ぶ。
   * @param {Object|null} pose 正規化済みの姿勢（身体が見えなければ null）
   * @param {{visible:boolean, facing:boolean}} checks 手足が映っているか・正面か
   * @returns {Object|null} 測り終えた瞬間だけ、体節の長さ（左右別）を返す
   */
  feed(pose, nowMs, checks) {
    if (!this.active) return null;

    if (this.#phase === 'ready') {
      this.#reason = '';
      if (nowMs - this.#phaseStart >= this.#config.readyMs) this.#enter('holding', nowMs);
      return null;
    }

    // 測れる状態かどうか。外れたら溜め直す（中途半端な値を混ぜない）
    const why = !pose ? '身体が映っていません'
      : !checks.visible ? '手の先から足の先まで映るように、少し下がってください'
      : !checks.facing ? '体を正面に向けてください'
      : this.#moved(pose) ? 'そのまま止まって…'
      : '';
    if (why) {
      this.#reason = why;
      this.#phaseStart = nowMs;
      this.#samples = [];
      this.#anchor = pose ? { ...pose } : null;
      return null;
    }

    this.#reason = '';
    this.#samples.push(segmentLengths(pose));
    if (nowMs - this.#phaseStart < this.#config.holdMs) return null;

    this.#phase = 'done';
    return summarizeLengths(this.#samples);
  }

  /** 静止し始めた時点の姿勢から、体の端がどれだけ動いたか */
  #moved(pose) {
    if (!this.#anchor) {
      this.#anchor = { ...pose };
      return false;
    }
    return WATCH.some((k) => pose[k] && this.#anchor[k]
      && Math.hypot(pose[k].x - this.#anchor[k].x, pose[k].y - this.#anchor[k].y) > this.#config.stillTol);
  }
}
