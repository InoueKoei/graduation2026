// ============================================================
//  renderer.js — canvas への描画
//  カメラ映像を鏡像で敷き、その上に「いま選んでいる字」を薄く大きく重ねる。
//  字の大きさは顔の近さで決まる。近づくほど大きい。
//
//  字は縦の短冊に切り、心拍の位相を使って一本ずつ上下にずらす。
//  ずれは短冊をまたいで左から右へ進む波で、脈が来るたびに振幅がふくらむ。
//  拍の合間にはほぼ揃い、拍の瞬間にいちばん割れる。
// ============================================================

import { PROXIMITY, GLYPH } from './config.js';

const TAU = Math.PI * 2;
const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * 顔の近さ → 字の大きさ[px]。
 * far〜near の外側は頭打ちにする（画面外まで太らせない）。
 * @param {number} proximity analyzeFace が返す proximity（目尻の間隔）
 */
export function charSizeFor(proximity, config = PROXIMITY) {
  const t = clamp01((proximity - config.far) / (config.near - config.far));
  return config.minPx + (config.maxPx - config.minPx) * t;
}

export class Renderer {
  #ctx;
  #ink = '#ffffff';
  #halo = '#000000';
  #srcW = 0;
  #srcH = 0;

  // 字は一度オフスクリーンに描いてから短冊で切り出す。
  // 同じ字・同じ大きさのあいだは描き直さない（毎フレーム fillText しない）。
  #glyph = document.createElement('canvas');
  #glyphCtx;
  #glyphKey = '';
  // 記録用の焼き付け先。画面とは別に持つ（画面の canvas を汚さない）
  #record = document.createElement('canvas');
  #recordCtx;
  #cfg;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} stageEl
   * @param {object} glyphConfig 字の見え方。既定は config.js の GLYPH。
   *   値を差し替えて見え方を詰めたいとき（_preview-glyph.html）だけ渡す。
   */
  constructor(canvas, stageEl, glyphConfig = GLYPH) {
    this.canvas = canvas;
    this.stage = stageEl;
    this.#cfg = glyphConfig;
    this.#ctx = canvas.getContext('2d');
    this.#glyphCtx = this.#glyph.getContext('2d');
    this.#recordCtx = this.#record.getContext('2d');
    this.syncTheme();
  }

  /** 墨と地の色を sumi トークンから取り直す（テーマ切替時に呼ぶ） */
  syncTheme() {
    const style = getComputedStyle(document.documentElement);
    const ink = style.getPropertyValue('--color-accent-strong').trim();
    const halo = style.getPropertyValue('--color-background').trim();
    if (ink) this.#ink = ink;
    if (halo) this.#halo = halo;
    this.#glyphKey = ''; // 色が変わったので字も刷り直す
  }

