// 描画。線は輪郭だけ、色と太さは固定（仕様として調整不要）。
//
// 座標は「盤面座標」で来る。操作モードでは view が板ごと倒すので、
// 点を打つ前に必ず view.project() を通す（view.js を参照）。

import { CONFIG } from './config.js';

const INK = '#111';
const ACCENT = '#2f6df6';
const PREVIEW = '#c9ccd1';
const BALL = '#e02b34';
const BOARD = '#e6e6e6';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw({ course, ball, mode, selected, preview, view }) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.w, this.h);

    // 板の枠。倒れているのがこれで読み取れる
    if (view.active && CONFIG.view.showBoard) this._board(view);

    // 未配置のプレビュー（入力中の文字。Enter を押すまではまだコースではない）
    if (preview && preview.length) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      for (const piece of preview) strokeShape(ctx, piece.shape, PREVIEW, CONFIG.lineWidth, view);
      ctx.restore();
    }

    // 合成後の輪郭。これが見えている線であり、玉が当たる壁でもある
    strokeRings(ctx, course.walls, INK, CONFIG.lineWidth, view);

    // 編集モードでは選択中の文字だけ色を変えて、どれを掴んでいるかを示す。
    // 合成されていても「もとの 1 文字」の輪郭を上から重ねる。
    if (mode === 'edit' && selected) {
      strokeShape(ctx, selected.shape, ACCENT, CONFIG.lineWidth + 0.8, view);
    }

    if (ball.alive) {
      const [sx, sy] = view.project(ball.x, ball.y);
      // 倒すと奥ほど小さく見える。玉もその場の伸びに合わせる
      const r = Math.max(2, ball.r * view.scaleAt(ball.x, ball.y));
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = BALL;
      ctx.fill();
    }
  }

  /** 板の外周。少し内側に取って、倒したときに画面から出にくくする。 */
  _board(view) {
    const ctx = this.ctx;
    const m = Math.min(this.w, this.h) * 0.045;
    const x0 = m;
    const y0 = m;
    const x1 = this.w - m;
    const y1 = this.h - m;
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    ctx.beginPath();
    corners.forEach(([x, y], i) => {
      const [sx, sy] = view.project(x, y);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.strokeStyle = BOARD;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

function strokeRings(ctx, rings, color, width, view) {
  if (!rings.length) return;
  ctx.beginPath();
  if (view.active) {
    for (const ring of rings) {
      let p = view.project(ring[0][0], ring[0][1]);
      ctx.moveTo(p[0], p[1]);
      for (let i = 1; i < ring.length; i++) {
        p = view.project(ring[i][0], ring[i][1]);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
    }
  } else {
    for (const ring of rings) {
      ctx.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
      ctx.closePath();
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function strokeShape(ctx, shape, color, width, view) {
  const rings = [];
  for (const poly of shape) {
    for (const ring of poly) rings.push(ring);
  }
  strokeRings(ctx, rings, color, width, view);
}
