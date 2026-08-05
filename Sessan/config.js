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

/** 母音ごとの口形ターゲット（v=縦開き比, h=横幅比） */
export const VOWEL_TARGETS = Object.freeze({
  close: { v: 0.05, h: 0.50 },
  あ: { v: 0.25, h: 0.50 },
  い: { v: 0.05, h: 0.65 },
  う: { v: 0.06, h: 0.35 },
  え: { v: 0.13, h: 0.60 },
  お: { v: 0.18, h: 0.42 },
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
