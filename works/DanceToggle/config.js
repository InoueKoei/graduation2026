// ============================================================
//  config.js — DanceToggle（ダンスマットで踏むトグル入力）設定
//
//  ケータイのトグル（かなめくり）入力を、マット配置を 180°反転させた盤面で
//  足に置き換える。指のタップが足の踏み込みになり、「あ」は1回、「お」は5回踏む。
//
//  マットの実測仕様は usb-dance-mat-knowledge.md（同ディレクトリ）を参照。
//  ボタン番号・軸の対応はそこからの引用で、推測は入っていない。
// ============================================================

// ── マットの読み取り ────────────────────────────────────────

/**
 * Gamepad API のボタン番号。ナレッジ 3章「macOS / Chrome Gamepad API mapping」の実測表そのまま。
 * 中央パネルだけはボタンではなく軸に出るので、ここには入れず CENTER_AXIS で見る。
 */
export const BUTTON = Object.freeze({
  left: 0, down: 1, up: 2, right: 3,
  square: 4, triangle: 5, cross: 6, circle: 7,
  select: 8, start: 9,
});

/**
 * 中央パネル。押すと axes[1] が 1.0 になる（生 HID では data[1] の最上位ビット）。
 * 軸は静止時 0 付近でも微小に揺れるので、素の != 0 ではなくしきい値で見る。
 */
export const CENTER_AXIS = Object.freeze({ index: 1, threshold: 0.5 });

/**
 * 対象パッドの絞り込み。ナレッジ 13章の判定を踏襲。
 * ブラウザによって id の綴りが違う（"STANDARD GAMEPAD Vendor: 0079 Product: 0006" など）ので
 * 製品名と VID/PID の3通りを OR で見る。どれにも当たらなければ「最初に見つかったパッド」に落とす。
 */
export const PAD_HINTS = Object.freeze(['usb joystick', 'vendor: 0079', 'product: 0006']);

// ── マット ⇄ かな の割り当て ────────────────────────────────

/**
 * ケータイ配列をもとにしつつ、**中央は文字に使わない**。
 *
 * ダンスマットの中央は立って休む場所で、ここを文字にすると休むたび・戻るたびに
 * 1字打たれてしまう。踏みっぱなしを1回に抑えても「戻るたびに出る」のは避けられないので、
 * 面ごと空けて home にしてある。
 *
 * 空けたぶんは**後ろの行を1つずつ繰り上げる**。読み順（左上から右へ、上から下へ）に
 * あ→か→さ→た→な→は→ま→や→ら→わ と並べ、中央だけ飛ばす。
 * 五十音の順がそのまま残るので、中央を抜いたことを覚えていれば読める。
 *
 *   あ  か  さ        （□  ↓  △）
 *   た （休）な       （→  ●  ←）
 *   は  ま  や        （○  ↑  ✕）
 *   ら      わ        （START  --  SELECT）
 *
 * 濁点・半濁点・小文字は、空けた中央の**2度踏み**に移してある
 * （home にいながらその場で踏み直すだけなので、動作としては一番軽い）。
 *
 * ここを ROW_LAYOUT.normal に差し替えれば反転をやめて通常配置でも踏める。
 * どちらが身体に馴染むかは実機で比べたいので、両方残してある。
 */
export const ROW_LAYOUT = Object.freeze({
  // 180°反転（既定）。マットに立った人から見た読み順に並べ、中央だけ飛ばす
  reversed: Object.freeze({
    square: 'あ', down: 'か', triangle: 'さ',
    right: 'た', /* center は home */ left: 'な',
    circle: 'は', up: 'ま', cross: 'や',
    start: 'ら', select: 'わ',
  }),
  // 反転なし。マット表面の印刷そのままの読み順に並べ、中央だけ飛ばす
  normal: Object.freeze({
    cross: 'あ', up: 'か', circle: 'さ',
    left: 'た', /* center は home */ right: 'な',
    triangle: 'は', down: 'ま', square: 'や',
    start: 'ら', select: 'わ',
  }),
});

/** いま使う配置 */
export const MAT_TO_ROW = ROW_LAYOUT.reversed;

/**
 * 中央パネル。**文字には使わない**。立って休む場所（home）。
 *
 * 1回踏んだだけでは何も起きない。**2度踏む**と濁点・半濁点・小文字になる。
 * home にいながらその場で踏み直すだけなので、動作としては一番軽い。
 * 濁点は頻度が高いので、ここに割り当てている。
 */
