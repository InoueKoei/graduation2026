// ============================================================
//  renderer.js — canvas への描画だけを引き受ける
//  一筆書きは「時間のブレンド」として描く：
//  0.1 秒ごとの鍵フレームで字形を取り、隣り合う形の間を
//  Illustrator のブレンドツールのように補間して重ねる。
//  古い形ほど薄く細い。
// ============================================================

import { APP_CONFIG } from './config.js';
import { resolvePoint } from './pose-matcher.js';

export class Renderer {
  #ctx;
  #ink = '#000000';

  constructor(canvas) {
    this.canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.syncTheme();
  }

  /** 墨の色を sumi トークンから取り直す（テーマ切替時に呼ぶ） */
  syncTheme() {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent-strong').trim();
    if (value) this.#ink = value;
  }

  clear() {
    this.#ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * 基準の高さに対する縮尺。太さや点の大きさをこれで補正すると、
   * カメラの解像度が変わっても線の見え方が変わらない。
   */
  #scale() {
    return this.canvas.height / APP_CONFIG.referenceHeight;
  }

  /** 検出した部位を点で示す（ポーズを取るときのガイド） */
  drawJoints(pixelPoints) {
    const ctx = this.#ctx;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = this.#ink;
    for (const p of Object.values(pixelPoints)) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, APP_CONFIG.jointRadius * this.#scale(), 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 鍵フレーム列をブレンドして一筆書きを描く。
   * 描く形の数は (鍵フレーム数 - 1) × (steps + 1) + 1。
   * @param {string[]} lines       "LH-RH" などの記述
   * @param {Array<Object>} frames 鍵フレーム（古い → 新しい）
   * @param {Object} blend         { steps, width, tailOpacity, tailWidth }
   * @returns {number} 実際に描いた形の数（負荷の目安として返す）
   */
  drawKanaBlend(lines, frames, blend) {
    if (!frames.length) return 0;

    // 各鍵フレームを「線ごとの節点列」へ解いておく（補間はこの座標の間で行う）
    const shapes = frames.map((points) => resolveShape(lines, points));
    const steps = Math.max(0, Math.round(blend.steps));
    const divisions = Math.max(1, (shapes.length - 1) * (steps + 1));

    const scale = this.#scale();
    let drawn = 0;
    for (let d = 0; d <= divisions; d++) {
      const progress = d / divisions;               // 0 = 最も古い形, 1 = いまの形
      const position = progress * (shapes.length - 1);
      const index = Math.min(Math.floor(position), shapes.length - 2);
      const shape = shapes.length === 1
        ? shapes[0]
        : lerpShape(shapes[index], shapes[index + 1], position - index);

      this.#strokeShape(shape, {
        alpha: blend.tailOpacity + (1 - blend.tailOpacity) * progress,
        width: blend.width * scale * (blend.tailWidth + (1 - blend.tailWidth) * progress),
      });
      drawn++;
    }
    return drawn;
  }

  #strokeShape(shape, { alpha, width }) {
    const ctx = this.#ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = this.#ink;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const nodes of shape) {
      if (nodes.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(nodes[0].x, nodes[0].y);
      for (let i = 1; i < nodes.length; i++) ctx.lineTo(nodes[i].x, nodes[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 線データが無い字は、鏡像を打ち消して中央に大きく表示する */
  drawBigChar(letter) {
    const ctx = this.#ctx;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = this.#ink;
    // 解像度に依らず同じ見え方になるよう、映像の高さに対する比で決める
    ctx.font = `bold ${Math.round(this.canvas.height * APP_CONFIG.bigCharRatio)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    ctx.scale(-1, 1); // canvas は CSS で左右反転しているので文字だけ元に戻す
    ctx.fillText(letter, 0, 0);
    ctx.restore();
  }
}

/** 1 ポーズ分の字形＝線ごとの節点列。解決できない節点は落とす */
function resolveShape(lines, points) {
  return lines.map((lineStr) =>
    lineStr.split('-')
      .map((token) => resolvePoint(token, points))
      .filter(Boolean));
}

/** 2 つの字形の間を線形補間する（ブレンドの中間形） */
function lerpShape(a, b, u) {
  return a.map((nodes, i) => {
    const other = b[i] ?? nodes;
    const count = Math.min(nodes.length, other.length);
    const out = [];
    for (let n = 0; n < count; n++) {
      out.push({
        x: nodes[n].x + (other[n].x - nodes[n].x) * u,
        y: nodes[n].y + (other[n].y - nodes[n].y) * u,
      });
    }
    return out;
  });
}
