// 書体の読み込みと、1文字 → 密な輪郭リング（ばね網の節点列）への変換。
//
// 経路そのものは works/moji-stack/src/glyph.js の流用。
//   opentype.js で書体を読む → glyph.getPath() → ベジェを折れ線化 → 輪郭(contour)の点列
// loadFont / flattenPath / quad / cubic はほぼそのまま持ってきている。
//
// ★ moji-stack との決定的な違い
//   あちらは「文字を積む」ための物理形状なので、折れ線を RDP で間引き、さらに
//   convexHull（凸包）を取って 1 つの塊にしている。今回それをやってはいけない。
//   凸包を取ると「あ」の穴も凹みも消えて、つまむ対象そのものが無くなる。
//   ここで欲しいのは「間引かない、等間隔の、密な輪郭リング」なので、
//   flattenPath の出力を弧長で等間隔リサンプルするだけにしてある。
//
//   等間隔にするのは、ばねの自然長を揃えるため。間隔がバラバラだと引いたときに
//   一部だけが伸びて挙動にムラが出る。

import opentype from 'opentype.js';

const CURVE_STEPS = 12; // ベジェ曲線を直線に近似する分割数
const MIN_CONTOUR_AREA = 4; // これ未満の面積の輪郭はノイズとして捨てる(px^2)

const fontCache = new Map();

/**
 * 書体を読み込む。
 * @param {string|ArrayBuffer} source URL 文字列、またはフォントファイルの ArrayBuffer
 * @returns {Promise<opentype.Font>}
 */
export async function loadFont(source) {
  if (typeof source === 'string') {
    if (fontCache.has(source)) return fontCache.get(source);
    // 相対パスは document.baseURI 基準で解決する（サブパス配信でも壊れないように）
    const url = new URL(source, document.baseURI).href;
    const font = await opentype.load(url);
    fontCache.set(source, font);
    return font;
  }
  // ArrayBuffer（将来デスクトップの書体を読ませる場合はこちら）
  return opentype.parse(source);
}

/**
 * 1文字を、等間隔の点で構成された閉じた輪郭リング群にする。
 *
 * @param {opentype.Font} font
 * @param {string} char        1文字
 * @param {number} fontSize    字面の大きさ(px)
 * @param {number} nodeSpacing 節点の間隔(px)
 * @returns {{x:number,y:number}[][] | null}
 *   外周とカウンター(穴)がそれぞれ 1 リング。座標は字形の中心が原点。
 *   グリフが無い / 空白などで実体が無い場合は null
 */
export function buildOutlineRings(font, char, fontSize, nodeSpacing) {
  const glyph = font.charToGlyph(char);
  // .notdef（豆腐）や実体のないグリフは弾く
  if (!glyph || glyph.index === 0) return null;

  const path = glyph.getPath(0, 0, fontSize);

  const contours = flattenPath(path)
    .map(dedupe)
    .filter((c) => c.length >= 3 && Math.abs(polygonArea(c)) > MIN_CONTOUR_AREA);

  if (contours.length === 0) return null;

  // 字形全体の外接矩形の中心を原点に据える。
  // （重心ではなく外接矩形なのは、画面の中央に「見た目どおり」置きたいため）
  const c = boundsCenter(contours);

  const rings = [];
  for (const contour of contours) {
    const ring = resampleClosed(contour, nodeSpacing);
    if (ring.length < 3) continue;
    rings.push(ring.map((p) => ({ x: p.x - c.x, y: p.y - c.y })));
  }

  return rings.length > 0 ? rings : null;
}

// --- 等間隔リサンプル -----------------------------------------------------

/**
 * 閉じた折れ線を、弧長で等間隔な点列に打ち直す。
 * 出力の点数 n は周長 / spacing。最後の点と最初の点は spacing だけ離れる
 * （＝リングとして閉じている。終点に始点を重複させない）。
 */
function resampleClosed(points, spacing) {
  // 閉路として扱うため、末尾に始点を足した上で辺の長さを測る
  const loop = points.concat([points[0]]);
  const segLen = [];
  let perimeter = 0;
  for (let i = 0; i < loop.length - 1; i++) {
    const d = Math.hypot(loop[i + 1].x - loop[i].x, loop[i + 1].y - loop[i].y);
    segLen.push(d);
    perimeter += d;
  }
  if (perimeter < spacing * 3) return [];

  const n = Math.max(3, Math.round(perimeter / spacing));
  const step = perimeter / n;

  const out = [];
  let seg = 0; // いま乗っている辺
  let along = 0; // その辺の始点からの距離
  out.push({ x: loop[0].x, y: loop[0].y });

  for (let i = 1; i < n; i++) {
    let remain = step;
    // 必要な距離ぶんだけ辺をまたいで進む
    while (remain > segLen[seg] - along) {
      remain -= segLen[seg] - along;
      along = 0;
      seg++;
      if (seg >= segLen.length) {
        seg = segLen.length - 1;
        along = segLen[seg];
        remain = 0;
        break;
      }
    }
    along += remain;
    const t = segLen[seg] > 0 ? along / segLen[seg] : 0;
    out.push({
      x: loop[seg].x + (loop[seg + 1].x - loop[seg].x) * t,
      y: loop[seg].y + (loop[seg + 1].y - loop[seg].y) * t,
    });
  }
  return out;
}

// --- パスのフラット化（曲線→折れ線）※ moji-stack から流用 ----------------

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

// --- 幾何ユーティリティ ---------------------------------------------------

// 重なった点を除く（辺の長さ 0 を作らない。リサンプルが壊れるため）
function dedupe(points, tol = 0.01) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > tol) out.push(p);
  }
  // 終点が始点と重なっていたら落とす（閉路は暗黙に閉じる約束）
  while (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= tol) out.pop();
    else break;
  }
  return out;
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function boundsCenter(contours) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const contour of contours) {
    for (const p of contour) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
