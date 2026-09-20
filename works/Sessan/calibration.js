// ============================================================
//  calibration.js — 母音ターゲットの較正
//  あ・い・う・え・お を順に保持させ、その間の (area, aspect) の平均を取る。
//  MouthType が話者ごとに口形の範囲を取り直しているのと同じ発想の、最小版。
//
//  ここでやるのは「5つの平均を取る」だけ。
//  最大最小の正規化や分散の吸収には踏み込まない（合否に効かないわりに終わりがない）。
//  較正しなくても config.js の既定値で動く。あくまで上書き。
// ============================================================

/** 較正の進行。1母音ぶんが「構える(readyMs) → 取り込む(holdMs)」の2段 */
export class Calibration {
  #config;
  #index = -1;
  #phase = 'idle';   // 'idle' | 'ready' | 'sampling' | 'done'
  #phaseStart = 0;
  #samples = [];
  #result = {};

  constructor(config) {
    this.#config = config;
  }

  get active() { return this.#phase !== 'idle' && this.#phase !== 'done'; }
  get phase() { return this.#phase; }
  /** いま構えてもらっている母音 */
  get vowel() { return this.#config.vowels[this.#index] ?? null; }
  get stepText() { return `${this.#index + 1} / ${this.#config.vowels.length}`; }

  start(nowMs) {
    this.#index = 0;
    this.#result = {};
    this.#enter('ready', nowMs);
  }

  cancel() {
    this.#phase = 'idle';
    this.#index = -1;
    this.#samples = [];
  }

  #enter(phase, nowMs) {
    this.#phase = phase;
    this.#phaseStart = nowMs;
    this.#samples = [];
  }

  /** いまの段の進み具合 0〜1（画面のメーター用） */
  progress(nowMs) {
    if (!this.active) return 0;
    const span = this.#phase === 'ready' ? this.#config.readyMs : this.#config.holdMs;
    return Math.min(1, (nowMs - this.#phaseStart) / span);
  }

  /**
   * 毎フレーム呼ぶ。取り込み中なら metrics を溜め、段が終われば次へ進む。
   * @param {{area:number, aspect:number}|null} metrics 顔が取れていなければ null
   * @returns {Object|null} 全母音ぶん終わった瞬間だけ、ターゲットの表を返す
   */
  feed(metrics, nowMs) {
    if (!this.active) return null;

    if (this.#phase === 'ready') {
      if (nowMs - this.#phaseStart >= this.#config.readyMs) this.#enter('sampling', nowMs);
      return null;
    }

    // 顔が外れたフレームは数えない（黙って待つ）
    if (metrics) this.#samples.push(metrics);
    if (nowMs - this.#phaseStart < this.#config.holdMs) return null;

    // 1つも取れていなければ、この母音をやり直す
    if (!this.#samples.length) {
      this.#enter('ready', nowMs);
      return null;
    }

    const n = this.#samples.length;
    this.#result[this.vowel] = {
      area: this.#samples.reduce((s, m) => s + m.area, 0) / n,
      aspect: this.#samples.reduce((s, m) => s + m.aspect, 0) / n,
    };

    this.#index++;
    if (this.#index < this.#config.vowels.length) {
      this.#enter('ready', nowMs);
      return null;
    }

    this.#phase = 'done';
    return this.#result;
  }
}

// ── 保存と読み込み ──────────────────────────────────────────
// localStorage はプライベートウィンドウ等で例外を投げることがあるので、
// 読み書きのどちらも失敗を飲み込んで既定値で動き続ける。

/** 保存済みターゲットを既定値へ重ねて返す（未較正の 'close' などは既定のまま残る） */
export function loadTargets(storageKey, defaults) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...defaults };
    const saved = JSON.parse(raw);
    const merged = { ...defaults };
    for (const [key, value] of Object.entries(saved)) {
      if (typeof value?.area === 'number' && typeof value?.aspect === 'number') {
        merged[key] = { area: value.area, aspect: value.aspect };
      }
    }
    return merged;
  } catch {
    return { ...defaults };
  }
}

export function saveTargets(storageKey, targets) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(targets));
    return true;
  } catch {
    return false;
  }
}

export function clearTargets(storageKey) {
  try {
    localStorage.removeItem(storageKey);
  } catch { /* 消せなくても既定値で動く */ }
}

/** 較正済みかどうか（画面の表示切り替え用） */
export function hasSaved(storageKey) {
  try {
    return localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}
