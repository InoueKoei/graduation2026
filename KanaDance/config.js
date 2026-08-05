// ============================================================
//  config.js — KanaDance 設定
//  身体ポーズをかな字形へ翻訳する（kinesics.regular のかな版）。
// ============================================================

export const APP_CONFIG = Object.freeze({
  video: { width: 1280, height: 720 },
  /** これ未満の平均正規化誤差なら「一致」とみなす（小さいほど厳しい）。実運用では 1.0 前後が目安 */
  matchThreshold: 1.0,
  /** 線データが無い字を大きく半透明表示するときのフォントサイズ */
  fontSize: 500,
  line: { color: '#ffffff', width: 15 },
  dotColor: '#00ffcc',
  jointRadius: 8,
});

/** MediaPipe Pose ランドマーク番号 → 使用する部位名 */
export const LANDMARK_INDICES = Object.freeze({
  head: 0,
  l_hand: 15, r_hand: 16,
  l_elbow: 13, r_elbow: 14,
  l_knee: 25, r_knee: 26,
  l_leg: 27, r_leg: 28,
});

/** 腰＝左右の腰の中点、スケール基準＝両肩間の距離 */
export const POSE_REF = Object.freeze({ hipL: 23, hipR: 24, shoulderL: 11, shoulderR: 12 });

/** 線記述で使う略語 → 部位名 */
export const SHORTCUTS = Object.freeze({
  H: 'head', W: 'waist',
  LH: 'l_hand', RH: 'r_hand',
  LE: 'l_elbow', RE: 'r_elbow',
  LK: 'l_knee', RK: 'r_knee',
  LL: 'l_leg', RL: 'r_leg',
});

/**
 * 既定の一筆書き。DB に lines が無い字はこれを使う。
 *   "LH-RH"      … 左手→右手を結ぶ
 *   "[LH_RH]-W"  … 左手と右手の中点→腰
 *   "RE-RK-RL"   … 右肘→右膝→右足（連続線）
 */
export const DEFAULT_KANA_LINES = Object.freeze({
  ア: ['LH-RH', 'H-W', 'W-LL'],
  イ: ['H-W', 'RE-W', 'W-RL'],
  サ: ['LH-RH', '[LH_RH]-W', 'RE-RK-RL'],
});

/**
 * Supabase 接続情報。
 * anonKey は「クライアントに埋め込む前提」の公開キー。
 * 実データの保護は Supabase 側の Row Level Security(RLS) で行う。
 */
export const SUPABASE = Object.freeze({
  url: 'https://aawkwvxyylioorbeyydx.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhd2t3dnh5eWxpb29yYmV5eWR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0MzEzMTYsImV4cCI6MjA5NTAwNzMxNn0.WWdP8PD0fGA-kqidf4kLGilYAfGBTGVdnKc9w5oQ9gA',
});
