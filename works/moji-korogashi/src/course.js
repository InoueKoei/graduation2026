// コース = 置かれた文字たちと、そこから導かれる「1本につながった輪郭」。
//
// ★ この制作でいちばん大事な設計判断
//   複合パスを永続的なオブジェクトとして作らない。文字は最後まで独立した Piece のままで、
//   接触している集まりを毎回 union し直して輪郭を導出する。
//   こうすると「離すと元の独立したオブジェクトに戻る」が、戻す処理を書かなくても成立する。
//
//   そして union の結果は、画面に描かれる線であると同時に、ボールが当たる壁でもある。
//   見えている線とぶつかる線を別々に持つとズレるので、ここを唯一の真実にしてある。

import polygonClipping from 'polygon-clipping';
import { buildOutlineRings, polygonArea, strokeWidthEstimate } from './glyph.js';
import { CONFIG } from './config.js';

/** 置かれた 1 文字。 */
let nextPieceId = 1;

export class Piece {
  constructor({ char, font, fontKey, size, x, y }) {
    this.id = nextPieceId++;
    this.shapeVersion = 0;
    this.char = char;
    this.font = font;
    this.fontKey = fontKey;
    this.size = size;
    this.x = x;
    this.y = y;
    this._worldShape = null;
    this.build();
  }

  /** 字形から輪郭を作り直す（文字・書体・サイズが変わったとき）。 */
  build() {
    const rings = buildOutlineRings(this.font, this.char, this.size, CONFIG.nodeSpacing);
    this.rings = rings ?? [];
    this.ok = this.rings.length > 0;
    this.localShape = this.ok ? ringsToShape(this.rings) : [];
    this.strokeWidth = this.ok ? strokeWidthEstimate(this.rings) : 0;
    this.localBBox = bboxOfShape(this.localShape);
    this._worldShape = null;
    this.shapeVersion++;
  }

  moveTo(x, y) {
    this.x = x;
    this.y = y;
    this._worldShape = null;
  }

  resize(size) {
    if (size === this.size) return;
    this.size = size;
    this.build();
  }

  /** 画面座標での MultiPolygon。移動しただけなら平行移動で済む。 */
  get shape() {
    if (!this._worldShape) this._worldShape = translateShape(this.localShape, this.x, this.y);
    return this._worldShape;
  }

  get bbox() {
    const b = this.localBBox;
    if (!b) return null;
    return { minX: b.minX + this.x, minY: b.minY + this.y, maxX: b.maxX + this.x, maxY: b.maxY + this.y };
  }

  /**
   * 点がこの文字を掴んでいるか。塗りの内側、または輪郭線から slack px 以内。
   * 文字は細いので、塗りの中だけを当たりにすると掴みにくい。
   */
  hit(x, y, slack = 0) {
    const b = this.bbox;
    if (!b) return false;
    if (x < b.minX - slack || x > b.maxX + slack || y < b.minY - slack || y > b.maxY + slack) return false;
    const rings = shapeRings(this.shape);
    if (pointInRings(rings, x, y)) return true;
    return slack > 0 && distanceToRings(rings, x, y) <= slack;
  }

  /** bbox の中か。厳密な当たりが取れなかったときの逃げに使う。 */
  bboxHit(x, y) {
    const b = this.bbox;
    return !!b && x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  }
}

/** 置かれた文字の集合と、その合成結果。 */
export class Course {
  constructor() {
    this.pieces = [];
    this._dirty = true;
    this._walls = [];
    this._groups = [];
    // 壁が作り直されるたびに増える。当たり判定のインデックスを張り直す合図に使う
    this.version = 0;
    // 直近の合成にかかった時間(ms)と、その時刻。間引きの判断に使う
    this._lastCost = 0;
    this._lastAt = 0;
    // 「同じ顔ぶれが同じ位置にいる集まり」の union 結果を使い回す。
    // 1文字を動かしているあいだ、動いていない集まりまで作り直さずに済む
    this._groupCache = new Map();
  }

  add(piece) { this.pieces.push(piece); this.invalidate(); }

