// 書体マニフェスト。experiments/TsumamiJi/src/fonts.js から流用。
//
// public/fonts/ に .ttf / .otf を置き、ここに追記すればセレクタに反映される。
// woff2 はブラウザ内で展開（brotli 解凍）できないため .ttf / .otf を使うこと。
// 同じ理由で .ttc（macOS のヒラギノ・游ゴシック等）も opentype.js では読めない。
//
// ※ url は「相対パス」で書く。moji-stack は '/fonts/...' の絶対パスで書かれており、
//   README に「サブパス配信では解決できない」と注意書きがある。
//
// ころがしは線が太いほど成立しやすい（ボールの直径が線幅を下回る必要がある。
// 詳しくは config.js の minStrokeRatio のコメント）。そのため太いウェイトだけを置いている。

export const FONT_WEIGHTS = [
  { label: 'ブラック', url: 'fonts/ZenMaruGothic-Black.ttf', isDefault: true },
  { label: 'ボールド', url: 'fonts/ZenMaruGothic-Bold.ttf', isDefault: false },
];
