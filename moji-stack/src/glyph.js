// 書体の読み込みと、1文字 → ベクター輪郭 → 物理ボディ用の頂点群への変換。
//
// 文字は「その場でアウトライン（ベクター）を生成」して扱う。これにより
//   - 既存の Web フォントに依存しない（フォントファイルさえあれば何でも積める）
//   - 将来デスクトップのフォントを ArrayBuffer で渡しても同じ経路で動く
// という設計にしている。
//
// 「か」のように複数のストロークに分かれた字も、1グリフ＝複数の輪郭(contour)として
// まとめて取得し、後段(scene.js)で 1 つの複合ボディ(compound body)にするため、
// 点と他の部分がバラバラに落ちることはない。

import opentype from 'opentype.js';

const CURVE_STEPS = 12; // ベジェ曲線を直線に近似する分割数
const SIMPLIFY_TOLERANCE = 2.4; // 輪郭の間引き許容誤差(px)。凸分割の負荷を抑える
const fontCache = new Map();

/**
 * 書体を読み込む。
 * @param {string|ArrayBuffer} source URL 文字列、またはフォントファイルの ArrayBuffer
 * @returns {Promise<opentype.Font>}
 */
export async function loadFont(source) {
  if (typeof source === 'string') {
    if (fontCache.has(source)) return fontCache.get(source);
    const font = await opentype.load(source);
    fontCache.set(source, font);
    return font;
  }
  // ArrayBuffer（将来のデスクトップフォント読み込み用）
  return opentype.parse(source);
}

/**
 * 1文字分のジオメトリを生成する。
 * @returns {{renderCommands: object[], solids: {x:number,y:number}[][]} | null}
 *   renderCommands: 描画用。元グリフのパス命令(曲線そのまま=単純化なし)を
 *                   重心ぶんだけ平行移動したもの。scene.js が Path2D 化する。
 *   solids:         物理用。穴(カウンター)を除いたシルエット外周を「裏で」単純化した輪郭。
 *   グリフが存在しない / 空白などで実体が無い場合は null
 *
 * 要点は「描画」と「物理」で形状を分けること。
 *  - 描画は元の曲線を一切単純化せずそのまま塗る（書体本来の表情を保つ）。
 *  - 物理は裏側で単純化した外周シルエットだけを使う（凸分割の負荷を抑え、穴に
 *    乗って宙に浮く違和感や輪郭どうしの食い込みを防ぐ）。
 */
export function buildLetterGeometry(font, char, fontSize = 150) {
  const glyph = font.charToGlyph(char);
  // .notdef（豆腐）や実体のないグリフは弾く
  if (!glyph || glyph.index === 0) return null;

  const path = glyph.getPath(0, 0, fontSize);

  // --- 物理用の形状（凸包） ------------------------------------------------
  // 曲線を折れ線化 → 簡素化 → ノイズ輪郭を除去
  const contours = flattenPath(path)
    .map(simplify)
    .filter((c) => c.length >= 3 && Math.abs(polygonArea(c)) > 3);

  if (contours.length === 0) return null;

  // 文字を「中身の詰まった1つの塊」として扱うため、全ストロークの点を包む
  // 凸包(convex hull)を物理形状にする。これにより
  //   - 漢字の細いストロークどうしが隙間をすり抜けて干渉するのを防ぐ
  //   - 単一の凸ボディなのでブルブル震えず、積み重ねが安定する
  //   - 「か」のように分離した字も 1 つの塊にまとまる（バラけない）
  const allPoints = [];
  for (const contour of contours) for (const p of contour) allPoints.push(p);
  const hull = convexHull(allPoints);
  if (hull.length < 3) return null;

  // 物理ボディの質量中心は凸包の重心。描画もこの重心を原点に揃えてズレを防ぐ。
  const c = polygonCentroid(hull);
  const hullLocal = hull.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));

  // --- 描画用の形状（単純化なし。元命令を重心ぶん平行移動するだけ） --------
  const renderCommands = path.commands.map((cmd) => shiftCommand(cmd, c));

  // solids は物理用の頂点群（1つの凸ポリゴン）。scene.js が fromVertices に渡す。
  return { renderCommands, solids: [hullLocal] };
}

// Andrew のモノトーンチェーン法による凸包。入力点を包む最小の凸多角形を返す。
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 &&
           cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 &&
           cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// パス命令の座標を平行移動（曲線の制御点ごと動かす）
function shiftCommand(cmd, c) {
  const out = { type: cmd.type };
  if (cmd.x !== undefined) {
    out.x = cmd.x - c.x;
    out.y = cmd.y - c.y;
  }
  if (cmd.x1 !== undefined) {
    out.x1 = cmd.x1 - c.x;
    out.y1 = cmd.y1 - c.y;
  }
  if (cmd.x2 !== undefined) {
    out.x2 = cmd.x2 - c.x;
    out.y2 = cmd.y2 - c.y;
  }
  return out;
}

// --- パスのフラット化（曲線→折れ線） -------------------------------------

function flattenPath(path) {
  const contours = [];
  let cur = null;
  let px = 0;
  let py = 0;

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
        if (cur && cur.length > 1) contours.push(cur);
        cur = [{ x: cmd.x, y: cmd.y }];
        px = cmd.x;
        py = cmd.y;
        break;
      case 'L':
        cur.push({ x: cmd.x, y: cmd.y });
        px = cmd.x;
        py = cmd.y;
        break;
      case 'Q':
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS;
          cur.push({
            x: quad(px, cmd.x1, cmd.x, t),
            y: quad(py, cmd.y1, cmd.y, t),
          });
        }
        px = cmd.x;
        py = cmd.y;
        break;
      case 'C':
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS;
          cur.push({
            x: cubic(px, cmd.x1, cmd.x2, cmd.x, t),
            y: cubic(py, cmd.y1, cmd.y2, cmd.y, t),
          });
        }
        px = cmd.x;
        py = cmd.y;
        break;
      case 'Z':
        if (cur && cur.length > 1) contours.push(cur);
        cur = null;
        break;
      default:
        break;
    }
  }
  if (cur && cur.length > 1) contours.push(cur);
  return contours;
}

function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

// 輪郭の点を間引く。
// 1) 近接重複点の除去 → 2) Ramer–Douglas–Peucker で形状を保ったまま大幅に削減。
// これで凸分割(quickDecomp)のパーツ数が現実的な範囲に収まり、多数積んでも軽い。
function simplify(points, dedup = 0.6) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > dedup) out.push(p);
  }
  if (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= dedup) out.pop();
  }
  return rdp(out, SIMPLIFY_TOLERANCE);
}

// Ramer–Douglas–Peucker（閉路を開いた折れ線として近似）
function rdp(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index !== -1) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function perpDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

// --- 幾何ユーティリティ ---------------------------------------------------

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function polygonCentroid(pts) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-6) {
    // 退化したら単純平均
    const m = pts.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
    return { x: m.x / pts.length, y: m.y / pts.length };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

