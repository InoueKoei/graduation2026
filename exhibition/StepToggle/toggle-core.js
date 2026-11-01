// ============================================================
//  toggle-core.js — 踏んだ回数をかなに変える(マット非依存の純粋ロジック)
//
//  ここはマットも DOM も知らない。「行キーが1回踏まれた」「印が踏まれた」
//  「時間が経った」の3つだけを受け取り、そのつどスナップショットを返す。
//  マットが手元に無くてもキーボードで同じ経路を通せるのはこのため。
// ============================================================

import { RINGS, MARK_VARIANTS, MARK_KINDS, TIMING } from './config.js';

/**
 * 「印の付いた字 → 元の字」の逆引き表（ず → す、っ → つ）。
 *
 * 確定済みの末尾に印を掛け直すとき、いまの字が「ず」なのか「す」なのかに関わらず
 * 元の字から数え直したい。MARK_VARIANTS を1度なめて逆引きを作っておけば、
 * 未確定・確定済みのどちらにも同じ手続きで印を掛けられる。
 */
const BASE_OF = new Map();
for (const [base, variants] of Object.entries(MARK_VARIANTS)) {
  for (const ch of Object.values(variants)) BASE_OF.set(ch, base);
}

/** 印を外した元の字。印の付いていない字はそのまま返す */
export function baseOf(ch) {
  return BASE_OF.get(ch) ?? ch;
}

/**
 * 中央を続けて count 回踏んだときの字（展示版の約束。config.js の MARK_KINDS を見よ）。
 * 2回=濁点 3回=半濁点 4回=小さい字 5回=元の字、以降はくり返し。
 * その字に無い種類を指したら元の字を返す。
 */
export function markedChar(base, count) {
  if (count < 2) return base;
  const kind = MARK_KINDS[(count - 2) % MARK_KINDS.length];
  return (kind && MARK_VARIANTS[base]?.[kind]) || base;
}

/**
 * トグル入力の状態機械。
 *
 * 持つ状態は2つだけ。
 *   committed … 確定した文字列
 *   pending   … 未確定の1字（行・環の位置・印の位置・最後に踏んだ時刻）
 *
 * ケータイのトグルと同じ約束にしてある。
 *   - 同じ面をもう一度踏む → 環を1つ進める（末尾まで行くと先頭に戻る）
 *   - 別の面を踏む         → 未確定を先に確定してから、新しい面の1字目を保留する
 *   - 何も踏まずに待つ     → commitMs 経過で自動確定
 */
export class ToggleEngine {
  /** @param {number} commitMs 最後の踏みからこの時間で自動確定する */
  constructor(commitMs = TIMING.commitMs) {
    this.commitMs = commitMs;
    /**
     * 確定した字。**1字ごとに「前の字を打ち終えてから踏みはじめるまでの間隔」を持たせる**。
     * 画面ではこれが字の大きさになる。迷った字ほど大きく出る。
     *
     * 「その字を出すのにかかった時間」ではないことに注意。それだと
     * 「お」は5回踏むので必ず「あ」より大きくなり、行の位置を測っているだけになる。
     * 測りたいのは**踏んでいない時間**のほうで、これなら何回踏む字でも、
     * 迷わず踏めば同じ大きさになる。
     *
     * Generative Gestaltung P_3_1_1_01 の timeDelta（打鍵と打鍵の間隔を
     * 文字サイズに写す）と同じ考え方。
     */
    this.chars = []; // [{ ch, ms }]
    this.pending = null; // { row, ringIndex, markCount, at, gapMs }
    /** 直近に受け付けた踏みの時刻。字をまたいで持ち越す（間隔を測る基準） */
    this.lastPressAt = null;
  }

  /** 確定済みの文字列。chars から組み立てる（外からはこれまでどおり文字列に見える） */
  get committed() { return this.chars.map((c) => c.ch).join(''); }

  // ── 入力 ──────────────────────────────────────────────────

  /**
   * 行の面が1回踏まれた。
   * @param {string} row RINGS のキー（'あ' 'か' … 'わ'）
   * @param {number} now performance.now()
   */
  press(row, now = performance.now()) {
    if (!RINGS[row]) return this.snapshot(now);

    if (this.pending && this.pending.row === row) {
      // 同じ面 → 環を1つ進める。印はここで落ちる（は→ば のあと踏めば ひ になる）
      this.pending.ringIndex = (this.pending.ringIndex + 1) % RINGS[row].length;
      this.pending.markCount = 0;
    } else {
      // 別の面 → いま保留中の字を先に確定してから、新しい面の1字目を保留する
      this.#commit(now);
      // この字の大きさは、**踏みはじめた瞬間に決まる**。
      // 前の字の最後の踏みからここまでの「踏んでいない時間」がそれ
      this.pending = {
        row, ringIndex: 0, markCount: 0, at: now,
        gapMs: this.lastPressAt === null ? 0 : now - this.lastPressAt,
      };
    }
    this.pending.at = now;
    this.lastPressAt = now;
    return this.snapshot(now);
  }