export const HOME_KEY = 'center';

/**
 * 盤面を画面に描くときの並び。
 *
 * マットは **180°回して床に置く**（ケーブル側が奥）。踏む人から見た並びは
 * マット表面の印刷とは上下左右が逆になるので、画面もその向きで描く。
 * 結果として、盤面はケータイのテンキーとそのまま同じ並びになる。
 *
 *   あ か さ     （□  ↓  △）
 *   た な は     （→  ●  ←）
 *   ま や ら     （○  ↑  ✕）
 *   わ  --  ゛゜小（START -- SELECT）
 *
 * 記号はマットに印刷されているものを各面に付けたまま動かす。
 * 「画面のこのマスは、足元のこの印のパネル」と照合できるようにするため。
 */
export const PANEL_GRID = Object.freeze([
  Object.freeze([{ key: 'square', mark: '□' }, { key: 'down', mark: '↓' }, { key: 'triangle', mark: '△' }]),
  Object.freeze([{ key: 'right', mark: '→' }, { key: 'center', mark: '●' }, { key: 'left', mark: '←' }]),
  Object.freeze([{ key: 'circle', mark: '○' }, { key: 'up', mark: '↑' }, { key: 'cross', mark: '✕' }]),
  Object.freeze([{ key: 'start', mark: 'START' }, null, { key: 'select', mark: 'SELECT' }]),
]);

// ── 母音マット（二人モード用の2台目） ──────────────────────

/**
 * 母音マットも**子音マットと同じく 180°回して床に置く**（二人とも同じ向きで乗る）。
 * 画面も踏む人から見た向きで描くので、盤面は読み順のまま あ い う / え ・ お と並ぶ。
 *
 *   マット物理配置        踏む人から見た向き（＝画面）
 *   ×   ↑   ○              □   ↓   △        あ  い  う
 *   ←  CTR  →        →     →  CTR  ←   ＝   え （空）お
 *   △   ↓   □              ○   ↑   ✕       （使わない）
 *
 * 中央を空けてあるのは、あ行5つを上段3つと中段の左右に散らして足を大きく運ばせるため。
 * 中央に置くと母音側がほとんど動かなくなる。
 *
 * 回さずに置きたくなったら MAT_TO_VOWEL を VOWEL_LAYOUT.normal に差し替え、
 * VOWEL_PANEL_GRID を RAW_PANEL_GRID にする。
 */
export const VOWEL_LAYOUT = Object.freeze({
  // 180°反転（既定）。マットを回して置き、踏む人から見て読み順に並ぶ
  reversed: Object.freeze({
    square: 'あ', down: 'い', triangle: 'う',
    right: 'え', left: 'お',
  }),
  // 回さず正の向きに置く場合。マット表面の印刷そのままの読み順
  normal: Object.freeze({
    cross: 'あ', up: 'い', circle: 'う',
    left: 'え', right: 'お',
  }),
});

/** いま使う母音の配置 */
export const MAT_TO_VOWEL = VOWEL_LAYOUT.reversed;

/**
 * マットを回さずに置いたときの並び（＝マット表面の印刷そのまま）。
 * 母音マットを正の向きで使うときはこちらを VOWEL_PANEL_GRID に据える。
 */
export const RAW_PANEL_GRID = Object.freeze([
  Object.freeze([{ key: 'select', mark: 'SELECT' }, null, { key: 'start', mark: 'START' }]),
  Object.freeze([{ key: 'cross', mark: '✕' }, { key: 'up', mark: '↑' }, { key: 'circle', mark: '○' }]),
  Object.freeze([{ key: 'left', mark: '←' }, { key: 'center', mark: '●' }, { key: 'right', mark: '→' }]),
  Object.freeze([{ key: 'triangle', mark: '△' }, { key: 'down', mark: '↓' }, { key: 'square', mark: '□' }]),
]);

/**
 * 母音マットの盤面。子音マットと同じ向きに置くので、並びも同じ PANEL_GRID を使う。
 * 盤面の並びは「どの物理パネルが画面のどこに出るか」だけの話なので、
 * 同じ向きに置いた2台なら同じで正しい。
 */
export const VOWEL_PANEL_GRID = PANEL_GRID;