  remove(piece) {
    const i = this.pieces.indexOf(piece);
    if (i >= 0) this.pieces.splice(i, 1);
    this.invalidate();
  }

  clear() { this.pieces.length = 0; this.invalidate(); }

  invalidate() { this._dirty = true; }

  /**
   * 合成後の輪郭リング群。描画と当たり判定の両方がこれを見る。
   * @returns {Array<Array<[number,number]>>} 閉じたリング（終点に始点を重複させない）
   */
  get walls() {
    if (this._dirty && this._mayRecompute()) this._recompute();
    return this._walls;
  }

  /**
   * 直前の合成が重かったときは、1 フレーム空けてから作り直す。
   * 文字数が増えると union は素直に重くなる（6文字で 10ms 前後）。
   * 毎フレーム回すと描画と玉の更新まで巻き添えになるので、
   * 「合成にかけた時間と同じだけ休む」＝ フレーム時間の半分までに抑える。
   * _dirty は落とさないので、手が止まれば次のフレームで必ず最新になる。
   */
  _mayRecompute() {
    if (this._lastCost <= 6) return true;
    return performance.now() - this._lastAt >= this._lastCost;
  }

  /** 連結成分（接触してひとかたまりになっている Piece の集まり）。 */
  get groups() {
    if (this._dirty) this._recompute();
    return this._groups;
  }

  _recompute() {
    const started = performance.now();
    this._dirty = false;
    const live = this.pieces.filter((p) => p.ok && p.shape.length > 0);

    // 1. 接触しているペアを探す。bbox が重なるものだけ実際に交差を取る。
    const parent = live.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const unite = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; };

    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        if (find(i) === find(j)) continue;
        if (!bboxOverlap(live[i].bbox, live[j].bbox)) continue;
        let hit = false;
        try {
          hit = polygonClipping.intersection(live[i].shape, live[j].shape).length > 0;
        } catch (_) {
          // 数値的に潰れた入力で稀に落ちる。落ちたら「接触していない」扱いで進める
          hit = false;
        }
        if (hit) unite(i, j);
      }
    }

    // 2. 連結成分ごとにまとめる
    const buckets = new Map();
    live.forEach((piece, i) => {
      const root = find(i);
      if (!buckets.has(root)) buckets.set(root, []);
      buckets.get(root).push(piece);
    });
    this._groups = [...buckets.values()];

    // 3. 成分ごとに union して、リングを集める
    const walls = [];
    const cache = new Map();
    for (const group of this._groups) {
      let shape;
      if (group.length === 1) {
        // 1文字だけなら Piece 側で解決済みの形をそのまま使う
        shape = group[0].shape;
      } else {
        const key = groupKey(group);
        const hit = this._groupCache.get(key);
        if (hit) {
          shape = hit;
        } else {
          try {
            shape = polygonClipping.union(group[0].shape, ...group.slice(1).map((p) => p.shape));
          } catch (_) {
            // 合成に失敗したら、せめて素の輪郭を出す（体験が止まらないことを優先）
            shape = group.flatMap((p) => p.shape);
          }
        }
        cache.set(key, shape);
      }
      collectRings(shape, walls);
    }
    this._groupCache = cache; // 今回使わなかった分は捨てる
    this._walls = walls;
    this.version++;
    this._lastAt = performance.now();
    this._lastCost = this._lastAt - started;
  }
}

// --- 形の組み立て ---------------------------------------------------------

/**
 * 輪郭リング群 → 穴を抜いた MultiPolygon。
 *
 * ★ ここは一度間違えた。面積の符号で外周と穴に二分し、union した外周から
 *   union した穴を引く、という書き方をしていた。それだと「国」が壊れる。
 *   囲いの中の「玉」は、穴の中に浮かぶ実体なので、穴として引かれて消えてしまう。
 *   （実測: 国 → polys=1 になり、中身が無い枠だけが残った）
 *
 * なので入れ子の深さで判定する。あるリングを含む他のリングの数を数え、
 *   偶数 = 外周 / 奇数 = 穴
 * とみなし、穴は「自分をちょうど 1 つ多く含む外周」に属させる。
 * こうすると 国 → 枠 + 玉 の 2 ポリゴンになる。深さ 2 以上の入れ子も自然に通る。
 *
 * 最後に union をかけるのは、同じ向きの輪郭どうしの重なり（筆書体にたまにある）を
 * ここで潰しておくため。fill-rule でいうと nonzero 相当の扱いになる
 * （evenodd ではない理由は experiments/TsumamiJi/README.md:72-76）。
 */
