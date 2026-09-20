// ============================================================
//  heartbeat.js — 心拍の代役（センサ無しで動かすための信号）
//
//  実センサが無いので、人の心拍の範囲でそれらしく揺れる信号を自前で作る。
//    ・bpm  … 呼吸性の揺れ（RSA）＋ ゆっくりした漂い ＋ 拍ごとの細かいゆらぎ
//    ・phase … bpm を積分して進める。bpm が上がれば拍の間隔も詰まる
//    ・pulse … 脈波（PPG）に似せた包絡。収縮期の立ち上がりと重複隆起を持つ
//
//  後で実センサ（PPG / HRV バンド等）に差し替えるときは、
//  sample() が返す { bpm, phase, pulse, beat } の形だけ合わせればよい。
//  位相を使う側（renderer）はこのクラスの中身を知らない。
// ============================================================

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 1拍ぶんの脈波の形。位相 0〜TAU を 0〜1 の高さに写す。
 * 収縮期の鋭いピークと、少し遅れて来る重複隆起（dicrotic notch の後の山）。
 * 前後の拍ぶんも足しているのは、位相が一周する境目で段差を作らないため。
 */
function pulseAt(phase) {
  const t = phase / TAU;
  const bell = (x, mu, s) => Math.exp(-(((x - mu) / s) ** 2));
  const beat = (x) => bell(x, 0.16, 0.085) + 0.42 * bell(x, 0.40, 0.12);
  return Math.min(1, beat(t) + beat(t + 1) + beat(t - 1));
}

export class HeartSim {
  #cfg;
  #t = 0;          // 経過秒
  #phase = 0;      // 1拍の中の位置 0〜TAU
  #last = null;    // 前フレームの時刻[ms]
  #jitter = 0;     // 鈍らせたランダムウォーク[bpm]
  #bpm;

  constructor(cfg) {
    this.#cfg = cfg;
    this.#bpm = cfg.baseBpm;
  }

  /**
   * フレームごとに1回呼ぶ。
   * @param {number} nowMs performance.now()
   * @returns {{bpm:number, phase:number, pulse:number, beat:boolean}}
   */
  sample(nowMs) {
    const c = this.#cfg;
    // タブが裏に回って戻ったときに位相が飛ばないよう dt に上限を置く
    const dt = this.#last === null ? 0 : clamp((nowMs - this.#last) / 1000, 0, 0.1);
    this.#last = nowMs;
    this.#t += dt;

    // 呼吸に同期した速さの揺れ（呼吸性洞性不整脈）。吸うと速く、吐くと遅い
    const resp = Math.sin(TAU * c.respRateHz * this.#t) * c.respAmpBpm;
    // 数十秒スケールのゆっくりした漂い
    const drift = Math.sin(TAU * c.wanderHz * this.#t + 1.7) * c.wanderAmpBpm;
    // 拍ごとの細かいゆらぎ。ランダムウォークを指数で引き戻して暴れさせない
    this.#jitter += (Math.random() - 0.5) * c.jitterBpm * dt * 6;
    this.#jitter *= Math.exp(-dt / c.jitterDecaySec);

    const bpm = clamp(c.baseBpm + resp + drift + this.#jitter, c.bpmRange[0], c.bpmRange[1]);
    this.#bpm = bpm;

    // 位相は「いまの bpm」で進める。一周したらその瞬間が拍
    const prev = this.#phase;
    this.#phase = (this.#phase + TAU * (bpm / 60) * dt) % TAU;

    return { bpm, phase: this.#phase, pulse: pulseAt(this.#phase), beat: this.#phase < prev };
  }
}