/**
 * 子音（行）× 母音 → かな。
 *
 * 表に無い組み合わせ（や行のい・え、わ行のい・え）は成立しない。
 * 既存作 works/boin-shiin-mvp の KANA 表と同じ扱い。
 *
 * **「ん」だけは決め打ち。** 現代かなでは わ行の「う」の段が空いているので、
 * そこに「ん」を置いた。これは五十音図から導いたものではなく、
 * 置かないと「ん」がどうやっても打てなくなるので入れた選択。気に入らなければここを消す。
 */
export const DUO_KANA = Object.freeze({
  あ: Object.freeze({ あ: 'あ', い: 'い', う: 'う', え: 'え', お: 'お' }),
  か: Object.freeze({ あ: 'か', い: 'き', う: 'く', え: 'け', お: 'こ' }),
  さ: Object.freeze({ あ: 'さ', い: 'し', う: 'す', え: 'せ', お: 'そ' }),
  た: Object.freeze({ あ: 'た', い: 'ち', う: 'つ', え: 'て', お: 'と' }),
  な: Object.freeze({ あ: 'な', い: 'に', う: 'ぬ', え: 'ね', お: 'の' }),
  は: Object.freeze({ あ: 'は', い: 'ひ', う: 'ふ', え: 'へ', お: 'ほ' }),
  ま: Object.freeze({ あ: 'ま', い: 'み', う: 'む', え: 'め', お: 'も' }),
  や: Object.freeze({ あ: 'や',            う: 'ゆ',            お: 'よ' }),
  ら: Object.freeze({ あ: 'ら', い: 'り', う: 'る', え: 'れ', お: 'ろ' }),
  わ: Object.freeze({ あ: 'わ',            う: 'ん',            お: 'を' }),
});

/**
 * 前の字を打ち終えてから踏みはじめるまでの間隔 → 字の大きさ。
 *
 * 測るのは**踏んでいない時間**。迷い・探り・立ち止まりがそのまま字の大きさになる。
 * 「その字を出すのにかかった時間」ではないので、「お」（5回踏む）も「あ」（1回）も、
 * 迷わず踏めば同じ大きさになる。行の位置ではなく、ためらいを出すための値。
 *
 * Generative Gestaltung P_3_1_1_01 と同じ考え方（あちらは打鍵と打鍵の間隔を
 * 0〜5000ms → 15〜800px に写している）。こちらは足なので下限を上げてある。
 *
 * minMs を 200 にしてあるのは、マットは面から面へ足を運ぶだけで 400ms 前後かかるため。
 * 0 を基準にすると、普通に踏んでいるだけの字まで中くらいの大きさになってしまう。
 * maxMs の外側は頭打ち。青天井にすると放置した1字だけで画面が埋まる。
 */
export const TIME_SIZE = Object.freeze({
  minMs: 200,    // これ以下は最小。面から面へ運ぶだけならこのあたり
  maxMs: 2500,   // これ以上は最大。足で2.5秒止まればもう十分「迷っている」
  minScale: 0.5,
  maxScale: 3.0,
  /** タイムアタックでも打ち終えた字に効かせるか */
  inGame: true,
});

/**
 * 二人の入力のずれ → ぼかし。
 *
 * 既存作 works/boin-shiin-mvp と同じ作り方。
 * ずれ ÷ 許容ずれ（pairMs）の比をそのままぼかし量に写す。
 * 0.22em も向こうで決めた値をそのまま持ってきている。
 */
export const DUO_BLUR = Object.freeze({ maxEm: 0.22 });

/**
 * 二人のずれの「見せ方」。画面から切り替えられる。
 *
 *   blur  … ずれるほどぼける（既定）
 *   slice … 字を**横の短冊**に切り、ずれるほど一本ずつ左右にずらす
 *
 * 短冊は既存作 works/Sessan の renderer.js と同じ仕掛け。
 * あちらは縦に切って上下へ、心拍の位相でずらしていた。
 * こちらは横に切って左右へ、**二人のずれ**で振幅を決める。
 */
export const SHIFT_MODES = Object.freeze({ blur: 'ぼかし', slice: '短冊' });
export const DEFAULT_SHIFT_MODE = 'blur';

