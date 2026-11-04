// ============================================================
//  pose-matcher.js — ポーズの正規化・照合・線トークンの座標解決
//  MediaPipe に依存しない純粋関数だけを置く（テストしやすさ優先）。
// ============================================================

import { LANDMARKS, POSE_REF, SHORTCUTS, DERIVED_POINTS } from './config.js';

const round3 = (n) => parseFloat(n.toFixed(3));

/**
 * ランドマークを「腰中心・肩幅スケール」で正規化した部位辞書に変換する。
 * これにより立ち位置やカメラ距離が変わっても同じ字形は同じ座標になる。
 * @param {Array<{x:number,y:number}>} landmarks
 * @param {Object} [indices] 部位名 → ランドマーク番号
 * @returns {Object} 部位名 → {x,y}（waist は原点 {0,0}）
 */
export function normalizePose(landmarks, indices = LANDMARKS) {
  const waistX = (landmarks[POSE_REF.hipL].x + landmarks[POSE_REF.hipR].x) / 2;
  const waistY = (landmarks[POSE_REF.hipL].y + landmarks[POSE_REF.hipR].y) / 2;
  const scale = Math.hypot(
    landmarks[POSE_REF.shoulderL].x - landmarks[POSE_REF.shoulderR].x,
    landmarks[POSE_REF.shoulderL].y - landmarks[POSE_REF.shoulderR].y,
  );

  const out = {};
  for (const [name, idx] of Object.entries(indices)) {
    out[name] = {
      x: round3((landmarks[idx].x - waistX) / scale),
      y: round3((landmarks[idx].y - waistY) / scale),
    };
  }
  // 腰・首など中点で作る部位。腰は原点なので必ず {0, 0} になる
  for (const [name, [a, b]] of Object.entries(DERIVED_POINTS)) {
    out[name] = {
      x: round3(((landmarks[a].x + landmarks[b].x) / 2 - waistX) / scale),
      y: round3(((landmarks[a].y + landmarks[b].y) / 2 - waistY) / scale),
    };
  }
  return out;
}

/**
 * ランドマークを canvas ピクセル座標の部位辞書に変換する（描画用）。
 * @returns {Object} 部位名 → {x,y}（ピクセル）
 */
export function toPixelPoints(landmarks, width, height, indices = LANDMARKS) {
  const pts = {};
  for (const [name, idx] of Object.entries(indices)) {
    pts[name] = { x: landmarks[idx].x * width, y: landmarks[idx].y * height };
  }
  for (const [name, [a, b]] of Object.entries(DERIVED_POINTS)) {
    pts[name] = {
      x: ((landmarks[a].x + landmarks[b].x) / 2) * width,
      y: ((landmarks[a].y + landmarks[b].y) / 2) * height,
    };
  }
  return pts;
}

/**
 * 現在ポーズに最も近い参照字を返す。閾値を超えて遠ければ null。
 * @param {Object} current 正規化済み現在ポーズ
 * @param {Object} references 字 → 正規化済み参照ポーズ、またはその配列（同じ字の登録を全部手本にするとき）。
 *   配列なら、そのうちいちばん近い1回との誤差をその字の誤差とする
 * しきい値判定は呼び出し側で行う（誤差を UI に出して調整できるようにするため）。
 * @returns {{letter: string|null, error: number}} 最も近い字とその平均誤差（該当なしは {null, Infinity}）
 */
export function matchLetter(current, references) {
  let best = null;
  let minError = Infinity;

  for (const [letter, refs] of Object.entries(references)) {
    for (const ref of Array.isArray(refs) ? refs : [refs]) {
      const avg = poseError(current, ref);
      if (avg < minError) {
        minError = avg;
        best = letter;
      }
    }
  }
  return { letter: best, error: minError };
}

/** 2つの姿勢の誤差（両方にある部位のずれの平均）。比べる部位が無ければ Infinity */
export function poseError(a, b) {
  let total = 0;
  let count = 0;
  for (const part in b) {
    if (a[part] && b[part]) {
      total += Math.hypot(a[part].x - b[part].x, a[part].y - b[part].y);
      count++;
    }
  }
  return count ? total / count : Infinity;
}

/**
 * 線トークンを部位名の配列へ解く。
 *   "RH"        … ['r_hand']
 *   "[LH_RH]"   … ['l_hand','r_hand']（複数指定なら重心を指す）
 * @returns {string[]}
 */
export function resolveTokenParts(token) {
  const body = token.startsWith('[') && token.endsWith(']') ? token.slice(1, -1) : token;
  return body.split('_').map((alias) => SHORTCUTS[alias] ?? alias);
}

/**
 * 線トークンを座標へ解決する。複数部位ならその重心。
 * @returns {{x:number,y:number}|null}
 */
export function resolvePoint(token, pixelPoints) {
  const parts = resolveTokenParts(token);
  let x = 0, y = 0;
  for (const name of parts) {
    const p = pixelPoints[name];
    if (!p) return null;
    x += p.x; y += p.y;
  }
  return { x: x / parts.length, y: y / parts.length };
}

// ── 体型合わせ（較正）────────────────────────────────────────
// 肩幅で割っても、肩幅に対する腕や脚の長さの差（子どもと大人など）は残る。
// そこで体験の最初にその人の体節の長さを測り、登録ポーズを
// 「向きはそのまま、長さだけその人の体」に組み直してから比べる。

