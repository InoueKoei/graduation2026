// 利用可能な書体のマニフェスト。
//
// 各ファミリーは複数ウェイト（別ファイル）を持つ。public/fonts/ に .ttf / .otf を置き、
// ここに追記すれば書体／ウェイトのセレクタに反映される（url は /fonts/... を指す）。
//
// デスクトップの書体は UI の「読み込み」ボタンから直接ファイルを選べる（main.js）。
// 選んだファイルを ArrayBuffer として loadFont() に渡すだけで同じ描画経路に乗る。
// woff2 はブラウザ内で展開できないため .ttf / .otf を使うこと。

export const FONT_FAMILIES = [
  {
    label: 'ゼン丸ゴシック',
    weights: [
      { label: 'ライト',     url: '/fonts/ZenMaruGothic-Light.ttf',   isDefault: false },
      { label: 'レギュラー', url: '/fonts/ZenMaruGothic-Regular.ttf', isDefault: true  },
      { label: 'ミディアム', url: '/fonts/ZenMaruGothic-Medium.ttf',  isDefault: false },
      { label: 'ボールド',   url: '/fonts/ZenMaruGothic-Bold.ttf',    isDefault: false },
      { label: 'ブラック',   url: '/fonts/ZenMaruGothic-Black.ttf',   isDefault: false },
    ],
  },
];

// 書体メニューに出す書体を限定するリスト（OS にインストール済みのものだけ表示）。
// ※ これは public/fonts.json が読めない時のフォールバック。通常は fonts.json を編集する。
//   family     : ファミリー名で指定（そのファミリーの全ウェイト）。
//   postscript : PostScript 名で指定（一意。'-H' 等でウェイトもピン留めできる）。
//   label      : メニュー表示名（和名）。その書体自身でレンダリングして表記する。
//   ※ family / postscript のどちらか一方でよい。照合は大小無視・部分一致でゆるく行う。
export const CURATED_FONTS = [
  { family: 'A P-OTF Kuromame StdN',        label: 'くろまめ' },
  { postscript: 'PNijitakotengokuMin2-H',   label: '虹蛸天国' },
  { family: 'A P-OTF Harucraft StdN',       label: 'ハルクラフト' },
  { family: 'A P-OTF Ryumin Pr6N',          label: 'リュウミン' },
  { family: 'A P-OTF Shueimincho Pr6N',     label: '秀英明朝' },
  { family: 'A P-SK IshiiGothic StdN',      label: '石井ゴシック' },
  { family: 'A-SK Gocurl Min2',             label: 'ゴカール' },
  { family: 'A-SK Idashe Min2',             label: 'イダシエ' },
  { family: 'A P-OTF Shin Go Pr6N',         label: '新ゴ' },
  { family: 'A P-OTF Kocho StdN',           label: '光朝' },
  { family: 'Meiryo',                       label: 'メイリオ' },
  { family: 'Ro Honmincho StdN',            label: '本明朝' },
  { family: 'Yu Gothic Pr6N',               label: '游ゴシック' },
  { family: 'A P-OTF Gothic MB101 Pr6N',    label: 'ゴシックMB101' },
  { family: 'A P-OTF Chogetsu Min2',        label: '澄月' },
  { family: 'TunnelMin',        label: 'トンネル' },
  { family: 'PKaishoMCBK1ProN-Bold',        label: '楷書MCBK1' },
  { family: 'RailwayStd-B',        label: 'レイルウェイ' },
  { family: 'DotGothic12Std-M',        label: 'ドットゴシック' }
];

// 文字サイズ（落とす文字の大きさ）の範囲
export const SIZE = { min: 60, max: 300, default: 150 };

// 音量(RMS) → 0–1 の正規化。dBFloor〜dBFloor+dBRange を 0〜1 にマッピングする。
// dBRange を狭めるほど、わずかな音量差が大きなサイズ差になる（＝刻みが細かい）。
const VOLUME = { dbFloor: -31, dbRange: 12 };

export function normalizeVolume(rms) {
  const db = 20 * Math.log10(Math.max(rms, 0.001));
  return Math.max(0, Math.min(1, (db - VOLUME.dbFloor) / VOLUME.dbRange));
}