export const DUO_SLICE = Object.freeze({
  /** 横に切る本数。多いほど細かく割れるが、字が読めなくなる */
  count: 9,
  /**
   * ずれが許容いっぱい（pairMs）のときの、左右ずれの最大値。字の大きさに対する比。
   * Sessan の shiftRatio 0.11 は縦ずれだったが、こちらは横に逃がすので大きめに取れる。
   */
  maxShiftEm: 0.34,
  /**
   * 上端から下端までに乗る波の数。
   * 1 未満だと字全体が一方向に傾き、1 以上だとジグザグに割れる。
   * Sessan の waveTurns と同じ意味。
   */
  waveTurns: 1.25,
});

/** 二人モードの設定 */
export const DUO = Object.freeze({
  /**
   * 子音と母音がそろったとみなす許容時間差。
   *
   * 1500ms は既存作 works/boin-shiin-mvp で実際に二人で打って決めた値。
   * あちらは指（キーボードとマクロパッド）だったので、足ならもっと要るかもしれない。
   * 片方だけ踏まれてこの時間が過ぎたら、その踏みは捨てる。
   */
  pairMs: 1500,
  /** 成立しない組み合わせ（や行のい など）を見せておく時間 */
  rejectFlashMs: 700,
});

export const DUO_RANGE = Object.freeze({
  pairMs: Object.freeze({ min: 300, max: 4000, step: 50 }),
});

// ── トグルの環 ──────────────────────────────────────────────

/**
 * 踏んだ回数で回る環。1回目が [0]、5回目が [4]、6回目でまた [0] に戻る。
 *
 * や行は3字（ケータイと同じ。ゃゅょ は SELECT で出す）。
 * わ行は「わ・を・ん・ー」の4字。ケータイでは末尾に「〜」も入るが、
 * 句読点を落とした方針に合わせて記号は「ー」までにしてある。
 */
export const RINGS = Object.freeze({
  あ: Object.freeze(['あ', 'い', 'う', 'え', 'お']),
  か: Object.freeze(['か', 'き', 'く', 'け', 'こ']),
  さ: Object.freeze(['さ', 'し', 'す', 'せ', 'そ']),
  た: Object.freeze(['た', 'ち', 'つ', 'て', 'と']),
  な: Object.freeze(['な', 'に', 'ぬ', 'ね', 'の']),
  は: Object.freeze(['は', 'ひ', 'ふ', 'へ', 'ほ']),
  ま: Object.freeze(['ま', 'み', 'む', 'め', 'も']),
  や: Object.freeze(['や', 'ゆ', 'よ']),
  ら: Object.freeze(['ら', 'り', 'る', 'れ', 'ろ']),
  わ: Object.freeze(['わ', 'を', 'ん', 'ー']),
});

/**
 * SELECT で回る変種の環。踏むたびに次へ進み、最後まで行くと元の字に戻る。
 *
 * ケータイには「濁点/半濁点/小文字」が別キーで並ぶ機種もあるが、
 * こちらはパネルが1枚しかないので iOS の `^^` と同じく**ひとつの環にまとめる**。
 * は行だけ3段（は→ば→ぱ→は）、つ・う は濁点と小文字の両方があるので3段になる。
 *
 * 変換の中身は works/Sessan/config.js の DAKUTEN / HANDAKUTEN と
 * works/MojiHakobi/public/kana.js の VOICED から起こしたもの。
 * ここに無い字（ん・ー・ら行など）は SELECT を踏んでも何も起きない。
 */
export const MARK_RING = Object.freeze({
  あ: Object.freeze(['あ', 'ぁ']),
  い: Object.freeze(['い', 'ぃ']),
  う: Object.freeze(['う', 'ぅ', 'ゔ']),
  え: Object.freeze(['え', 'ぇ']),
  お: Object.freeze(['お', 'ぉ']),

  か: Object.freeze(['か', 'が']), き: Object.freeze(['き', 'ぎ']), く: Object.freeze(['く', 'ぐ']),
  け: Object.freeze(['け', 'げ']), こ: Object.freeze(['こ', 'ご']),

  さ: Object.freeze(['さ', 'ざ']), し: Object.freeze(['し', 'じ']), す: Object.freeze(['す', 'ず']),
  せ: Object.freeze(['せ', 'ぜ']), そ: Object.freeze(['そ', 'ぞ']),

  た: Object.freeze(['た', 'だ']), ち: Object.freeze(['ち', 'ぢ']),
  つ: Object.freeze(['つ', 'づ', 'っ']),
  て: Object.freeze(['て', 'で']), と: Object.freeze(['と', 'ど']),

  は: Object.freeze(['は', 'ば', 'ぱ']), ひ: Object.freeze(['ひ', 'び', 'ぴ']),
  ふ: Object.freeze(['ふ', 'ぶ', 'ぷ']), へ: Object.freeze(['へ', 'べ', 'ぺ']),
  ほ: Object.freeze(['ほ', 'ぼ', 'ぽ']),

  や: Object.freeze(['や', 'ゃ']), ゆ: Object.freeze(['ゆ', 'ゅ']), よ: Object.freeze(['よ', 'ょ']),

  わ: Object.freeze(['わ', 'ゎ']),
});

