// ============================================================
//  pose-store.js — 参照ポーズの保存先を選ぶだけの層
//  runtime-config.js の backend を見て、Supabase かローカルかを決める。
//  呼ぶ側（script.js）はどちらかを知らなくてよい。
// ============================================================

import { RUNTIME } from './runtime-config.js';

// 使うほうだけを動的 import する。
// 静的 import にすると、ローカル版でも Supabase クライアントを
// CDN に取りに行ってしまい、ネットの無い環境で止まる。
const store = RUNTIME.backend === 'local'
  ? import('./store-local.js')
  : import('./store-supabase.js');

/** 参照ポーズをすべて読み込む */
export async function loadReferencePoses() {
  return (await store).loadReferencePoses();
}

/** 1字ぶんの参照ポーズを登録する */
export async function savePose(letter, points) {
  return (await store).savePose(letter, points);
}