function ringsToShape(rings) {
  const polys = [];
  for (const r of rings) {
    if (Math.abs(polygonArea(r)) < 1e-6) continue;
    polys.push(r.map((p) => [p.x, p.y]));
  }
  if (polys.length === 0) return [];

  // 入れ子の深さ。判定には各リングの頂点を 1 つ使う。
  // 同一グリフ内のリングどうしは接していないので、頂点が他のリングの境界に
  // 乗ることは無く、これで判定できる。
  const depth = polys.map((ring, i) => {
    let d = 0;
    for (let j = 0; j < polys.length; j++) {
      if (i !== j && pointInRing(ring[0], polys[j])) d++;
    }
    return d;
  });

  const built = [];
  for (let i = 0; i < polys.length; i++) {
    if (depth[i] % 2 !== 0) continue; // 奇数深さは穴なので、親の側から拾う
    const holes = [];
    for (let j = 0; j < polys.length; j++) {
      if (depth[j] === depth[i] + 1 && pointInRing(polys[j][0], polys[i])) holes.push(polys[j]);
    }
    built.push([polys[i], ...holes]);
  }
  if (built.length === 0) return [];

  try {
    return polygonClipping.union(built[0], ...built.slice(1));
  } catch (_) {
    return built;
  }
}

/** 集まりの顔ぶれと位置と字形から作る鍵。どれかが変われば別物になる。 */
function groupKey(group) {
  return group
    .map((p) => `${p.id}@${p.x.toFixed(2)},${p.y.toFixed(2)}#${p.shapeVersion}`)
    .sort()
    .join('|');
}

function translateShape(shape, dx, dy) {
  return shape.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x + dx, y + dy])));
}

/**
 * MultiPolygon のリングを walls に足す。
 * polygon-clipping のリングは終点に始点が重複しているので、それを落として
 * 「暗黙に閉じている点列」に揃える（当たり判定側の約束）。
 */
function collectRings(shape, out) {
  for (const poly of shape) {
    for (const ring of poly) {
      if (ring.length < 4) continue;
      const first = ring[0];
      const last = ring[ring.length - 1];
      const closed = first[0] === last[0] && first[1] === last[1];
      const pts = closed ? ring.slice(0, -1) : ring.slice();
      if (pts.length >= 3) out.push(pts);
    }
  }
}

function bboxOfShape(shape) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const poly of shape) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function bboxOverlap(a, b) {
  if (!a || !b) return false;
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** MultiPolygon → リングの配列（外周も穴も区別せず並べる）。 */
export function shapeRings(shape) {
  const out = [];
  for (const poly of shape) for (const ring of poly) out.push(ring);
  return out;
}

/** 点からリング群までの最短距離。 */
export function distanceToRings(rings, x, y) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t));
      if (d < best) best = d;
    }
  }
  return best;
}

/** 点が 1 本のリングの内側か。even-odd の交差数え。 */
function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    if ((y1 > y) !== (y2 > y)) {
      const t = (y - y1) / (y2 - y1);
      if (x < x1 + t * (x2 - x1)) inside = !inside;
    }
  }
  return inside;
}

/**
 * 点がリング群の内側か。even-odd の交差数え。
 * union 後のリングは重なりが無く、穴は逆向きに閉じているので、これで正しく判定できる。
 */
export function pointInRings(rings, x, y) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      if ((y1 > y) !== (y2 > y)) {
        const t = (y - y1) / (y2 - y1);
        if (x < x1 + t * (x2 - x1)) inside = !inside;
      }
    }
  }
  return inside;
}
