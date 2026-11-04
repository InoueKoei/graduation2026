// ============================================================
//  store-supabase.js — Supabase への参照ポーズ保存・読み込み
//  クライアントは動的 import で取る。ローカル版ではこのファイルごと読まれないので、
//  ネットの無い環境で Supabase を取りに行ってしまうことがない。
//
//  ここは「行をそのまま渡す」「行を1つ足す」だけ。
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

/** 1字ぶんの参照ポーズを登録する */
export async function saveRow(row) {
  const supabase = await getClient();
  const { error } = await supabase.from('poses').insert([row]);
  if (error) throw error;
}
