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
   * @param {Object} blend         { steps, width, tailOpacity, tailWidth, roundness }
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
        roundness: blend.roundness ?? 1,
      });
      drawn++;
    }
    return drawn;
  }

  /**
   * 1つの形を描く。roundness は線の丸み（0〜1）。
   *   1 … 端も角も丸い（canvas の round キャップ・round 結合と同じ）
   *   0 … 端は太さの半分だけ四角く突き出し、折れ目は尖る（マイター）
   * 端の角の半径が丸みに比例して変わる。折れ目は 0.5 を境に丸（以上）と尖り（未満）を切り替える。
   * 端が同じ点で出会う線どうしはつないで1本にする（四角い端が2つ交差して星形になるのを防ぎ、そこを折れ目として描く）。
   * 部品（線分の帯・折れ目・端）は形ごとに1つのパスにまとめて1回で塗るので、
   * 重なったところが二重に濃くならない（向きを揃えてあるので重なりは和集合になる）。
   */
  #strokeShape(shape, { alpha, width, roundness }) {
    const ctx = this.#ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (roundness >= 0.999) {
      // 丸いときは canvas の線そのもの（速い）。全部の線を1つのパスにして1回で引くと、
      // 線どうしが重なるところも二重に濃くならない
      ctx.strokeStyle = this.#ink;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const nodes of shape) {
        if (nodes.length < 2) continue;
        ctx.moveTo(nodes[0].x, nodes[0].y);
        for (let i = 1; i < nodes.length; i++) ctx.lineTo(nodes[i].x, nodes[i].y);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = this.#ink;
      const path = new Path2D();
      for (const pts of joinAtEnds(shape.map(dedupe).filter((p) => p.length >= 2))) {
        path.addPath(outlinePath(pts, width / 2, Math.max(0, roundness)));
      }
      ctx.fill(path, 'nonzero');
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

// ── 丸みを変えられる線の輪郭 ──────────────────────────────────
/** 尖りすぎた折れ目はマイターをやめて面取りにする（canvas の既定 miterLimit と同じ 10） */
const MITER_LIMIT = 10;

/** 同じ位置に続く節点を落とす（長さ 0 の線分は向きが決まらない） */
function dedupe(nodes) {
  const out = [];
  for (const p of nodes) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.01) out.push(p);
  }
  return out;
}

const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.5;

/**
 * 端どうしが同じ点にある線をつないで1本にする（「LH-RH-RL」と「LL-RL」→ LH-RH-RL-LL）。
 * 3本以上が1点で出会うときは、先に見つかった2本だけをつなぎ、残りは端のまま描く。
 */
function joinAtEnds(lines) {
  const out = lines.map((l) => [...l]);
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length && !merged; j++) {
        const a = out[i], b = out[j];
        let joined = null;
        if (near(a[a.length - 1], b[0])) joined = [...a, ...b.slice(1)];
        else if (near(a[a.length - 1], b[b.length - 1])) joined = [...a, ...b.slice(0, -1).reverse()];
        else if (near(a[0], b[b.length - 1])) joined = [...b, ...a.slice(1)];
        else if (near(a[0], b[0])) joined = [...b.slice(1).reverse(), ...a];
        if (joined && !near(joined[0], joined[joined.length - 1])) {
          out.splice(j, 1);
          out[i] = joined;
          merged = true;
        }
      }
    }
  }
  return out;
}

/** 点 a に置き、b の方向を +x に向けた座標系 */
function frameAt(a, b) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return new DOMMatrix().translateSelf(a.x, a.y).rotateSelf(angle * 180 / Math.PI);
}

/** 時計回り（canvas の y 下向き座標で）に並べた多角形をパスに足す */
function addPolygon(path, poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    area += p.x * q.y - q.x * p.y;
  }
  const pts = area < 0 ? [...poly].reverse() : poly; // roundRect・rect と同じ向きに揃える
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  path.closePath();
}

/**
 * 1本の折れ線の輪郭。線分ごとの帯（端は突き出さない）＋折れ目の継ぎ＋両端のキャップ。
 * キャップは太さの半分だけ外へ伸ばした長方形で、外側の2つの角だけを丸める（丸み 1 で半円）。
 */
function outlinePath(pts, half, roundness) {
  const path = new Path2D();
  const r = roundness * half;

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = new Path2D();
    seg.rect(0, -half, Math.hypot(b.x - a.x, b.y - a.y), half * 2);
    path.addPath(seg, frameAt(a, b));
  }

  // 折れ目。丸なら円、尖りなら外側の角を埋める三角／四角（マイター）
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    if (roundness >= 0.5) {
      path.moveTo(p.x + half, p.y);
      path.arc(p.x, p.y, half, 0, Math.PI * 2);
      continue;
    }
    const d1 = unit(pts[i - 1], p), d2 = unit(p, pts[i + 1]);
    const turn = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(turn) < 1e-6) continue; // まっすぐ続いている
    // 外側は曲がる向きの反対側
    const side = turn > 0 ? -1 : 1;
    const n1 = { x: -d1.y * side * half, y: d1.x * side * half };
    const n2 = { x: -d2.y * side * half, y: d2.x * side * half };
    const o1 = { x: p.x + n1.x, y: p.y + n1.y };
    const o2 = { x: p.x + n2.x, y: p.y + n2.y };
    const cos = d1.x * d2.x + d1.y * d2.y;
    const miterLen = half / Math.sqrt(Math.max(1e-6, (1 + cos) / 2)); // 折れ目から先端まで
    if (miterLen / half > MITER_LIMIT) {
      addPolygon(path, [p, o1, o2]);
    } else {
      const bis = { x: n1.x + n2.x, y: n1.y + n2.y };
      const bl = Math.hypot(bis.x, bis.y) || 1;
      const tip = { x: p.x + bis.x / bl * miterLen, y: p.y + bis.y / bl * miterLen };
      addPolygon(path, [p, o1, tip, o2]);
    }
  }

  // 両端のキャップ：端から外へ half だけ伸ばし、外側の角を r で丸める
  const ends = [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]];
  for (const [end, inner] of ends) {
    const cap = new Path2D();
    // 局所座標で +x が外向き（inner → end の向き）
    cap.roundRect(0, -half, half, half * 2, [0, r, r, 0]);
    const m = frameAt(end, { x: end.x * 2 - inner.x, y: end.y * 2 - inner.y });
    path.addPath(cap, m);
  }
  return path;
}

function unit(a, b) {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}
