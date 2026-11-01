// ============================================================
//  store-local.js — 同梱の Python サーバへの保存・読み込み
//  保存先は USB 上の data/poses.json。ネットには一切つながらない。
//  Supabase 版と同じ形の行を返すので、呼ぶ側は違いを知らない。
// ============================================================

import { RUNTIME } from './runtime-config.js';

async function request(options) {
  const res = await fetch(RUNTIME.localApi, options);
  if (!res.ok) {
    // サーバが理由を返していればそれを見せる（ファイルが書けない等）
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  return res.json();
}

/** 登録済みの行をすべて読む（登録順） */
export async function loadRows() {
  const data = await request(undefined);
  return Array.isArray(data) ? data : (data.poses ?? []);
}

/** 1字ぶんの参照ポーズを登録する（サーバが poses.json へ追記し、登録時刻を付ける） */
export async function saveRow(row) {
  await request({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
}
