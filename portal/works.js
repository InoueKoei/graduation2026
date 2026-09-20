// ============================================================
//  works.js — ポータルに並べる作品の定義
//  作品を足す / 外すときは、このファイルだけを直す。
//
//  kind:
//    static … ポータル自身が /w/<slug>/ から配信する（子プロセス不要）
//    vite  … node_modules/.bin/vite を子プロセス起動し、そのポートへ飛ばす
//    node  … server.js を子プロセス起動し、そのポートへ飛ばす
//
//  port は kind が vite / node のときだけ使う。ポータルが一元管理するので、
//  各作品の package.json や vite.config.js とは無関係にここで決まる。
//  （例外: nfc-reader-mvp は server.js 内で 3000 に固定。作品側は触らない）
// ============================================================

/** タグ → 画面に出すバッジ。作品を動かす前に人間が知っておくべき前提だけを置く */
export const TAGS = Object.freeze({
  camera: { icon: '📷', label: 'カメラ' },
  serial: { icon: '🔌', label: 'シリアル (Chrome)' },
  pair:   { icon: '👥', label: '二人・別端末' },
  phone:  { icon: '📱', label: 'iPhone' },
  pad:    { icon: '⌨️', label: 'マクロパッド' },
  cloud:  { icon: '☁️', label: 'Supabase' },
  net:    { icon: '🌐', label: 'ネット必須' },
});

export const WORKS = Object.freeze([
  {
    slug: 'kanadance', name: 'KanaDance', kind: 'static',
    dir: 'works/KanaDance', tags: ['camera', 'cloud', 'net'],
    blurb: '身体のポーズをかな文字の字形として登録・判別する。判別した字は時間のブレンドとして重ね書きされる。',
  },
  {
    slug: 'sessan', name: 'Sessan', kind: 'static',
    dir: 'works/Sessan', tags: ['camera', 'net'],
    blurb: '手のジェスチャと表情（口形・目）だけで、キーボードに触れずにかなを入力する。',
  },
  {
    slug: 'katsuji-puzzle', name: '活字パズル', kind: 'static',
    dir: 'works/活字パズル', tags: ['camera', 'net'],
    blurb: '活字ブロック裏面の ArUco マーカーをカメラで読み、並べた順に言葉として認識する。',
  },
  {
    slug: 'gabun-heizon', name: 'からだと組版', kind: 'static',
    dir: 'works/GabunHeizon', tags: ['camera', 'net'],
    blurb: '身体の姿勢を組版のパラメータとして扱う試み。',
  },
  {
    slug: 'boin-shiin', name: '母音子音', kind: 'static',
    dir: 'works/boin-shiin-mvp', tags: ['pair', 'pad'],
    blurb: 'かな1文字を子音と母音に割って二人で入力する。同時であるほどくっきり、ずれるほどぼやけて出る。',
  },
  {
    slug: 'moji-stack', name: '文字を積む', kind: 'vite',
    dir: 'works/moji-stack', port: 5173, tags: ['camera'],
    blurb: '入力した1文字が落下し、皿の上に重力で積もっていく。引っかかったり、崩れて落ちたりする。',
  },
  {
    slug: 'easyreta', name: 'EasyReta', kind: 'vite',
    dir: 'works/EasyReta', port: 5174, tags: [],
    blurb: '11のエレメントの組み合わせでひらがなフォントをつくる。',
  },
  {
    slug: 'moji-korogashi', name: '文字ころがし', kind: 'vite',
    dir: 'works/moji-korogashi', port: 5175, tags: ['serial'],
    blurb: '文字のアウトラインがそのままコースになり、その中を赤い玉が転がる。M5Stack で傾け操作。',
  },
  {
    slug: 'moji-hakobi', name: '文字運び', kind: 'node',
    dir: 'works/MojiHakobi', port: 3100, entry: 'server.js', tags: ['pair'],
    blurb: '文字を掴んで運んで入力する。字面の黒量から出した「重さ」があり、重い文字は二人でないと動かない。',
    hint: 'コントローラは同じ Wi-Fi の別端末から開く。URL は下のログに出る。',
  },
  {
    slug: 'nfc-karuta', name: '「な」しかないカルタ', kind: 'node',
    dir: 'works/nfc-reader-mvp', port: 3000, entry: 'server.js', tags: ['phone'],
    blurb: '全部『な』の一文字で書体だけが違う札から、お題の書体を探してスキャンするタイムアタック。',
    hint: 'NFCタグに書き込む URL は下のログに出る。iPhone の「ショートカット」で読む。',
  },
]);

/** slug → 定義。見つからなければ undefined */
export const findWork = (slug) => WORKS.find((w) => w.slug === slug);
