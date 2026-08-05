// ============================================================
//  pose-store.js — Supabase への参照ポーズ保存・読み込み
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE, DEFAULT_KANA_LINES } from './config.js';

const supabase = createClient(SUPABASE.url, SUPABASE.anonKey);

/**
 * 参照ポーズをすべて読み込む。
 * @returns {Promise<{poses:Object, lines:Object}>}
 *   poses[字] = 正規化座標、lines[字] = 一筆書き記述（DB→既定→空の順で解決）
 */
export async function loadReferencePoses() {
  const { data, error } = await supabase.from('poses').select('*');
  if (error) throw error;

  const poses = {};
  const lines = {};
  for (const row of data) {
    poses[row.letter] = row.points;
    lines[row.letter] = row.lines || DEFAULT_KANA_LINES[row.letter] || [];
  }
  return { poses, lines };
}

/**
 * 1字ぶんの参照ポーズを登録する。
 * 既定の一筆書きがある字なら lines も一緒に保存する。
 * @param {string} letter
 * @param {Object} points 正規化済みの部位座標
 */
export async function savePose(letter, points) {
  const record = { letter, points };
  if (DEFAULT_KANA_LINES[letter]) record.lines = DEFAULT_KANA_LINES[letter];

  const { error } = await supabase.from('poses').insert([record]);
  if (error) throw error;
}
