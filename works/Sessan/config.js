// ============================================================
//  config.js — Sessan（空中タイピング）設定
//  指の本数で「行」、口形（母音）で「段」を選び、静止保持で確定する。
//  目を閉じると1字削除、グー保持で濁点／半濁点。
//  しきい値と口形ターゲットは手調整済みの値。安易に変えないこと。
// ============================================================

export const CAMERA = Object.freeze({ width: 640, height: 480 });

/** 各操作を確定するまでの保持フレーム数 */
export const HOLD_FRAMES = Object.freeze({ char: 22, backspace: 25, modifier: 30 });

/** 五十音表（行 × 段）。指の本数-1 が行、母音インデックスが段 */
export const GOJUON = Object.freeze([
  ['あ', 'い', 'う', 'え', 'お'],
  ['か', 'き', 'く', 'け', 'こ'],
  ['さ', 'し', 'す', 'せ', 'そ'],
  ['た', 'ち', 'つ', 'て', 'と'],
  ['な', 'に', 'ぬ', 'ね', 'の'],
  ['は', 'ひ', 'ふ', 'へ', 'ほ'],
  ['ま', 'み', 'む', 'め', 'も'],
  ['や', '（い）', 'ゆ', '（え）', 'よ'],
  ['ら', 'り', 'る', 'れ', 'ろ'],
  ['わ', 'を', 'ん', 'ー', ' '],
]);

/** 行名（HUD 表示用） */
export const GYO_NAMES = Object.freeze(['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ']);