  /**
   * 実映像の解像度にキャンバスと表示比を追従させる。
   * 高さの上限は CSS 側（--stage-max-h）で決め、幅はこの比から逆算される。
   * ＝切り抜きも余白もなしに、iPad 縦置きでも縦に伸びすぎない。
   */
  #syncFrameSize(w, h) {
    if (!w || !h || (w === this.#srcW && h === this.#srcH)) return;
    this.#srcW = w;
    this.#srcH = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.stage.style.aspectRatio = `${w} / ${h}`;
    // CSS が「高さ上限 × 比」で幅を決められるよう、数値の比も渡す
    document.documentElement.style.setProperty('--cam-ar', (w / h).toFixed(4));
  }

  /** カメラ映像を左右反転して背景に描く（等倍・切り抜きなし・歪みなし） */
  drawMirroredFrame(image, fallbackW, fallbackH) {
    this.#syncFrameSize(image.width || fallbackW, image.height || fallbackH);
    const ctx = this.#ctx;
    ctx.save();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.translate(this.canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  /**
   * 字を正方形のオフスクリーンに一度だけ刷る。縁の淡い暈しは焼き込んでおく
   * （短冊ごとに shadow を掛けると 16 回ぶんの影処理になって重い）。
   */
  #renderGlyph(char, box, size) {
    const key = `${char}|${box}|${this.#ink}`;
    if (key === this.#glyphKey) return;
    this.#glyphKey = key;

    const g = this.#glyphCtx;
    this.#glyph.width = box;   // 代入した時点で中身は消える
    this.#glyph.height = box;
    g.font = `bold ${Math.round(size)}px ${this.#cfg.family}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = this.#halo;
    g.shadowBlur = Math.round(size * this.#cfg.haloRatio);
    g.fillStyle = this.#ink;
    g.fillText(char, box / 2, box / 2);
  }

  /**
   * 短冊に切った字を、指定の中心へ描く。
   * **画面にも記録にも、この同じ手で描く**（記録が画面と食い違わないように）。
   */
  #paintSlices(ctx, char, size, heart, alpha, cx, cy) {
    const cfg = this.#cfg;
    const box = Math.round(size * 1.25); // 字のはみ出しぶんの余白
    this.#renderGlyph(char, box, size);

    const n = cfg.slices;
    // 脈の山でいちばん割れ、谷では pulseFloor ぶんだけ残す
    const swell = cfg.pulseFloor + (1 - cfg.pulseFloor) * clamp01(heart?.pulse ?? 0);
    const amp = size * cfg.shiftRatio * swell;
    const phase = heart?.phase ?? 0;
    const x0 = Math.round(cx - box / 2);
    const y0 = Math.round(cy - box / 2);

    ctx.save();
    ctx.globalAlpha = alpha;
    for (let i = 0; i < n; i++) {
      // 切れ目を丸めて隣と突き合わせる（重ねないので薄い色が濃くならない）
      const sx = Math.round((i * box) / n);
      const sw = Math.round(((i + 1) * box) / n) - sx;
      if (sw <= 0) continue;
      const dy = Math.round(Math.sin(phase - (i / n) * TAU * cfg.waveTurns) * amp);
      ctx.drawImage(this.#glyph, sx, 0, sw, box, x0 + sx, y0 + dy, sw, box);
    }
    ctx.restore();
  }

  /**
   * いま選んでいる字を中央に重ねる。
   * 映像は canvas の中で鏡像にしてあるので、ここは反転を掛けずに素直に描けばよい。
   * @param {string} char
   * @param {number} proximity 顔の近さ
   * @param {number} progress  確定までの進み具合 0〜1（濃さに写す）
   * @param {{phase:number, pulse:number}} heart 心拍（heartbeat.js の sample）
   */
  drawCurrentChar(char, proximity, progress, heart) {
    if (!char) return;
    const cfg = this.#cfg;
    // 薄く重ねる。保持するほど濃くなる＝確定が近いことが字そのものに出る
    const alpha = cfg.alphaMin + (cfg.alphaMax - cfg.alphaMin) * clamp01(progress);
    this.#paintSlices(this.#ctx, char, charSizeFor(proximity), heart, alpha,
      this.canvas.width / 2, this.canvas.height / 2);
  }

  /**
   * **確定した瞬間の字形**をそのまま小さく焼き付けて data URL にする。
   * 画面と同じ位相・同じ振幅で描くので、記録に残るのはその拍の字そのもの。
   * 画面と同じ画角に収めるため、倍率だけ掛けて中身の計算は変えない。
   *
   * 地の色は焼き込む。あとでテーマを切り替えても、記録は撮った時のまま残る。
   * @param {number} width 出力の横幅[px]
   * @returns {string} PNG の data URL
   */
  captureGlyph(char, proximity, heart, width) {
    const scale = width / this.canvas.width;
    const height = Math.max(1, Math.round(this.canvas.height * scale));
    if (this.#record.width !== width || this.#record.height !== height) {
      this.#record.width = width;
      this.#record.height = height;
    }
    const ctx = this.#recordCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.#halo;
    ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale);
    this.#paintSlices(ctx, char, charSizeFor(proximity), heart, this.#cfg.recordAlpha,
      this.canvas.width / 2, this.canvas.height / 2);
    return this.#record.toDataURL('image/png');
  }
}
