// ============================================================
//  template.js — 出題語を「理想の組版」とみなし、置かれた活字とのずれを測る
//  OpenCV にも DOM にも依存しない純粋関数だけを置く。
//
//  画面上の絶対位置は決め打ちにしない。どこに置いても成立させるため、
//  検出したブロック自身から「あるべき並び」を組み立てる：
//    水平なベースライン（中心の平均 y）／等間隔（間隔の中央値）／角度ゼロ
// ============================================================

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** マーカーの見かけの大きさ＝4辺の平均長[px]。ずれを無次元化する基準になる */
export function markerSize(marker) {
  const c = marker.corners;
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    total += Math.hypot(c[j * 2] - c[i * 2], c[j * 2 + 1] - c[i * 2 + 1]);
  }
  return total / 4;
}

/** 中央値（元配列は変更しない） */
function median(values) {
  const a = [...values].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * 理想の組版を組む。
 * @param {Array<{cx:number,cy:number,corners:number[]}>} markers 左→右に並べ替え済み
 * @param {number} [slotCount] スロット数（出題語の文字数）。省略時は検出数
 * @returns {{slots:Array<{x:number,y:number}>, spacing:number, baselineY:number, size:number}|null}
 */
export function buildTemplate(markers, slotCount) {
  if (!markers.length) return null;

  const size = markers.reduce((sum, m) => sum + markerSize(m), 0) / markers.length;

  // 隣り合う間隔の中央値を「あるべき字送り」とする。
  // 1個しか無いときは間隔が測れないので、ブロックの大きさから決め打つ。
  const gaps = [];
  for (let i = 1; i < markers.length; i++) gaps.push(markers[i].cx - markers[i - 1].cx);
  const spacing = gaps.length ? Math.abs(median(gaps)) : size * 1.4;

  const centerX = markers.reduce((s, m) => s + m.cx, 0) / markers.length;
  const baselineY = markers.reduce((s, m) => s + m.cy, 0) / markers.length;

  const row = (count) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({ x: centerX + (i - (count - 1) / 2) * spacing, y: baselineY });
    }
    return out;
  };

  // slots  … 画面に薄く重ねる案内（出題語の文字数ぶん）
  // fitSlots … ずれの測定に使う、置いた数ぶんのスロット
  //
  // 測定を出題語の文字数で組むと、3文字の出題に2個しか置いていない人が
  // 半コマぶん常にずれることになり、置き方の丁寧さを測れない。
  // 測定側は「置いたぶんを重心に合わせて等間隔に並べたらどうなるか」で見る。
  return {
    slots: row(Math.max(slotCount || 0, markers.length)),
    fitSlots: row(markers.length),
    spacing, baselineY, size,
  };
}

/**
 * 各ブロックの、テンプレからのずれ。
 * @param {Array} markers 左→右に並べ替え済み
 * @param {Object} template buildTemplate() の戻り
 * @param {{fullOffset:number, fullAngleDeg:number}} bleed
 * @returns {Array<{dx,dy,dist,offsetRatio,angleDeg,amount,slot}>} markers と同じ並び
 */
export function deviations(markers, template, bleed) {
  if (!template) return [];

  return markers.map((m, i) => {
    const slot = template.fitSlots[i];
    const dx = m.cx - slot.x;
    const dy = m.cy - slot.y;
    const dist = Math.hypot(dx, dy);
    const offsetRatio = dist / (template.size || 1);
    const angleDeg = Math.abs((m.angleRad * 180) / Math.PI);

    // 位置と傾きの「悪いほう」を採る。足し合わせるとどちらも中くらいのときに
    // すぐ上限へ張り付いてしまい、丁寧さの差が見えなくなる。
    const amount = clamp(
      Math.max(offsetRatio / bleed.fullOffset, angleDeg / bleed.fullAngleDeg),
      0, 1,
    );
    return { dx, dy, dist, offsetRatio, angleDeg, amount, slot };
  });
}

/** 組版全体の乱れ＝各ブロックのにじみ量の平均（HUD 表示用） */
export function disorder(devs) {
  if (!devs.length) return 0;
  return devs.reduce((s, d) => s + d.amount, 0) / devs.length;
}
