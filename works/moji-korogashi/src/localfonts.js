// OS にインストールされている書体を拾って、かなを持つものだけ並べる。
//
// works/moji-stack が Local Font Access API を使っている（main.js:313）ので経路はそこから。
// ただしあちらは「モリサワのこれとこれ」という固定リストとの照合だった。
// ころがしでは書体そのものがコースの形になるので、決め打ちにせず、
// 入っている書体を全部見て、かなを持つものを出すようにしている。
//
// ★ 二つの制約
//   1. opentype.js は .ttc を読めない。macOS のヒラギノ・游ゴシック・AquaKana は .ttc なので、
//      一覧には出ても実際に選ぶと読めない。これは選んだ時点で分かるので、
//      そのときに理由を伝えて元の書体に戻す（黙って失敗させない）。
//   2. FontData には「この書体がどの文字を持っているか」が入っていない。
//      幅を測る方式は CJK だと全角 1em で揃ってしまい判定できないので、
//      実際に描いた絵を比べる（PriorArt/try/na.html が書体の判別に使っているのと同じ手）。

const KANA_PROBE = 'あ';
// 実在しないファミリー名。これだけを指定すると、あ は必ずシステムのフォールバックで描かれる
const NO_FONT = '__korogashi_no_such_font__';
const PROBE_PX = 64;
const CANVAS = 120;
const GRID = 12;
// 欧文書体は 0、CJK 書体は 0.07〜0.16 だった（実測）。あいだを取る
const KANA_THRESHOLD = 0.02;

let probeCtx = null;
let fallbackShape = null;

/** この環境で使えるか。Chrome / Edge のデスクトップのみ。 */
export function supported() {
  return typeof window !== 'undefined' && 'queryLocalFonts' in window;
}

function ctx() {
  if (probeCtx) return probeCtx;
  const c = document.createElement('canvas');
  c.width = CANVAS;
  c.height = CANVAS;
  probeCtx = c.getContext('2d', { willReadFrequently: true });
  return probeCtx;
}

/**
 * 「あ」を描いて、外接矩形で正規化した GRID×GRID の濃淡を返す。インクが無ければ null。
 *
 * ★ 正規化が要る理由
 *   その書体が あ を持っていないとき、ブラウザは別の書体で代わりに描く。
 *   このときベースラインや大きさが「主フォントの metrics」に合わせて動くので、
 *   同じ字なのに位置がずれた絵になる。位置をそのまま比べると、
 *   かなを 1 文字も持たない Zapfino が「持っている」と判定されてしまった（実測 0.0475）。
 *   外接矩形で切って正規化すれば、位置のずれは消えて形だけが残る。
 */
function shapeOf(fontSpec) {
  const g = ctx();
  g.clearRect(0, 0, CANVAS, CANVAS);
  g.fillStyle = '#000';
  g.textBaseline = 'middle';
  g.font = fontSpec;
  g.fillText(KANA_PROBE, CANVAS / 2 - PROBE_PX * 0.38, CANVAS / 2);

  const d = g.getImageData(0, 0, CANVAS, CANVAS).data;
  let x0 = CANVAS; let y0 = CANVAS; let x1 = -1; let y1 = -1;
  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < CANVAS; x++) {
      if (d[(y * CANVAS + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;

  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new Float64Array(GRID * GRID);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const sx0 = x0 + Math.floor((i * w) / GRID);
      const sx1 = x0 + Math.max(Math.floor(((i + 1) * w) / GRID), Math.floor((i * w) / GRID) + 1);
      const sy0 = y0 + Math.floor((j * h) / GRID);
      const sy1 = y0 + Math.max(Math.floor(((j + 1) * h) / GRID), Math.floor((j * h) / GRID) + 1);
      let sum = 0;
      let cnt = 0;
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) { sum += d[(y * CANVAS + x) * 4 + 3]; cnt++; }
      }
      out[j * GRID + i] = cnt ? sum / cnt / 255 : 0;
    }
  }
  return out;
}

function meanAbsDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/**
 * その書体が「かな」を持っているか。
 *
 * FontData には収録文字の情報が無いので、実際に描いて確かめるしかない。
 * 幅の比較では判定できない（CJK はたいてい全角 1em で、落ちた先も同じ 1em になる）。
 * そこで「その書体で描いた あ」と「フォールバックだけで描いた あ」の形を比べ、
 * 違えばその書体が自前のグリフを出したとみなす。
 *
 * ※ システムの最終フォールバックそのもの（macOS ならヒラギノ）だけは、
 *   参照と同じ絵になるので偽陰性になりうる。ただしそれは .ttc なのでどのみち読めない。
 */
export function hasKana(family) {
  if (fallbackShape === null) fallbackShape = shapeOf(`${PROBE_PX}px "${NO_FONT}"`);
  if (!fallbackShape) return false;
  const s = shapeOf(`${PROBE_PX}px "${cssEscape(family)}", "${NO_FONT}"`);
  if (!s) return false;
  return meanAbsDiff(s, fallbackShape) > KANA_THRESHOLD;
}

function cssEscape(name) {
  return name.replace(/["\\]/g, '\\$&');
}

// ウェイトの重さの目安。ころがしは線が太いほど成立しやすいので、
// 同じファミリーなら太いフェイスを優先して選ぶ。
const WEIGHT_RANK = [
  [/black|heavy|ultra|ExtraBold|W9|W8/i, 5],
  [/bold|demi|semibold|W7|W6/i, 4],
  [/medium|W5/i, 3],
  [/regular|roman|normal|book|W4|W3/i, 2],
  [/light|thin|extralight|W2|W1|W0/i, 0],
];

function weightRank(fd) {
  const name = `${fd.style || ''} ${fd.fullName || ''} ${fd.postscriptName || ''}`;
  for (const [re, rank] of WEIGHT_RANK) if (re.test(name)) return rank;
  return 1;
}

/**
 * インストール済みの書体のうち、かなを持つファミリーを返す。
 * 許可ダイアログが出るので、必ずボタンなどのユーザー操作から呼ぶこと。
 *
 * @returns {Promise<{ok:true, families:Array<{family:string,faces:FontData[],face:FontData}>, scanned:number}
 *                  | {ok:false, reason:'unsupported'|'denied'}>}
 */
export async function listJapaneseFamilies() {
  if (!supported()) return { ok: false, reason: 'unsupported' };

  let fonts;
  try {
    fonts = await window.queryLocalFonts();
  } catch (_) {
    return { ok: false, reason: 'denied' };
  }

  const byFamily = new Map();
  for (const fd of fonts) {
    if (!byFamily.has(fd.family)) byFamily.set(fd.family, []);
    byFamily.get(fd.family).push(fd);
  }

  const families = [];
  for (const [family, faces] of byFamily) {
    if (!hasKana(family)) continue;
    // 同じファミリーの中では、いちばん太いフェイスを代表にする
    const face = faces.slice().sort((a, b) => weightRank(b) - weightRank(a))[0];
    families.push({ family, faces, face });
  }
  families.sort((a, b) => a.family.localeCompare(b.family, 'ja'));

  return { ok: true, families, scanned: byFamily.size };
}

/** FontData → ArrayBuffer。glyph.js の loadFont() にそのまま渡せる。 */
export async function faceBuffer(fontData) {
  const blob = await fontData.blob();
  return blob.arrayBuffer();
}

/**
 * .ttc かどうかを先頭 4 バイトで見る。
 * opentype.js は 'ttcf' を扱えないので、投げる前に分かると案内を出せる。
 */
export function isCollection(buffer) {
  if (!buffer || buffer.byteLength < 4) return false;
  const b = new Uint8Array(buffer, 0, 4);
  return b[0] === 0x74 && b[1] === 0x74 && b[2] === 0x63 && b[3] === 0x66; // 'ttcf'
}
