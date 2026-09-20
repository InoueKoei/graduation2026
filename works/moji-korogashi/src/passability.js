// 「玉が本当に通れるか」を判定する。
//
// ★ なぜ要るか（実測して分かったこと）
//   文字を寄せて輪郭が 1 本に合成されても、それは玉が通れることを意味しない。
//   「こ」と「ろ」を重ねて union が 1 リングになった状態で調べたところ、
//   半径 6px の玉が到達できるのは通行可能セル 1086 のうち 232 だけだった。
//   接触部のくびれが玉より細く、線の上では continuous でも玉には行き止まりになる。
//
//   輪郭がつながったかどうか（course.js の連結成分）と、
//   玉が通れるかどうか（ここ）は別の問題なので、別に測る。
//
// やり方は、合成後の形をラスタライズ → 距離変換 → 玉の半径で収縮 → 連結成分。
// ベクタのまま最短通路を解くより、この方がずっと単純で速い。

const INF = 1e20;

/**
 * @param {Array<Array<[number,number]>>} rings 合成後の輪郭
 * @param {number} radius 玉の半径(px)
 * @param {number} scale ラスタライズの倍率。0.5 なら 2px を 1 セルとして見る
 * @returns {null | {
 *   count: number, ok: boolean,
 *   componentAt(x:number, y:number): number,
 *   largestSeed: {x:number, y:number} | null,
 * }}
 */
export function analyzePassability(rings, radius, scale = 0.5) {
  if (!rings || rings.length === 0) return null;

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  // 外周を余白でくるむ。枠の外は「塗りの外」として扱いたいので
  const pad = radius + 4;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;

  const W = Math.max(1, Math.ceil((maxX - minX) * scale));
  const H = Math.max(1, Math.ceil((maxY - minY) * scale));
  if (W * H > 4_000_000) return null; // 大きすぎるときは諦める（体験は止めない）

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
  ctx.beginPath();
  for (const ring of rings) {
    ctx.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
    ctx.closePath();
  }
  // 穴のリングは向きが逆なので nonzero でそのまま抜ける
  ctx.fillStyle = '#000';
  ctx.fill('nonzero');

  const px = ctx.getImageData(0, 0, W, H).data;
  const f = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) f[i] = px[i * 4 + 3] > 127 ? INF : 0;

  // 塗りの内側の各点について、いちばん近い「外」までの距離（の2乗）
  edt2d(f, W, H);

  const need = (radius * scale) ** 2;
  const free = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) free[i] = f[i] >= need ? 1 : 0;

  // 連結成分にラベルを振る
  const label = new Int32Array(W * H).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!free[s] || label[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % W;
      const y = (p / W) | 0;
      if (x > 0) pushIf(p - 1);
      if (x < W - 1) pushIf(p + 1);
      if (y > 0) pushIf(p - W);
      if (y < H - 1) pushIf(p + W);
    }
    sizes.push(size);

    function pushIf(q) {
      if (free[q] && label[q] === -1) { label[q] = id; stack.push(q); }
    }
  }

  let largestSeed = null;
  if (sizes.length > 0) {
    let big = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[big]) big = i;
    for (let i = 0; i < W * H; i++) {
      if (label[i] === big) {
        largestSeed = { x: minX + ((i % W) + 0.5) / scale, y: minY + (((i / W) | 0) + 0.5) / scale };
        break;
      }
    }
  }

  return {
    count: sizes.length,
    ok: sizes.length <= 1,
    largestSeed,
    componentAt(x, y) {
      const i = Math.floor((x - minX) * scale);
      const j = Math.floor((y - minY) * scale);
      if (i < 0 || j < 0 || i >= W || j >= H) return -1;
      return label[j * W + i];
    },
  };
}

// --- 距離変換（Felzenszwalb & Huttenlocher の 1 次元変換を縦横に適用）---------

function edt2d(f, W, H) {
  const col = new Float64Array(Math.max(W, H));
  const d = new Float64Array(Math.max(W, H));
  const v = new Int32Array(Math.max(W, H));
  const z = new Float64Array(Math.max(W, H) + 1);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) col[x] = f[y * W + x];
    edt1d(col, d, v, z, W);
    for (let x = 0; x < W; x++) f[y * W + x] = d[x];
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) col[y] = f[y * W + x];
    edt1d(col, d, v, z, H);
    for (let y = 0; y < H; y++) f[y * W + x] = d[y];
  }
}

function edt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}
