// 書体マニフェスト。works/moji-stack/src/fonts.js から流用。
//
// public/fonts/ に .ttf / .otf を置き、ここに追記すればウェイトのセレクタに反映される。
// woff2 はブラウザ内で展開（brotli 解凍）できないため .ttf / .otf を使うこと。
//
// ※ url は「相対パス」で書く。moji-stack は '/fonts/...' の絶対パスで書かれており、
//   README に「サブパス配信では解決できない」と注意書きがある。ここでは相対にして
//   document.baseURI 基準で解決されるようにしてある（glyph.js の loadFont に渡る）。
//
// つまむ体験は線が太いほど成立しやすい（掴みの影響半径が線幅を上回る必要がある。
// 詳しくは config.js の grabRadius のコメント）。そのため太いウェイトだけを置いている。

export const FONT_WEIGHTS = [
  { label: 'ボールド', url: 'fonts/ZenMaruGothic-Bold.ttf', isDefault: true },
  { label: 'ブラック', url: 'fonts/ZenMaruGothic-Black.ttf', isDefault: false },
];
