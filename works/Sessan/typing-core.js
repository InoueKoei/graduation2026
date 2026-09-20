// ============================================================
//  typing-core.js — Sessan の入力判定ロジック（MediaPipe 非依存の純粋関数）
// ============================================================

/**
 * 立てている指の本数を数える。
 * 人差し〜小指は指先(8,12,16,20)が第二関節より上なら立っているとみなし、
 * 親指は横方向ではなく簡易的に y でしきい値判定する。
 * @param {Array<{x:number,y:number}>} landmarks 片手の21点
 * @returns {number} 0〜5
 */
export function countFingers(landmarks) {
  let count = 0;
  for (const tip of [8, 12, 16, 20]) {
    if (landmarks[tip].y < landmarks[tip - 2].y) count++;
  }
  if (landmarks[4].y < landmarks[2].y - 0.02) count++; // 親指
  return count;
}

/**
 * MediaPipe FaceMesh の内唇リング（口腔の輪郭）。
 * この多角形の面積が「口をどれだけ開けているか」＝口腔の面積になる。
 * 先行研究（MouthType CHI2004 / Saitoh 2007 / KUCHIMOJI 2026）が
 * 母音判別に有効としているのは、この面積と縦横比の組み合わせ。
 */
export const INNER_LIP_RING = Object.freeze([
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
  308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
]);

/** 多角形の面積（シューレース公式）。点の並び順が時計回りでも符号を吸収する */
export function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * 顔ランドマークから口形・目の特徴量を求める。
 *
 * area   … 口腔（内唇リング）の面積 / 顔サイズ²
 * aspect … 口の縦幅 / 横幅
 *
 * どちらも顔サイズで無次元化してあるので、カメラとの距離が変わっても値は変わらない
 * （近づいた・遠ざかったで母音の判定が変わってしまわないように）。
 * 顔サイズそのものは proximity として返す。近さを使いたい側はこれを見る。
 *
 * @param {Array<{x:number,y:number}>} face FaceMesh の点群
 * @returns {{area:number, aspect:number, eye:number, proximity:number}}
 */
export function analyzeFace(face) {
  // 顔サイズ＝左右の目尻の間隔。表情でほとんど変わらないので基準に向く
  const faceSize = Math.hypot(face[33].x - face[263].x, face[33].y - face[263].y) || 1e-6;

  const ring = INNER_LIP_RING.map((i) => face[i]);
  const area = polygonArea(ring) / (faceSize * faceSize);

  const vMouth = Math.hypot(face[13].x - face[14].x, face[13].y - face[14].y);
  const hMouth = Math.hypot(face[61].x - face[291].x, face[61].y - face[291].y) || 1e-6;

  const vEye = Math.hypot(face[159].x - face[145].x, face[159].y - face[145].y);
  const hEye = Math.hypot(face[33].x - face[133].x, face[33].y - face[133].y) || 1e-6;

  return { area, aspect: vMouth / hMouth, eye: vEye / hEye, proximity: faceSize };
}

/**
 * 口形に最も近い母音キーを返す（閉唇 'close' を含む）。
 * 'close' は KUCHIMOJI の N クラス（閉じた唇）にあたる。
 *
 * area と aspect は桁が違う（面積は小さく、縦横比は 0〜1 前後）ので、
 * そのまま距離を取ると面積の差が埋もれる。各軸をターゲット値の幅で割ってから比べる。
 * ＝単位を揃えているだけで、較正ではない。
 *
 * @returns {string} 'close' | 'あ' | 'い' | 'う' | 'え' | 'お'
 */
export function classifyVowel(metrics, vowelTargets) {
  const entries = Object.entries(vowelTargets);
  const spread = (key) => {
    const values = entries.map(([, t]) => t[key]);
    return Math.max(...values) - Math.min(...values) || 1;
  };
  const areaSpread = spread('area');
  const aspectSpread = spread('aspect');

  let best = 'close';
  let min = Infinity;
  for (const [key, t] of entries) {
    const d = Math.hypot(
      (metrics.area - t.area) / areaSpread,
      (metrics.aspect - t.aspect) / aspectSpread,
    );
    if (d < min) { min = d; best = key; }
  }
  return best;
}

/** 目が閉じているか（close/open のどちらに近いか） */
export function isEyeClosed(metrics, eyeTargets) {
  return Math.abs(metrics.eye - eyeTargets.close) < Math.abs(metrics.eye - eyeTargets.open);
}

/**
 * 末尾の1字に濁点／半濁点を付けた新しいテキストを返す。
 * 付けられない字ならテキストをそのまま返す。
 * @param {string} text
 * @param {'d'|'h'} kind 'd'=濁点, 'h'=半濁点
 */
export function withModifier(text, kind, dakuten, handakuten) {
  if (text.length === 0) return text;
  const last = text.slice(-1);
  const next = kind === 'd' ? dakuten[last] : handakuten[last];
  return next ? text.slice(0, -1) + next : text;
}

/**
 * 「一定フレーム保持で1度だけ確定する」ゲート。
 * ジェスチャ入力のチャタリングを抑える。
 *   tick()  … 成立フレームで呼ぶ。しきい値到達で1度だけ true（同時にロック）
 *   ロック中は再度しきい値に達しても false（誤連射を防止）
 *   unlock()/reset() で解除する
 */
export class HoldGate {
  #required;
  #frames = 0;
  #locked = false;

  constructor(requiredFrames) {
    this.#required = requiredFrames;
  }

  get locked() { return this.#locked; }

  /** @returns {boolean} 確定した瞬間だけ true */
  tick() {
    if (this.#locked) return false;
    this.#frames++;
    if (this.#frames >= this.#required) {
      this.#frames = 0;
      this.#locked = true;
      return true;
    }
    return false;
  }

  /** 0〜1 の進捗（ロック中は 1） */
  progress() {
    return this.#locked ? 1 : this.#frames / this.#required;
  }

  resetCounter() { this.#frames = 0; }
  unlock() { this.#locked = false; }
  reset() { this.#frames = 0; this.#locked = false; }
}
