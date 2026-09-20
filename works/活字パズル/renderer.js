// ============================================================
//  renderer.js — カメラ映像へのオーバーレイ描画
//  活字を雑に組むと印圧が揃わずインクがにじむ、という活版の見え方を、
//  テンプレとのずれ（template.js が出す amount）に写す。
//    にじみ 0 … くっきりした1枚
//    にじみ 1 … ぼけて、ずれた方向へ版が重なる
// ============================================================

import { GAME_CONFIG } from './config.js';

export class Renderer {
  #ctx;
  #ink = '#ffffff';
  #halo = '#000000';

  constructor(canvas) {
    this.canvas = canvas;
    // 毎フレーム getImageData で読み出すので、その前提を伝えておく
    this.#ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.syncTheme();
  }

  /** 墨と、その背後に敷く地の色を sumi トークンから取り直す（テーマ切替時に呼ぶ） */
  syncTheme() {
    const style = getComputedStyle(document.documentElement);
    const ink = style.getPropertyValue('--color-accent-strong').trim();
    const halo = style.getPropertyValue('--color-background').trim();
    if (ink) this.#ink = ink;
    if (halo) this.#halo = halo;
  }

  /** 映像を等倍で背景に描く。canvas の大きさも映像に合わせる */
  drawVideo(video, width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.#ctx.drawImage(video, 0, 0, width, height);
  }

  /** いま描いてあるフレームを検出器へ渡すために読み出す */
  readFrame(width, height) {
    return this.#ctx.getImageData(0, 0, width, height);
  }

  /** 理想の組版を薄い案内線として敷く（ベースラインと各スロット） */
  drawTemplate(template) {
    if (!template || !GAME_CONFIG.showTemplate) return;
    const ctx = this.#ctx;
    const half = template.size / 2;

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = this.#ink;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);

    const first = template.slots[0];
    const last = template.slots[template.slots.length - 1];
    ctx.beginPath();
    ctx.moveTo(first.x - half, template.baselineY);
    ctx.lineTo(last.x + half, template.baselineY);
    ctx.stroke();

    ctx.setLineDash([]);
    for (const slot of template.slots) {
      ctx.strokeRect(slot.x - half, slot.y - half, template.size, template.size);
    }
    ctx.restore();
  }

  /**
   * 活字を、にじみ量に応じた刷り上がりで描く。
   * @param {Array} markers    左→右に並べ替え済み
   * @param {Array} devs       markers と同じ並びのずれ（template.js の deviations）
   * @param {number} size      ブロックの見かけの大きさ[px]
   */
  drawBlocks(markers, devs, size) {
    markers.forEach((marker, i) => {
      const dev = devs[i];
      this.#drawOutline(marker, dev.amount);
      this.#drawGlyph(marker, dev, size);
    });
  }

  /** ブロックの枠。にじむほど薄く（版そのものが曖昧になる） */
  #drawOutline(marker, amount) {
    const ctx = this.#ctx;
    const c = marker.corners;
    ctx.save();
    ctx.globalAlpha = 0.5 - 0.3 * amount;
    ctx.strokeStyle = this.#ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c[0], c[1]);
    for (let j = 1; j < 4; j++) ctx.lineTo(c[j * 2], c[j * 2 + 1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /** 文字本体。版ズレの重ね刷り → 本体、の順に描く */
  #drawGlyph(marker, dev, size) {
    const ctx = this.#ctx;
    const { bleed } = GAME_CONFIG;
    const fontPx = Math.round(size * 0.8);

    ctx.save();
    ctx.translate(marker.cx, marker.cy);
    ctx.rotate(marker.angleRad);
    ctx.font = `bold ${fontPx}px "Hiragino Mincho ProN", "Hiragino Mincho Pro", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.#ink;

    // 版ズレ：ずれた方向へ、薄く何枚も重ねて刷る。
    // 方向はテンプレからの逃げ方向そのものなので、どちらへ外したかが絵に出る。
    if (dev.amount > 0.01) {
      const dir = Math.hypot(dev.dx, dev.dy) || 1;
      const ux = dev.dx / dir;
      const uy = dev.dy / dir;
      const spread = bleed.ghostSpread * dev.amount;
      ctx.shadowColor = this.#ink;
      ctx.shadowBlur = bleed.maxBlur * dev.amount;

      for (let g = 1; g <= bleed.ghosts; g++) {
        const t = g / bleed.ghosts;
        ctx.globalAlpha = 0.30 * dev.amount * (1 - t * 0.6);
        ctx.fillText(marker.char, ux * spread * t, uy * spread * t);
      }
    }

    // 本体。地の色の縁取りを薄く敷いて、映像の明暗によらず読めるようにする
    ctx.globalAlpha = 1;
    ctx.shadowColor = this.#halo;
    ctx.shadowBlur = 6;
    ctx.fillText(marker.char, 0, 0);
    ctx.restore();
  }
}