// ── タイミング ──────────────────────────────────────────────

/**
 * 足は指より1ストロークが遅い。ケータイのトグルは確定まで 800ms 前後だが、
 * ここは 1000ms から始める。速い人には長すぎるはずなので画面のスライダで詰める。
 * 実機で決めた値は README に理由ごと書き戻すこと。
 */
export const TIMING = Object.freeze({
  /**
   * 面を踏んでから入力として受け付けるまでの「溜め」。
   *
   * マットは面が隣り合っているので、次の面へ足を運ぶ途中で通過した面も踏まれてしまう。
   * 通過は短く、入力のために乗るのは長い。この差で切り分ける。
   * ここに届く前に足が離れた面は、通過だったとみなして捨てる。
   *
   * 250ms は「着地して乗る」（実測でおおむね 200〜400ms 接触が続く）と
   * 「歩いて通過する」（80〜150ms）の間を取った出発点。実機で詰めること。
   * 0 にすると踏んだ瞬間に入る（この機能を切るのと同じ）。
   */
  holdMs: 250,
  /**
   * 同じ面をもう一度踏むときの溜め。**新規より短くてよい。**
   *
   * 溜めが要るのは移動があるからで、通過してしまう面があるのは
   * 「別の面へ足を運ぶ」ときだけ。同じ面を踏み直しているあいだは足がそこから動いておらず、
   * 通過の危険がない。ここに新規と同じ溜めを掛けるのは、払わなくていいコストになる。
   *
   * 効きは大きい。「お」は5回踏むので、全部 250ms なら 1250ms かかるところが、
   * 250 + 4×80 = 570ms で済む。
   *
   * その場の小さな跳びは接地が 100ms 前後なので、それより短い 80ms を出発点にした。
   */
  repeatHoldMs: 80,
  /**
   * 中央（home）を2度踏みとみなす猶予。
   *
   * 1度目と2度目のあいだに**他の面が1つでも受け付けられたら成立しない**。
   * 「その場で2回踏む」だけを拾いたいので、時間だけでなく
   * 「連続していること」も条件にしている。
   * これが無いと、よそを踏んで中央へ戻ってきただけで濁点が出てしまう。
   *
   * 2度目は踏み直しなので短い溜め（repeatHoldMs）で通る。
   * 250 + 80 に足の運びを足して 900ms を出発点にした。
   */
  homeDoubleMs: 900,
  /** 最後の踏みからこの時間が過ぎたら未確定の1字を確定する */
  commitMs: 1000,
  /**
   * 離してからこの時間内の再踏みは同一ストロークとみなす。
   * マットは接点が金属箔なので、着地の衝撃で ON/OFF が数ミリ秒で往復する（チャタリング）。
   * これを入れないと1回のジャンプが2回に数えられて「あ」を狙って「い」が出る。
   */
  releaseDebounceMs: 60,
  /**
   * SELECT+START を「同時」とみなす猶予。両足で踏むので完全同時にはならず、
   * 片足ずつ 50〜150ms ずれる。
   *
   * holdMs の溜めがこの窓を兼ねるので、holdMs がこの値以上なら追加の待ちは発生しない
   * （片方の溜めが満ちる頃には相方がもう足の下にある）。
   * holdMs を 0 にしたときだけ、ここの時間だけ相方を待つ。
   */
  bothMs: 180,
});

