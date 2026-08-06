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
 * 顔ランドマークから口形・目の比率を求める。
 * @param {Array<{x:number,y:number}>} face FaceMesh の点群
 * @returns {{v:number, h:number, eye:number}} 縦口比 / 横口比 / 目の縦横比
 */
export function analyzeFace(face) {
  const vMouth = Math.hypot(face[13].x - face[14].x, face[13].y - face[14].y);
  const hMouth = Math.hypot(face[61].x - face[291].x, face[61].y - face[291].y);
  const faceSize = Math.hypot(face[33].x - face[263].x, face[33].y - face[263].y);
  const vEye = Math.hypot(face[159].x - face[145].x, face[159].y - face[145].y);
  const hEye = Math.hypot(face[33].x - face[133].x, face[33].y - face[133].y);
  return { v: vMouth / faceSize, h: hMouth / faceSize, eye: vEye / hEye };
}

/**
 * 口形の比率に最も近い母音キーを返す（'close' を含む）。
 * @returns {string} 'close' | 'あ' | 'い' | 'う' | 'え' | 'お'
 */
export function classifyVowel(metrics, vowelTargets) {
  let best = 'close';
  let min = Infinity;
  for (const [key, t] of Object.entries(vowelTargets)) {
    const d = Math.hypot(metrics.v - t.v, metrics.h - t.h);
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
