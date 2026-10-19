// 操作画面（control）と白い面（surface）が共有する決まりごと。
// 白い面は正方形。座標はすべてその正規化座標（左上 0,0 ／ 右下 1,1）で持つ。

export const CHANNEL = 'yomare';

// 置く場は、正方形の外周の帯。正方形の縁から INSET だけ内側から、中央の円の外まで。
// ここに置かれたものだけを検出する。縁（正方形の縁・円の縁）に触れた塊は捨てる
export const PLACE = { inset: 0.03 };

// 集まる場。残した形が中心へ引かれて塊になる。カメラはここを見ない。
// 半径は操作画面で変えられる（設定の gatherR）。ここにあるのは変えられる範囲。
// 円の外に MARGIN だけ余裕を取って、塊の縁を部品と取り違えないようにする
export const GATHER = { x: 0.5, y: 0.5, rMin: 0.12, rMax: 0.38, margin: 0.025 };

// (u, v) が置く場の中か。r は集まる場の半径
export function inPlace(u, v, r) {
  const i = PLACE.inset;
  if (u < i || v < i || u > 1 - i || v > 1 - i) return false;
  return Math.hypot(u - GATHER.x, v - GATHER.y) > r + GATHER.margin;
}

export const TIME = {
  STILL_SEC: 1.0,        // これだけ動かなければ「静止」とみなして読ませる
  HOLD_SEC: 3.0,         // 読めてからこれだけ置かれ続けたら、中央へ移して残す
  MOVE_CONFIRM_SEC: 0.35,// 変化がこれだけ続いたら「動かした」とみなす（際のちらつきを無視する）
  EMOJI_SEC: 2.6,        // 絵文字が流れている時間。このあいだカメラは見ない
  EMOJI_COOLDOWN_SEC: 8, // 同じ語でまた流すまでの間
  SHRINK_SEC: 1.2,       // 置いた大きさから、塊の中の大きさへ縮むまで
};

// 恣意的に決めた6語。完全一致のときだけ流す
export const EMOJI = {
  'うし': '🐄', 'なし': '🍐', 'なつ': '🌻',
  'あい': '❤️', 'くり': '🌰', 'よい': '👍',
};

export const DEFAULTS = {
  threshold: 128,     // これより暗い（または明るい）画素を部品とみなす
  darkParts: true,    // 部品が地より暗いか
  minAreaPct: 0.05,   // 置く場の面積に対して、これ未満の塊は捨てる（%）。てん が消えない大きさに
  surfaceLevel: 255,  // 白い面の明るさ
  glow: '#ffb01f',    // 読めた合図の光の色
  gatherR: 0.27,      // 集まる場（中央の円）の半径。正方形の一辺に対する割合
  ink: '#151515',     // 残した形と見出しの色
};
