// ============================================================
//  store-supabase.js — Supabase への参照ポーズ保存・読み込み
//  クライアントは動的 import で取る。ローカル版ではこのファイルごと読まれないので、
//  ネットの無い環境で Supabase を取りに行ってしまうことがない。
//
//  ここは「行をそのまま渡す」「行を1つ足す」「字と線の表を渡す」だけ。
//  線との突き合わせ（判定に使う字の絞り込み）は pose-store.js が決める。
// ============================================================

import { RUNTIME } from './runtime-config.js';

let client = null;

async function getClient() {
  if (client) return client;
  const { createClient } = await import(RUNTIME.supabaseClient);
  client = createClient(RUNTIME.supabase.url, RUNTIME.supabase.anonKey);
  return client;
}

/**
 * 登録済みの行をすべて読む（登録順）。
 * @returns {Promise<Array<{id:number, letter:string, points:Object, created_at:string}>>}
 */
export async function loadRows() {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from('poses')
    .select('id, letter, points, created_at')
    .order('id', { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * 字と線の表（kana_lines）を読む。身振りスケッチ（sketch/）が書く。
 * @returns {Promise<Map<string,string[]>>} 字 → 線
 */
export async function loadLines() {
  const supabase = await getClient();
  const { data, error } = await supabase.from('kana_lines').select('letter, strokes');
  if (error) throw error;
  return new Map(data.map((r) => [r.letter, r.strokes ?? []]));
}

/** 登録を1行消す（登録した姿勢のページから、要らない回を消すとき） */
export async function deleteRow(id) {
  const supabase = await getClient();
  const { error } = await supabase.from('poses').delete().eq('id', id);
  if (error) throw error;
}

/** 1字ぶんの参照ポーズを登録する */
export async function saveRow(row) {
  const supabase = await getClient();
  const { error } = await supabase.from('poses').insert([row]);
  if (error) throw error;
}
