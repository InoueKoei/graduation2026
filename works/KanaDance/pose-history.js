// ============================================================
//  pose-history.js — 直近数秒のポーズを溜め、等間隔の鍵フレームを取り出す
//  ブレンド描画の材料。カメラの fps に関わらず「0.1 秒ごと」を得るため、
//  記録フレームの間は線形補間してサンプリングする。
// ============================================================

export class PoseHistory {
  #frames = [];
  #bufferMs;

  /** @param {number} bufferMs 保持する最大時間（さかのぼれる上限） */
  constructor(bufferMs) {
    this.#bufferMs = bufferMs;
  }

  /**
   * 1 フレーム分の部位座標を記録する。
   * @param {number} timeMs  performance.now() 等の時刻
   * @param {Object} points  部位名 → {x,y}（ピクセル）
   */
  push(timeMs, points) {
    const last = this.#frames.at(-1);
    // 検出が長く途切れたら捨てる（復帰時の飛びを 1 区間として補間しないため）
    if (last && timeMs - last.t > 500) this.clear();

    this.#frames.push({ t: timeMs, points });

    const limit = timeMs - this.#bufferMs;
    while (this.#frames.length > 1 && this.#frames[0].t < limit) this.#frames.shift();
  }

  clear() {
    this.#frames.length = 0;
  }

  /** 実際に溜まっている時間（ms） */
  get spanMs() {
    if (this.#frames.length < 2) return 0;
    return this.#frames.at(-1).t - this.#frames[0].t;
  }

  /**
   * 直近 windowMs を intervalMs ごとにサンプルした鍵フレーム列を返す（古い → 新しい）。
   * 履歴が windowMs に満たないうちは、溜まっているぶんだけ返す。
   * @param {number} windowMs     さかのぼる時間
   * @param {number} intervalMs   取得間隔
   * @param {number} maxKeyframes 返す最大数（重くなりすぎない保険）
   * @returns {Array<Object>} 部位名 → {x,y} の配列
   */
  keyframes(windowMs, intervalMs, maxKeyframes = Infinity) {
    const newest = this.#frames.at(-1);
    if (!newest) return [];

    const oldest = this.#frames[0].t;
    const span = Math.min(windowMs, newest.t - oldest);
    let count = Math.floor(span / intervalMs) + 1;
    count = Math.max(1, Math.min(count, maxKeyframes));
    // 上限に当たったら、窓は保ったまま間隔を広げて間引く
    const step = count > 1 ? span / (count - 1) : 0;

    const out = [];
    for (let i = count - 1; i >= 0; i--) out.push(this.#sampleAt(newest.t - step * i));
    return out;
  }

  /** 指定時刻の姿勢を、前後の記録フレームから線形補間して求める */
  #sampleAt(timeMs) {
    const frames = this.#frames;
    if (frames.length === 1 || timeMs <= frames[0].t) return frames[0].points;
    if (timeMs >= frames.at(-1).t) return frames.at(-1).points;

    let i = 1;
    while (i < frames.length - 1 && frames[i].t < timeMs) i++;
    const a = frames[i - 1];
    const b = frames[i];
    const u = b.t === a.t ? 0 : (timeMs - a.t) / (b.t - a.t);

    const points = {};
    for (const name in b.points) {
      const pa = a.points[name];
      const pb = b.points[name];
      points[name] = pa
        ? { x: pa.x + (pb.x - pa.x) * u, y: pa.y + (pb.y - pa.y) * u }
        : pb;
    }
    return points;
  }
}