/** 濁点・半濁点の変換表 */
export const DAKUTEN = Object.freeze({
  か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご',
  さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ',
  た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど',
  は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ',
});
export const HANDAKUTEN = Object.freeze({ は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' });

/**
 * 母音ごとの口形ターゲット。
 *   area   … 口腔（内唇リング）の面積 / 顔サイズ²
 *   aspect … 口の縦幅 / 横幅
 * 先行研究（MouthType CHI2004 / Saitoh 2007 / KUCHIMOJI 2026）が母音判別に
 * 有効としている「面積 + 縦横比」に合わせた特徴量。
 *
 * 値は、以前の手調整値（縦開き比 v / 横幅比 h）から
 * aspect = v/h、area ≒ (π/4)·v·h として換算した出発点。
 * ただし閉唇は、内唇リングが潰れて面積がほぼゼロになるので実態に合わせて小さくしてある。
 * ここは目安であって、実際に合わせるのは画面の「較正」（calibration.js）のほう。
 */
export const VOWEL_TARGETS = Object.freeze({
  close: { area: 0.004, aspect: 0.06 },
  あ: { area: 0.098, aspect: 0.50 },
  い: { area: 0.026, aspect: 0.08 },
  う: { area: 0.017, aspect: 0.17 },
  え: { area: 0.061, aspect: 0.22 },
  お: { area: 0.059, aspect: 0.43 },
});

/**
 * 顔の近さ → 確定中の字の大きさ。
 * 近さは analyzeFace が返す proximity（左右の目尻の間隔。画面幅を 1 とした値）。
 * far〜near を minPx〜maxPx へ写す。単位とレンジを揃えるだけの前提値なので、
 * 素直な初期値を置いてある。合わなければここを直す。
 */
export const PROXIMITY = Object.freeze({
  far: 0.10, near: 0.32,
  minPx: 240, maxPx: 620,
});

/**
 * 確定中の字の見え方。
 * 字は縦の短冊に切り、心拍の位相で一本ずつ上下にずらす（renderer.js）。
 * 薄く大きく重ねるので、映像の上に乗っても顔を隠さない。
 */
export const GLYPH = Object.freeze({
  family: '"Hiragino Mincho ProN", "Hiragino Mincho Pro", serif',
  /** 縦に切る短冊の本数 */
  slices: 16,
  /** 左端から右端までに乗る波の数。1 未満だと字全体が一方向に傾く */
  waveTurns: 1.25,
  /** 字の大きさに対する上下ずれの最大値 */
  shiftRatio: 0.11,
  /** 脈の谷でも残すずれの割合。0 にすると拍の合間にぴたりと揃う */
  pulseFloor: 0.30,
  /** 不透明度 — 選んだ直後 → 確定直前 */
  alphaMin: 0.14,
  alphaMax: 0.46,
  /** 縁に敷く地色の暈し。字の大きさに対する比。映像の上で字が沈まないための下支え */
  haloRatio: 0.035,
  /** 記録に焼き付けるときの不透明度。画面は薄いが、記録は形を見るものなので濃くする */
  recordAlpha: 1,
});

/**
 * 心拍の代役（heartbeat.js）の設定。まだセンサが無いので合成波で動かす。
 *
 * 揺れの大きさは**作る側の裁量ではなく、身体の状態で決まる**。
 * 5分ぶん回して拍間隔から測った値を添えてある（SDNN / RMSSD は HRV の代表的な指標）。
 *
 * | preset | 平均 | bpm範囲 | SDNN | RMSSD |
 * |---|---|---|---|---|
 * | `focus` | 84 | 78–89 | 24ms | 15ms |
 * | `rest`  | 68 | 62–75 | 38ms | 31ms |
 * | `loose` | 68 | 56–80 | 75ms | 48ms |
 *
 * 既定は `focus`。**Sessan を使っている人は安静ではない**からで、
 * 手を上げ、口の形を作り、見られながら集中している。
 * この状態では心拍は上がり、揺れ（HRV）はむしろ小さくなる。
 * `loose` は見た目の揺れを稼ぐための値で、座った人の生理としては過剰。
 */
const HEARTBEAT_VALUES = {
  focus: {
    baseBpm: 84,
    /** [下限, 上限] — この外には出さない */
    bpmRange: [72, 104],
    /** 呼吸性洞性不整脈。0.22Hz ≒ 13回/分の呼吸 */
    respRateHz: 0.22,
    respAmpBpm: 1.8,
    /** 数十秒スケールのゆっくりした漂い */
    wanderHz: 0.017,
    wanderAmpBpm: 3.5,
    /** 拍ごとの細かいゆらぎ（ランダムウォークの強さ） */
    jitterBpm: 0.6,
    /** ゆらぎが中心へ戻るまでの時定数[秒] */
    jitterDecaySec: 3,
  },
  rest: {
    baseBpm: 68, bpmRange: [54, 96],
    respRateHz: 0.22, respAmpBpm: 3.0,
    wanderHz: 0.017, wanderAmpBpm: 3.0,
    jitterBpm: 0.8, jitterDecaySec: 3,
  },
  loose: {
    baseBpm: 68, bpmRange: [54, 96],
    respRateHz: 0.22, respAmpBpm: 4.5,
    wanderHz: 0.017, wanderAmpBpm: 7.0,
    jitterBpm: 1.2, jitterDecaySec: 3,
  },
};

export const HEARTBEAT_PRESETS = Object.freeze({
  focus: Object.freeze({ label: '集中して入力している', values: Object.freeze(HEARTBEAT_VALUES.focus) }),
  rest: Object.freeze({ label: '落ち着いて座っている', values: Object.freeze(HEARTBEAT_VALUES.rest) }),
  loose: Object.freeze({ label: '揺れを大きく（生理的には過剰）', values: Object.freeze(HEARTBEAT_VALUES.loose) }),
});

/** 既定のプリセット。理由は上の表のとおり */
export const HEARTBEAT = HEARTBEAT_PRESETS.focus.values;

/**
 * 確認用ページ（`_preview-glyph.html`）で詰めた値の置き場。
 * **本番も起動時にここを読む**ので、プレビューと画面が同じ値で動く。
 * 消し方はプレビュー側の ↺。詳しくは tuning.js。
 */
export const TUNING = Object.freeze({
  glyphKey: 'sessan.glyph.v1',
  heartKey: 'sessan.heartbeat.v1',
  /** プレビュー自身の操作状態（プリセット名など）。本番は読まない */
  previewKey: 'sessan.preview.v1',
});

/**
 * 較正の設定。あ・い・う・え・お を順に holdMs だけ保持して、
 * その間の (area, aspect) の平均を各母音のターゲットにする。
 * 閉唇は口を閉じれば面積がほぼゼロになるので、既定値のまま使う。
 */
export const CALIBRATION = Object.freeze({
  vowels: ['あ', 'い', 'う', 'え', 'お'],
  /** 口を作る時間（この間は取り込まない） */
  readyMs: 800,
  /** 取り込む時間。この間の平均をターゲットにする */
  holdMs: 1000,
  storageKey: 'sessan.vowelTargets.v1',
});

/** 目の開閉ターゲット（縦横比） */
export const EYE_TARGETS = Object.freeze({ open: 0.30, close: 0.15 });

/** MediaPipe Holistic のオプション */
export const HOLISTIC_OPTIONS = Object.freeze({
  modelComplexity: 1,
  refineFaceLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

/**
 * スナップショット記録の設定。
 * 文字を確定するたびに出力フレームを縮小して画面内に記録する（保存はしない）。
 */
export const SNAPSHOT = Object.freeze({
  thumbWidth: 160, // 高さは実映像のアスペクト比から自動算出（サムネを歪ませない）
  jpegQuality: 0.7,
  maxEntries: 240, // これを超えたら古いものから捨てる（メモリ保護）
});
