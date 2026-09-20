// 編集モード。文字を置く・掴んで動かす・消す。
//
// ★ 入力した文字列は 1 文字ずつ独立した Piece に分解して並べる。
//   まとめて 1 オブジェクトにすると、文字単位でドラッグして接触させられない。
//   コースを作る操作そのものが「字を寄せる」ことなので、ここは 1 文字単位が要る。

import { CONFIG } from './config.js';
import { Piece } from './course.js';

const GRAB_SLACK = 12; // 輪郭線からこの距離までは掴めることにする(px)

export class Editor {
  constructor({ canvas, course, onChange, getView }) {
    this.canvas = canvas;
    this.course = course;
    this.onChange = onChange ?? (() => {});
    // 盤が倒れているので、画面座標のままでは掴めない。毎回いまの射影を貰って戻す
    this.getView = getView ?? (() => null);
    this.selected = null;
    this.enabled = true;
    this._drag = null;

    canvas.addEventListener('pointerdown', (e) => this._onDown(e));
    canvas.addEventListener('pointermove', (e) => this._onMove(e));
    canvas.addEventListener('pointerup', (e) => this._onUp(e));
    canvas.addEventListener('pointercancel', (e) => this._onUp(e));
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this._drag = null;
      this.selected = null;
    }
  }

  /**
   * 文字列を 1 文字ずつの Piece に分解して横に並べる。course には足さない。
   * プレビューと実配置の両方でこれを使う。
   */
  layout(text, font, fontKey, size, cx, cy) {
    if (!font || !text) return [];
    const gap = size * CONFIG.charGap;
    const made = [];

    for (const char of [...text]) {
      const piece = new Piece({ char, font, fontKey, size, x: 0, y: cy });
      if (!piece.ok) {
        // 空白や字形の無い文字。字送りだけ進める
        made.push({ piece: null, width: size * 0.4 });
        continue;
      }
      const b = piece.localBBox;
      made.push({ piece, width: b.maxX - b.minX });
    }
    if (made.length === 0) return [];

    const total = made.reduce((s, m) => s + m.width, 0) + gap * (made.length - 1);
    let pen = cx - total / 2;
    const out = [];
    for (const m of made) {
      if (m.piece) {
        m.piece.moveTo(pen + m.width / 2, cy);
        out.push(m.piece);
      }
      pen += m.width + gap;
    }
    return out;
  }

  /** プレビューで作った Piece をそのままコースに載せる。 */
  place(pieces) {
    if (!pieces.length) return;
    for (const p of pieces) this.course.add(p);
    this.selected = pieces[pieces.length - 1];
    this.onChange();
  }

  deleteSelected() {
    if (!this.selected) return;
    this.course.remove(this.selected);
    this.selected = null;
    this.onChange();
  }

  clear() {
    this.course.clear();
    this.selected = null;
    this.onChange();
  }

  /** いちばん手前で、その点を掴んでいる文字。 */
  pick(x, y) {
    const list = this.course.pieces;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].ok && list[i].hit(x, y, GRAB_SLACK)) return list[i];
    }
    // 厳密に当たらなかったら bbox で拾う（細い字を掴みそこねないように）
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].ok && list[i].bboxHit(x, y)) return list[i];
    }
    return null;
  }

  /** 画面のポインタ位置 → 盤面座標。 */
  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return this.toBoard(e.clientX - rect.left, e.clientY - rect.top);
  }

  toBoard(sx, sy) {
    const v = this.getView();
    if (!v) return { x: sx, y: sy };
    const [x, y] = v.unproject(sx, sy);
    return { x, y };
  }

  _onDown(e) {
    if (!this.enabled) return;
    const { x, y } = this._pos(e);
    const piece = this.pick(x, y);
    this.selected = piece;
    if (piece) {
      // 掴んだ文字をいちばん手前に持ってくる
      const i = this.course.pieces.indexOf(piece);
      if (i >= 0) {
        this.course.pieces.splice(i, 1);
        this.course.pieces.push(piece);
      }
      this._drag = { piece, dx: piece.x - x, dy: piece.y - y };
      this.canvas.setPointerCapture(e.pointerId);
    }
    this.onChange();
  }

  _onMove(e) {
    if (!this.enabled || !this._drag) return;
    const { x, y } = this._pos(e);
    this._drag.piece.moveTo(x + this._drag.dx, y + this._drag.dy);
    // 動かすたびに合成し直す。接触した瞬間に線がつながって見えるのが要点。
    // 4文字で 6ms 程度なので毎フレーム回して問題ない（_check-geom で実測）
    this.course.invalidate();
    this.onChange();
  }

  _onUp(e) {
    if (!this._drag) return;
    this._drag = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    this.onChange();
  }
}
