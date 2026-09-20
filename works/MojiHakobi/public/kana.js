// ============================================================
// 対象文字（要件書 3章・4章）
// ------------------------------------------------------------
// 現代仮名の五十音のみ。小書き文字・長音符・句読点・漢字は入れない。
// 濁音・半濁音は完成した一文字としては用意せず、
// 基本文字と「゛」「゜」を別々に運んで組み立てる。
// ============================================================

export const DAKUTEN = "゛"; // ゛
export const HANDAKUTEN = "゜"; // ゜

/**
 * 五十音図。行を列に、段を行に並べた 10列 x 5段。
 * null は空き（や行の い段・え段 など）。
 */
export const GOJUON_GRID = [
  ["あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ"],
  ["い", "き", "し", "ち", "に", "ひ", "み", null, "り", null],
  ["う", "く", "す", "つ", "ぬ", "ふ", "む", "ゆ", "る", null],
  ["え", "け", "せ", "て", "ね", "へ", "め", null, "れ", null],
  ["お", "こ", "そ", "と", "の", "ほ", "も", "よ", "ろ", "を"],
];

/** 五十音図に収まらないもの。置き場では図の右にひとまとまりで置く。 */
export const EXTRA_COLUMN = ["ん", DAKUTEN, HANDAKUTEN];

/** 重さを計測する対象すべて */
export const ALL_CHARS = [
  ...GOJUON_GRID.flat().filter(Boolean),
  ...EXTRA_COLUMN,
];

/**
 * 濁点・半濁点がついたときにどの文字になるか。
 * ここに無い組み合わせは成立しない（CONFIG.dakuten.strict が true のとき）。
 */
export const VOICED = {
  [DAKUTEN]: {
    か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご",
    さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ",
    た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど",
    は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ",
    う: "ゔ",
  },
  [HANDAKUTEN]: {
    は: "ぱ", ひ: "ぴ", ふ: "ぷ", へ: "ぺ", ほ: "ぽ",
  },
};

/** その文字が濁点／半濁点の付く相手になれるか */
export function canTakeMark(baseChar, markChar) {
  return Boolean(VOICED[markChar] && VOICED[markChar][baseChar]);
}

/**
 * 基本文字と印を1文字に合成する。ログに残す文字列を作るときに使う。
 * 画面上は別オブジェクトのまま隣り合わせに描くので、これは記録専用。
 */
export function compose(baseChar, markChar) {
  if (!markChar) return baseChar;
  const table = VOICED[markChar];
  return (table && table[baseChar]) || baseChar + markChar;
}

export function isMark(ch) {
  return ch === DAKUTEN || ch === HANDAKUTEN;
}
