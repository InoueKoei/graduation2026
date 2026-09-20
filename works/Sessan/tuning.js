// ============================================================
//  tuning.js — 確認用ページで詰めた値を、本番と共有する
//
//  `_preview-glyph.html` で動かした値を localStorage に置き、
//  `script.js` が起動時に読む。**プレビューと本番が同じ値で動く**ための口。
//  較正（calibration.js）と同じ考え方だが、あちらは口形ターゲット専用なので分けてある。
//
//  保存が使えない環境（プライベートモード等）では既定値のまま動く。
//  ここで落ちてはいけないので、読み書きは全部 try で包む。
// ============================================================

/**
 * 保存値を既定値に重ねて返す。
 * **既定値に無い鍵と、型が合わない値は捨てる**（古い保存や壊れた JSON で本番を壊さない）。
 * @param {string} key localStorage のキー
 * @param {object} defaults config.js 側の既定値
 */
export function loadTuning(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...defaults };
    const saved = JSON.parse(raw);
    const merged = { ...defaults };
    for (const [k, v] of Object.entries(saved ?? {})) {
      const d = defaults[k];
      if (d === undefined) continue;
      if (typeof d === 'number' && Number.isFinite(v)) merged[k] = v;
      else if (typeof d === 'string' && typeof v === 'string') merged[k] = v;
      else if (Array.isArray(d) && Array.isArray(v) && v.length === d.length && v.every(Number.isFinite)) {
        merged[k] = [...v];
      }
    }
    return merged;
  } catch {
    return { ...defaults };
  }
}

export function saveTuning(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify(values));
    return true;
  } catch {
    return false;
  }
}

export function clearTuning(key) {
  try {
    localStorage.removeItem(key);
  } catch { /* 消せなくても既定値で動く */ }
}

/** 上書きが効いているか（画面に印を出すため） */
export function hasTuning(key) {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}