/** 長さを測る体節。左右は同じ長さとみなす */
export const SEGMENTS = Object.freeze({
  torso: [['waist', 'neck']],
  neck_head: [['neck', 'head']],
  upper_arm: [['l_shoulder', 'l_elbow'], ['r_shoulder', 'r_elbow']],
  forearm: [['l_elbow', 'l_hand'], ['r_elbow', 'r_hand']],
  thigh: [['waist', 'l_knee'], ['waist', 'r_knee']],
  shin: [['l_knee', 'l_leg'], ['r_knee', 'r_leg']],
});

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 1姿勢ぶんの体節の長さ（肩幅＝1 の単位）。左右は別々に返す。
 * @returns {Object} 体節名 → [左, 右]（片側しか無い体節は1要素）
 */
export function segmentLengths(pose) {
  const out = {};
  for (const [name, pairs] of Object.entries(SEGMENTS)) {
    out[name] = pairs.map(([a, b]) => (pose[a] && pose[b] ? dist(pose[a], pose[b]) : null));
  }
  return out;
}

const median = (values) => {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : null;
};

/**
 * 静止中に撮った何フレームぶんかから、体節の長さを左右別に決める（各側の中央値）。
 * @param {Array<Object>} samples segmentLengths() の戻りの列
 * @returns {Object} 体節名 → [左, 右]
 */
export function summarizeLengths(samples) {
  const out = {};
  for (const [name, pairs] of Object.entries(SEGMENTS)) {
    out[name] = pairs.map((_, i) => median(samples.map((sample) => sample[name]?.[i])));
  }
  return out;
}

/**
 * その人の体節の長さが、登録した人の何倍か（体節ごと）。
 *
 * **同じポーズ（イ）どうしで比べる**のが要点。画面上の長さは、手足がカメラに
 * 向かっているほど短く写るので、ポーズが違うと長さを比べても意味がない。
 * 同じポーズなら写り方の縮みは両者で打ち消し合い、体型の差だけが残る。
 *
 * 左右は長さの和どうしで比べる（片側が大きく縮んで写っていても値が暴れにくい）。
 * 測り損ないで極端な値にならないよう、range の範囲に収める。
 *
 * @param {Object} measured summarizeLengths() の戻り（その人のイ）
 * @param {Object} refPose  登録したイの正規化座標
 * @returns {Object} 体節名 → 倍率
 */
export function lengthRatios(measured, refPose, range = [0.5, 1.6]) {
  const ref = segmentLengths(refPose);
  const out = {};
  for (const name of Object.keys(SEGMENTS)) {
    const a = (measured[name] ?? []).reduce((sum, v) => sum + (v ?? 0), 0);
    const b = (ref[name] ?? []).reduce((sum, v) => sum + (v ?? 0), 0);
    out[name] = b > 0 && a > 0 ? Math.min(range[1], Math.max(range[0], a / b)) : 1;
  }
  return out;
}

/**
 * 登録ポーズの体節を、向きも写り方の縮みもそのままに、倍率 ratios だけ伸び縮みさせる。
 * 腰を原点に、首 → 頭 / 首 → 肩 → 肘 → 手 / 腰 → 膝 → 足 とたどる。
 * 肩幅は正規化で常に 1 なので、首から肩へは倍率を掛けない。
 * 倍率がすべて 1 なら元のポーズに戻る。
 */
export function rescalePose(ref, ratios) {
  const out = { ...ref };
  const step = (origin, from, to, k = 1) => {
    if (!origin || !ref[from] || !ref[to]) return ref[to];
    return {
      x: origin.x + (ref[to].x - ref[from].x) * k,
      y: origin.y + (ref[to].y - ref[from].y) * k,
    };
  };

  out.waist = ref.waist ?? { x: 0, y: 0 };
  out.neck = step(out.waist, 'waist', 'neck', ratios.torso);
  out.head = step(out.neck, 'neck', 'head', ratios.neck_head);
  for (const s of ['l', 'r']) {
    out[`${s}_shoulder`] = step(out.neck, 'neck', `${s}_shoulder`, 1);
    out[`${s}_elbow`] = step(out[`${s}_shoulder`], `${s}_shoulder`, `${s}_elbow`, ratios.upper_arm);
    out[`${s}_hand`] = step(out[`${s}_elbow`], `${s}_elbow`, `${s}_hand`, ratios.forearm);
    out[`${s}_knee`] = step(out.waist, 'waist', `${s}_knee`, ratios.thigh);
    out[`${s}_leg`] = step(out[`${s}_knee`], `${s}_knee`, `${s}_leg`, ratios.shin);
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/**
 * 体が正面を向いているか。左右の肩の奥行き（z）の差を、肩幅（x）と比べる。
 * θ だけひねると |Δz|/|Δx| ≒ tanθ。tol 0.5 でおよそ 27° まで許す。
 */
export function isFacingFront(landmarks, tol) {
  if (tol == null) return true;
  const l = landmarks[POSE_REF.shoulderL];
  const r = landmarks[POSE_REF.shoulderR];
  if (l.z == null || r.z == null) return true;
  return Math.abs(l.z - r.z) / (Math.abs(l.x - r.x) || 1e-6) <= tol;
}

/** 指定したランドマークがすべて見えているか（MediaPipe の visibility） */
export function allVisible(landmarks, indices, minVisibility) {
  return Object.values(indices).every((i) => (landmarks[i]?.visibility ?? 1) >= minVisibility);
}
