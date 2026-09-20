// ============================================================
//  game.js — タイムアタックの進行（DOM もマットも知らない純粋ロジック）
//
//  決められた数のお題を全部打ち切るまでのタイムを計る。
//  お題に無い面を踏んでも入力は通らず、ミスとして数えるだけでタイムには響かない。
//  「踏み間違いを恐れずに動ける」ほうを取っている。
// ============================================================

import { GAME } from './config.js';

/** 配列から n 個を重複なく選ぶ（Fisher–Yates を必要な分だけ回す） */
function pickSome(list, n) {
  const pool = [...list];
  const count = Math.min(n, pool.length);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export class TimeAttack {
  /**
   * @param {string[]} phrases お題の候補
   * @param {number} count 1回で出す数
   */
  constructor(phrases, count = GAME.phrasesPerRun) {
    this.phrases = pickSome(phrases, count);
    this.index = 0;   // 何文めか
    this.cursor = 0;  // その文の何字めか
    this.misses = 0;
    this.startedAt = null;  // 最初の踏みで動きだす
    this.finishedAt = null;
  }

  // ── 状態 ──────────────────────────────────────────────────

  get phrase() { return this.phrases[this.index] ?? ''; }
  /** いま踏むべき字。終わっていれば null */
  get expected() { return this.finished ? null : (this.phrase[this.cursor] ?? null); }
  get started() { return this.startedAt !== null; }
  get finished() { return this.finishedAt !== null; }
  /** この文のうち打ち終えた部分 */
  get typed() { return this.phrase.slice(0, this.cursor); }

  get totalChars() { return this.phrases.reduce((n, p) => n + p.length, 0); }
  get doneChars() {
    return this.phrases.slice(0, this.index).reduce((n, p) => n + p.length, 0) + this.cursor;
  }

  /** 経過時間。始まる前は 0、終わったあとは止まった値を返す */
  elapsed(now = performance.now()) {
    if (this.startedAt === null) return 0;
    return (this.finishedAt ?? now) - this.startedAt;
  }

  /** 1文字あたりの平均。終わっていなければ現時点での平均 */
  msPerChar(now = performance.now()) {
    const done = this.doneChars;
    return done === 0 ? 0 : this.elapsed(now) / done;
  }

  // ── 進行 ──────────────────────────────────────────────────

  /**
   * 計測を始める。最初の踏みで呼ぶ（正解でもミスでもよい）。
   * 位置につくまでの時間を計らないため、モードに入った時点では始めない。
   */
  startClock(now = performance.now()) {
    if (this.startedAt === null) this.startedAt = now;
  }

  /** お題に無い面を踏んだ */
  miss() { this.misses++; }

  /**
   * 1字進む。文を打ち切ったら次の文へ、全部打ち切ったら終了。
   * @returns {'char'|'phrase'|'finish'} 何が起きたか（音や表示を変えたいとき用）
   */
  advance(now = performance.now()) {
    if (this.finished) return 'finish';
    this.cursor++;
    if (this.cursor < this.phrase.length) return 'char';

    this.index++;
    this.cursor = 0;
    if (this.index >= this.phrases.length) {
      this.finishedAt = now;
      return 'finish';
    }
    return 'phrase';
  }

  /** 画面が見るのはこれだけ */
  snapshot(now = performance.now()) {
    return {
      phrase: this.phrase,
      typed: this.typed,
      expected: this.expected,
      phraseIndex: this.index,
      phraseCount: this.phrases.length,
      doneChars: this.doneChars,
      totalChars: this.totalChars,
      misses: this.misses,
      started: this.started,
      finished: this.finished,
      elapsed: this.elapsed(now),
      msPerChar: this.msPerChar(now),
    };
  }
}
