// ============================================================
//  pose-matcher.js — ポーズの正規化・照合・線トークンの座標解決
//  MediaPipe に依存しない純粋関数だけを置く（テストしやすさ優先）。
// ============================================================

import { LANDMARK_INDICES, POSE_REF, SHORTCUTS } from './config.js';

const round3 = (n) => parseFloat(n.toFixed(3));

/**
 * ランドマークを「腰中心・肩幅スケール」で正規化した部位辞書に変換する。
 * これにより立ち位置やカメラ距離が変わっても同じ字形は同じ座標になる。
 * @param {Array<{x:number,y:number}>} landmarks
 * @returns {Object} 部位名 → {x,y}（waist は原点 {0,0}）
 */
export function normalizePose(landmarks) {
  const waistX = (landmarks[POSE_REF.hipL].x + landmarks[POSE_REF.hipR].x) / 2;
  const waistY = (landmarks[POSE_REF.hipL].y + landmarks[POSE_REF.hipR].y) / 2;
  const scale = Math.hypot(
    landmarks[POSE_REF.shoulderL].x - landmarks[POSE_REF.shoulderR].x,
    landmarks[POSE_REF.shoulderL].y - landmarks[POSE_REF.shoulderR].y,
  );

  const out = {};
  for (const [name, idx] of Object.entries(LANDMARK_INDICES)) {
    out[name] = {
      x: round3((landmarks[idx].x - waistX) / scale),
      y: round3((landmarks[idx].y - waistY) / scale),
    };
  }
  out.waist = { x: 0, y: 0 };
  return out;
}

/**
 * ランドマークを canvas ピクセル座標の部位辞書に変換する（描画用）。
 * @returns {Object} 部位名 → {x,y}（ピクセル）
 */
export function toPixelPoints(landmarks, width, height) {
  const pts = {};
  for (const [name, idx] of Object.entries(LANDMARK_INDICES)) {
    pts[name] = { x: landmarks[idx].x * width, y: landmarks[idx].y * height };
  }
  pts.waist = {
    x: ((landmarks[POSE_REF.hipL].x + landmarks[POSE_REF.hipR].x) / 2) * width,
    y: ((landmarks[POSE_REF.hipL].y + landmarks[POSE_REF.hipR].y) / 2) * height,
  };
  return pts;
}

/**
 * 現在ポーズに最も近い参照字を返す。閾値を超えて遠ければ null。
 * @param {Object} current 正規化済み現在ポーズ
 * @param {Object} references 字 → 正規化済み参照ポーズ
 * しきい値判定は呼び出し側で行う（誤差を UI に出して調整できるようにするため）。
 * @returns {{letter: string|null, error: number}} 最も近い字とその平均誤差（該当なしは {null, Infinity}）
 */
export function matchLetter(current, references) {
  let best = null;
  let minError = Infinity;

  for (const [letter, ref] of Object.entries(references)) {
    let total = 0;
    let count = 0;
    for (const part in ref) {
      if (current[part] && ref[part]) {
        total += Math.hypot(current[part].x - ref[part].x, current[part].y - ref[part].y);
        count++;
      }
    }
    if (count === 0) continue;
    const avg = total / count;
    if (avg < minError) {
      minError = avg;
      best = letter;
    }
  }
  return { letter: best, error: minError };
}

/**
 * 線トークンを座標へ解決する。
 *   "[LH_RH]" … 左手と右手の中点
 *   "RH" など  … 略語 → 部位名 → ピクセル座標
 * @returns {{x:number,y:number}|null}
 */
export function resolvePoint(token, pixelPoints) {
  if (token.startsWith('[') && token.endsWith(']')) {
    const [aliasA, aliasB] = token.slice(1, -1).split('_');
    const a = pixelPoints[SHORTCUTS[aliasA] ?? aliasA];
    const b = pixelPoints[SHORTCUTS[aliasB] ?? aliasB];
    if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return null;
  }
  return pixelPoints[SHORTCUTS[token] ?? token] ?? null;
}
