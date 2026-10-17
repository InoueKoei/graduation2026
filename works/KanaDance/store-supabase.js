// ============================================================
//  store-supabase.js — Supabase への参照ポーズ保存・読み込み
//  クライアントは動的 import で取る。ローカル版ではこのファイルごと読まれないので、
//  ネットの無い環境で Supabase を取りに行ってしまうことがない。
// ============================================================

import { RUNTIME } from './runtime-config.js';
import { DEFAULT_KANA_LINES } from './config.js';

let client = null;

async function getClient() {
  if (client) return client;
  const { createClient } = await import(RUNTIME.supabaseClient);
  client = createClient(RUNTIME.supabase.url, RUNTIME.supabase.anonKey);
  return client;
}

/**
 * 参照ポーズをすべて読み込む。
 * @returns {Promise<{poses:Object, lines:Object}>}
 */
export async function loadReferencePoses() {
  const supabase = await getClient();
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

/** 1字ぶんの参照ポーズを登録する */
export async function savePose(letter, points) {
  const supabase = await getClient();
  const record = { letter, points };
  if (DEFAULT_KANA_LINES[letter]) record.lines = DEFAULT_KANA_LINES[letter];

  const { error } = await supabase.from('poses').insert([record]);
  if (error) throw error;
}
