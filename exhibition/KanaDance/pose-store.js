// ============================================================
//  pose-store.js — 参照ポーズを「組」として組み立てる層
//
//  保存先（Supabase／ローカル）は runtime-config.js の backend で選ぶ。
//  どの行で判定するか（旧ポーズ／新ポーズ）は config.js の POSE_SETS で選ぶ。
//  呼ぶ側（script.js）は { poses, lines } を受け取るだけで、どちらも知らなくてよい。
// ============================================================

import { RUNTIME } from './runtime-config.js';
import { POSE_SETS, DEFAULT_KANA_LINES } from './config.js';

// 使うほうだけを動的 import する。
// 静的 import にすると、ローカル版でも Supabase クライアントを
// CDN に取りに行ってしまい、ネットの無い環境で止まる。
const store = RUNTIME.backend === 'local'
  ? import('./store-local.js')
  : import('./store-supabase.js');

const linkageCache = new Map();

/**
 * 字と線の結び方の一覧を読む。同じ字が複数あるときは prefer で選ぶ。
 * @returns {Promise<Map<string,string[]>|null>} 字 → strokes
 */
async function loadLinkage(set) {
  if (!set.linkage) return null;
  if (!linkageCache.has(set.linkage)) {
    const res = await fetch(set.linkage, { cache: 'no-store' });
    if (!res.ok) throw new Error(`字の一覧を読めません（${set.linkage}: ${res.status}）`);
    linkageCache.set(set.linkage, await res.json());
  }
  const data = linkageCache.get(set.linkage);

  const strokes = new Map();
  for (const entry of data.poses ?? []) {
    const chosen = strokes.has(entry.letter);
    const preferred = set.prefer?.[entry.letter];
    // 同じ字が2行あるとき：prefer に合う source を採る。指定が無ければ先のものを残す
    if (chosen && (!preferred || entry.source !== preferred)) continue;
    strokes.set(entry.letter, entry.strokes ?? []);
  }
  return strokes;
}

/** 行の登録時刻が組の範囲に入っているか */
function inWindow(row, set) {
  // 登録時刻を持たない行（古いローカル保存など）は旧ポーズ扱い
  if (!row.created_at) return !set.since;
  const t = Date.parse(row.created_at);
  if (set.since && t < Date.parse(set.since)) return false;
  if (set.until && t >= Date.parse(set.until)) return false;
  return true;
}

/**
 * 参照ポーズを組として読み込む。
 * @param {string} setName POSE_SETS のキー
 * @returns {Promise<{poses:Object, lines:Object, pending:string[], set:Object}>}
 *   poses[字]   = 正規化座標（同じ字が何度も登録されていれば最後のもの）
 *   lines[字]   = 一筆書き記述（一覧 → 行の lines → 既定 → 空 の順で決まる）
 *   pending     = 一覧には載っているが、まだ座標が登録されていない字
 */
export async function loadReferencePoses(setName) {
  const set = POSE_SETS[setName];
  if (!set) throw new Error(`未知のポーズの組: ${setName}`);

  const [rows, linkage] = await Promise.all([(await store).loadRows(), loadLinkage(set)]);

  const poses = {};
  const lines = {};
  for (const row of rows) {
    if (!inWindow(row, set)) continue;
    // 一覧があるときは、一覧に載っている字だけで判定する
    if (linkage && !linkage.has(row.letter)) continue;
    poses[row.letter] = row.points;
    lines[row.letter] = linkage?.get(row.letter)
      ?? row.lines ?? DEFAULT_KANA_LINES[row.letter] ?? [];
  }

  const pending = linkage ? [...linkage.keys()].filter((letter) => !poses[letter]) : [];
  return { poses, lines, pending, set };
}

/**
 * 1字ぶんの参照ポーズを登録する。
 * 組に一覧があれば、その字の strokes を lines として一緒に保存する
 * （一覧の _meta にある「Supabase poses.lines に入れる値」）。
 */
export async function savePose(letter, points, setName) {
  const set = POSE_SETS[setName];
  const linkage = set ? await loadLinkage(set) : null;
  const row = { letter, points };
  const lines = linkage?.get(letter) ?? DEFAULT_KANA_LINES[letter];
  if (lines) row.lines = lines;
  return (await store).saveRow(row);
}
