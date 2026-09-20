// ============================================================
//  duo.js — 二人モードの組み立て（DOM もマットも知らない純粋ロジック）
//
//  かな1文字を子音（行）と母音に割り、二人で別々のマットを踏んでそろえる。
//  「か」を踏む人と「あ」を踏む人がそろって、はじめて「か」になる。
//
//  既存作 works/boin-shiin-mvp（子音＝PCキーボード／母音＝マクロパッド）の
//  マット版にあたる。許容時間差 1500ms もあちらで二人で打って決めた値を引き継いでいる。
// ============================================================

import { DUO_KANA, DUO } from './config.js';
import { nextMark } from './toggle-core.js';

/** 片割れの種別 */
export const SIDE = Object.freeze({ consonant: 'consonant', vowel: 'vowel' });

export class DuoEngine {
  /** @param {number} pairMs 子音と母音がそろったとみなす許容時間差 */
  constructor(pairMs = DUO.pairMs) {
    this.pairMs = pairMs;
    /**
     * 出来上がった字。**1字ごとに二人のずれを持たせる**。
     * 画面ではこれが字のぼけ具合になる。呼吸が合った字ほどくっきり出る。
     */
    this.chars = []; // [{ ch, gapMs }]
    /** 相方を待っている片割れ。どちらか一方しか同時に存在しない */
    this.pending = null; // { side, value, at }
    /** 直近に成立しなかった組み合わせ（画面で一瞬見せる用） */
    this.lastReject = null; // { consonant, vowel, at }
    /** 直近に成立した1文字 */
    this.lastPair = null;   // { kana, gapMs, at }
  }

  /** 出来上がった文字列。chars から組み立てる（外からはこれまでどおり文字列に見える） */
  get committed() { return this.chars.map((c) => c.ch).join(''); }

  // ── 入力 ──────────────────────────────────────────────────

  /**
   * 片方のマットが踏まれた。
   *
   * 相方が待っていればその場で1文字にする。いなければ自分が待つ。
   * 同じ側をもう一度踏んだときは**新しいほうで上書き**する
   * （踏み間違えたときに、相方を待たせたまま踏み直せるように）。
   *
   * @param {'consonant'|'vowel'} side
   * @param {string} value 子音なら行の頭文字（'か'）、母音なら 'あ'〜'お'
   * @returns {object} スナップショット。成立したときだけ paired: true
   */
  press(side, value, now = performance.now()) {
    const waiting = this.pending;

    if (waiting && waiting.side !== side) {
      this.pending = null;
      const gapMs = now - waiting.at;

      // タイマーの遅延などで締め切りを過ぎていたら、そろわなかったものとして畳む
      if (gapMs > this.pairMs) {
        this.pending = { side, value, at: now };
        return this.snapshot(now);
      }

      const consonant = side === SIDE.consonant ? value : waiting.value;
      const vowel = side === SIDE.vowel ? value : waiting.value;
      const kana = DUO_KANA[consonant]?.[vowel];

      if (!kana) {
        // や行の「い」など、五十音図にそもそも無い組み合わせ
        this.lastReject = { consonant, vowel, at: now };
        return { ...this.snapshot(now), rejected: 'combo', consonant, vowel };
      }

      this.chars.push({ ch: kana, gapMs });
      this.lastPair = { kana, gapMs, at: now };
      return { ...this.snapshot(now), paired: true, kana, gapMs };
    }

    this.pending = { side, value, at: now };
    return this.snapshot(now);
  }

  /**
   * 濁点・半濁点・小文字。子音マットの SELECT から来る。
   *
   * 相手を待たない**一人の操作**。すでに出来上がった末尾の字に掛ける。
   * 二人で1文字を作ったあとに、子音側が一人で濁らせる形になる。
   */
  pressMark(now = performance.now()) {
    if (this.chars.length === 0) return this.snapshot(now);
    const tail = this.chars[this.chars.length - 1];
    const next = nextMark(tail.ch);
    if (next !== tail.ch) tail.ch = next; // ぼけ具合（gapMs）は据え置き
    return this.snapshot(now);
  }

  /** 1字削除。待っている片割れがあればそれを捨て、無ければ末尾を1字消す */
  backspace(now = performance.now()) {
    if (this.pending) this.pending = null;
    else this.chars.pop();
    return this.snapshot(now);
  }

  /** 時間経過。相方が来ないまま pairMs を過ぎた片割れを捨てる */
  tick(now = performance.now()) {
    if (this.pending && now - this.pending.at >= this.pairMs) this.pending = null;
    return this.snapshot(now);
  }

  clear(now = performance.now()) {
    this.chars = [];
    this.pending = null;
    this.lastPair = null;
    this.lastReject = null;
    return this.snapshot(now);
  }

  // ── 取り出し ──────────────────────────────────────────────

  /** 画面が見るのはこれだけ */
  snapshot(now = performance.now()) {
    const p = this.pending;
    const elapsed = p ? now - p.at : 0;

    return {
      committed: this.committed,
      /** 1字ごとの {ch, gapMs}。画面はこれを見てぼけ具合を決める */
      chars: this.chars,
      /** 待っている側（'consonant' | 'vowel' | null） */
      waitingSide: p?.side ?? null,
      /** 待っている片割れの中身（'か' や 'あ'） */
      waitingValue: p?.value ?? null,
      /** 締め切りまでの残り 0〜1。0 になると捨てられる */
      waitingRemain: p ? Math.max(0, 1 - elapsed / this.pairMs) : 0,
      remainMs: p ? Math.max(0, this.pairMs - elapsed) : 0,
      /** 直近に成立した1文字（ずれの実測つき） */
      lastPair: this.lastPair,
      /** 直近に弾かれた組み合わせ。表示時間を過ぎたら見せない */
      lastReject: this.lastReject && now - this.lastReject.at < DUO.rejectFlashMs
        ? this.lastReject
        : null,
    };
  }
}
