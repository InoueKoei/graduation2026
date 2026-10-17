// ============================================================
//  store-local.js — 同梱の Python サーバへの保存・読み込み
//  保存先は USB 上の data/poses.json。ネットには一切つながらない。
//  Supabase 版と同じ形（poses / lines）を返すので、呼ぶ側は違いを知らない。
// ============================================================

import { RUNTIME } from './runtime-config.js';
import { DEFAULT_KANA_LINES } from './config.js';

async function request(options) {
  const res = await fetch(RUNTIME.localApi, options);
  if (!res.ok) {
    // サーバが理由を返していればそれを見せる（ファイルが書けない等）
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  return res.json();
}

/**
 * 参照ポーズをすべて読み込む。
 * @returns {Promise<{poses:Object, lines:Object}>}
 */
export async function loadReferencePoses() {
  const data = await request(undefined);
  const rows = Array.isArray(data) ? data : (data.poses ?? []);

  const poses = {};
  const lines = {};
  for (const row of rows) {
    poses[row.letter] = row.points;
    lines[row.letter] = row.lines || DEFAULT_KANA_LINES[row.letter] || [];
  }
  return { poses, lines };
}

/** 1字ぶんの参照ポーズを登録する（サーバが poses.json へ追記する） */
export async function savePose(letter, points) {
  const record = { letter, points };
  if (DEFAULT_KANA_LINES[letter]) record.lines = DEFAULT_KANA_LINES[letter];

  await request({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
}
