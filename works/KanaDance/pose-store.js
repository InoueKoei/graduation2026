// ============================================================
//  pose-store.js — 参照ポーズ（字と座標・字と線）を読み込む層
//
//  字と座標・字と線は別々に持つ。
//    座標 … 保存先（Supabase／ローカル）の行。登録モードで撮ると1行増える
//    線   … Supabase の kana_lines（身振りスケッチ sketch/ が書く）。
//            読めないとき（表が無い・USB 版でネットが無い）は pose-sets/kana-lines.json の控えを使う
//  2つは字で突き合わせるだけ。
//  呼ぶ側（script.js）は { poses, lines } を受け取るだけで、どちらも知らなくてよい。
// ============================================================

import { RUNTIME } from './runtime-config.js';
import { KANA_LINES_URL } from './config.js';

// 使うほうだけを動的 import する。
// 静的 import にすると、ローカル版でも Supabase クライアントを
// CDN に取りに行ってしまい、ネットの無い環境で止まる。
const store = RUNTIME.backend === 'local'
  ? import('./store-local.js')
  : import('./store-supabase.js');

/**
 * 字と線の対応を読む。1字1件。読み込みのたびに取り直すので、スケッチで保存した線は読み直すだけで効く。
 * 保存先が表を持っていればそれ（Supabase の kana_lines）、無ければ・読めなければ kana-lines.json の控え。
 * @returns {Promise<Map<string,string[]>>} 字 → 線
 */
async function loadKanaLines() {
  const s = await store;
  if (s.loadLines) {
    try {
      const lines = await s.loadLines();
      if (lines.size) return lines;
    } catch (err) {
      console.warn(`字と線の表を読めないので控え（${KANA_LINES_URL}）を使います:`, err.message);
    }
  }
  const res = await fetch(KANA_LINES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`字と線の一覧を読めません（${KANA_LINES_URL}: ${res.status}）`);
  return new Map(Object.entries((await res.json()).lines ?? {}));
}

/**
 * 参照ポーズを読み込む。
 * @returns {Promise<{poses:Object, samples:Object, lines:Object, pending:string[]}>}
 *   samples[字] = その字の登録すべて（古い → 新しい）。判定はこの全部を手本にし、いちばん近い1回で比べる
 *   poses[字]   = いちばん新しい登録（体型合わせの基準や、字の数を数えるのに使う）
 *   lines[字]   = 一筆書き記述（kana_lines の線）
 *   pending     = 線の一覧には載っているが、まだ座標が登録されていない字
 */
export async function loadReferencePoses() {
  const [rows, kanaLines] = await Promise.all([(await store).loadRows(), loadKanaLines()]);

  const poses = {};
  const samples = {};
  const lines = {};
  for (const row of rows) {
    // 線の一覧に載っている字だけで判定する
    if (!kanaLines.has(row.letter)) continue;
    poses[row.letter] = row.points;
    (samples[row.letter] ??= []).push(row.points);
    lines[row.letter] = kanaLines.get(row.letter);
  }

  const pending = [...kanaLines.keys()].filter((letter) => !poses[letter]);
  return { poses, samples, lines, pending };
}

/**
 * 1字ぶんの参照ポーズ（座標）を登録する。線は保存しない（線は kana_lines だけが持つ）。
 * 撮り直すと行が増え、判定ではその字の登録が全部手本になる（要らない回は「登録した姿勢」のページで消す）。
 */
export async function savePose(letter, points) {
  return (await store).saveRow({ letter, points });
}