/**
 * スライダの可動域。極端な値でロジックが壊れないための上下限も兼ねる。
 *
 * holdMs の上限を 1500ms と広く取ってあるのは、実機でどこまで伸ばすと
 * 通過を拾わなくなるかを踏んで確かめるため。ただし伸ばすほど1字が重くなる
 * （「お」は5回踏むので、holdMs 分がそのまま5倍で効く）。
 * commitMs は holdMs より短いと、次を踏む前に勝手に確定してしまうので、
 * holdMs を上げたら commitMs も一緒に上げること。
 */
export const TIMING_RANGE = Object.freeze({
  holdMs: Object.freeze({ min: 0, max: 1500, step: 25 }),
  homeDoubleMs: Object.freeze({ min: 200, max: 2000, step: 50 }),
  repeatHoldMs: Object.freeze({ min: 0, max: 600, step: 10 }),
  commitMs: Object.freeze({ min: 400, max: 5000, step: 50 }),
  releaseDebounceMs: Object.freeze({ min: 0, max: 300, step: 10 }),
});

// ── キーボード代替 ──────────────────────────────────────────

/**
 * マットが手元に無くても全機能を確認できるようにする代替キー。
 * 反転盤面の 3x3 をそのまま q/w/e・a/s/d・z/x/c に写す（見た目と指の位置が一致する）。
 * 1=SELECT、2=START。この2つを同時に押せば削除も試せる。
 *
 * 展示のときは切っておく（誤爆防止）。画面の設定パネルから on/off できる。
 */
export const KEYBOARD_FALLBACK = Object.freeze({
  // 子音マット（スロット0）— **画面の盤面と同じ並び**を指に写す。
  //   q w e  =  あ  か  さ
  //   a s d  =  た （休）な     s は中央＝home。2度押しで濁点
  //   z x c  =  は  ま  や
  //   1 = わ行（SELECT）  2 = ら行（START）
  KeyQ: Object.freeze([0, 'square']), KeyW: Object.freeze([0, 'down']), KeyE: Object.freeze([0, 'triangle']),
  KeyA: Object.freeze([0, 'right']), KeyS: Object.freeze([0, 'center']), KeyD: Object.freeze([0, 'left']),
  KeyZ: Object.freeze([0, 'circle']), KeyX: Object.freeze([0, 'up']), KeyC: Object.freeze([0, 'cross']),
  Digit1: Object.freeze([0, 'select']), Digit2: Object.freeze([0, 'start']),

  // 母音マット（スロット1）— 同じく画面どおり。二人モードでしか効かない
  //   u i o  =  あ い う
  //   j   l  =  え    お
  KeyU: Object.freeze([1, 'square']), KeyI: Object.freeze([1, 'down']), KeyO: Object.freeze([1, 'triangle']),
  KeyJ: Object.freeze([1, 'right']), KeyL: Object.freeze([1, 'left']),
});

// ── モード ──────────────────────────────────────────────────

/**
 * free  … 自由に打つ
 * game  … タイムアタック。決められた数のお題を全部打ち切るまでのタイムを計る
 *
 * 分岐は script.js のイベント配線だけ。mat.js は何も知らず、
 * toggle-core.js も「お題の字」を1つ受け取るだけで、ゲームの進行は game.js に閉じている。
 */
export const MODES = Object.freeze({ free: 'フリー入力', game: 'タイムアタック', duo: '二人' });
export const DEFAULT_MODE = 'free';

/** タイムアタックの設定 */
export const GAME = Object.freeze({
  /**
   * 1回で出すお題の数。
   * 足で踏むので1字が重い。5文（およそ50字）で、慣れた人が1〜2分というあたりを見込んでいる。
   * 展示で回転が悪ければ減らす。
   */
  phrasesPerRun: 5,
  /** ミスした面を赤く見せる時間 */
  missFlashMs: 260,
});

/**
 * モードごとに要るマットの台数。
 * 二人モードだけ2台（スロット0＝子音／スロット1＝母音）。
 * 2台とも同じ VID/PID なので区別は Gamepad の index 順しかなく、
 * どちらが子音側になるかは USB の列挙順まかせ。画面から入れ替えられるようにしてある。
 */
export const MODE_SLOTS = Object.freeze({ free: 1, game: 1, duo: 2 });

/** 設定の保存先（localStorage）。既存作品と同じく作品名 + 用途 + バージョンで切る */
export const STORAGE_KEY = 'dancetoggle.settings.v1';
