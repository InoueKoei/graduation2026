// ============================================================
//  pose-store.js — 参照ポーズ（字と座標・字と線）を読み込む層
//
//  字と座標・字と線は別々に持つ。
//    座標 … 保存先（Supabase／ローカル）の行。登録モードで撮ると1行増える
//    線   … pose-sets/kana-lines.json（身振りスケッチのスケッチ帳から書き出す）
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

let kanaLines = null;

/**
 * 字と線の対応（kana-lines.json の lines）を読む。1字1件。
 * @returns {Promise<Map<string,string[]>>} 字 → 線
 */
async function loadKanaLines() {
  if (kanaLines) return kanaLines;
  const res = await fetch(KANA_LINES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`字と線の一覧を読めません（${KANA_LINES_URL}: ${res.status}）`);
  kanaLines = new Map(Object.entries((await res.json()).lines ?? {}));
  return kanaLines;
}

/**
 * 参照ポーズを読み込む。
 * @returns {Promise<{poses:Object, lines:Object, pending:string[]}>}
 *   poses[字]   = 正規化座標（同じ字が何度も登録されていれば最後のもの）
 *   lines[字]   = 一筆書き記述（kana-lines.json の線）
 *   pending     = 線の一覧には載っているが、まだ座標が登録されていない字
 */
export async function loadReferencePoses() {
  const [rows, kanaLines] = await Promise.all([(await store).loadRows(), loadKanaLines()]);

  const poses = {};
  const lines = {};
  for (const row of rows) {
    // 線の一覧に載っている字だけで判定する
    if (!kanaLines.has(row.letter)) continue;
    poses[row.letter] = row.points;
    lines[row.letter] = kanaLines.get(row.letter);
  }

  const pending = [...kanaLines.keys()].filter((letter) => !poses[letter]);
  return { poses, lines, pending };
}

/**
 * 1字ぶんの参照ポーズ（座標）を登録する。線は保存しない（線は kana-lines.json だけが持つ）。
 * 撮り直すと行が増え、読み込みでは同じ字の最後の行が使われる。
 */
export async function savePose(letter, points) {
  return (await store).saveRow({ letter, points });
}