  /**
   * 中央が続けて count 回踏まれた（2回目から毎回呼ばれる）。
   *
   * 保留中の字があればそれに掛け、**保留のまま**にする（続けて跳べば種類が変わる）。
   * 保留が無ければ確定済みの末尾1字に掛ける。どちらも「元の字＋回数」から決め直すので、
   * 途中で確定をまたいでも 3回目は半濁点になる。
   */
  pressMark(count = 2, now = performance.now()) {
    if (this.pending) {
      this.pending.markCount = count;
      this.pending.at = now; // 印を踏むのも「踏み」なので確定を待ち直す
      this.lastPressAt = now;
      return this.snapshot(now);
    }

    if (this.chars.length > 0) {
      const tail = this.chars[this.chars.length - 1];
      tail.ch = markedChar(baseOf(tail.ch), count); // 大きさ（ms）は据え置き
      this.lastPressAt = now;                        // 印を踏むのも踏みなので基準は進める
    }
    return this.snapshot(now);
  }

  /**
   * 確定済みの字を丸ごと差し替える（チュートリアルで打ち間違えたとき、段の始めに戻す）。
   * 字幅の記録（ms）ごと戻すので、打ち直した字だけが新しい幅になる。
   */
  restore(chars, now = performance.now()) {
    this.chars = chars.map((c) => ({ ...c }));
    this.pending = null;
    return this.snapshot(now);
  }

  /**
   * 1字削除（SELECT + START の同時踏み）。
   * 保留中があればそれだけを捨て、無ければ確定済みの末尾を1字消す。
   * 「いま出かかっている字を取り消す」と「打ち終えた字を消す」を1つの動作にまとめている。
   */
  backspace(now = performance.now()) {
    if (this.pending) this.pending = null;
    else this.chars.pop();
    return this.snapshot(now);
  }

  /** 時間経過。最後の踏みから commitMs 過ぎていれば自動確定する */
  tick(now = performance.now()) {
    if (this.pending && now - this.pending.at >= this.commitMs) this.#commit(now);
    return this.snapshot(now);
  }

  /** 全消し */
  clear(now = performance.now()) {
    this.chars = [];
    this.pending = null;
    this.lastPressAt = null;
    return this.snapshot(now);
  }

  // ── 取り出し ──────────────────────────────────────────────

  /**
   * UI が見るのはこれだけ。DOM 側にロジックを漏らさないため、
   * 描画に要るものはすべてここで組み立てて渡す。
   */
  snapshot(now = performance.now()) {
    const row = this.pending?.row ?? null;
    const ring = row ? RINGS[row] : null;
    const char = this.pending ? this.#pendingChar() : null;
    const base = this.pending ? this.#baseChar() : null;

    // 確定までの残り。保留が無ければ 0（メーターは空になる）
    const elapsed = this.pending ? now - this.pending.at : this.commitMs;
    const remain = Math.max(0, this.commitMs - elapsed);

    return {
      committed: this.committed,
      /** 1字ごとの {ch, ms}。画面はこれを見て字の大きさを決める */
      chars: this.chars,
      /** 保留中の字の間隔。踏みはじめた時点で決まっているので、途中で変わらない */
      pendingMs: this.pending ? this.pending.gapMs : 0,
      /** いま踏んでいない時間。次の字がどれだけ大きくなるかの目安 */
      idleMs: this.lastPressAt === null ? 0 : now - this.lastPressAt,
      text: this.committed + (char ?? ''),
      pendingChar: char,
      row,
      ring,
      ringIndex: this.pending?.ringIndex ?? -1,
      /** 印を掛ける前の素の字 */
      baseChar: base,
      markCount: this.pending?.markCount ?? 0,
      /** 確定までの進み具合 0〜1。1 になった瞬間に確定する */
      commitProgress: this.pending ? Math.min(1, elapsed / this.commitMs) : 0,
      remainMs: this.pending ? remain : 0,
    };
  }

  // ── 内部 ──────────────────────────────────────────────────

  /** 保留中の「印を掛ける前」の字 */
  #baseChar() {
    return RINGS[this.pending.row][this.pending.ringIndex];
  }

  /** 保留中の字（印を掛けたあと） */
  #pendingChar() {
    return markedChar(this.#baseChar(), this.pending.markCount);
  }

  /**
   * 保留中の字を確定済みに移す。保留が無ければ何もしない。
   * このとき「出しはじめてから確定するまで」を実測して字に添える。
   */
  #commit(now = performance.now()) {
    if (!this.pending) return;
    this.chars.push({ ch: this.#pendingChar(), ms: this.pending.gapMs });
    this.pending = null;
  }
}
