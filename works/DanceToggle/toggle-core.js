// ============================================================
//  toggle-core.js — 踏んだ回数をかなに変える(マット非依存の純粋ロジック)
//
//  ここはマットも DOM も知らない。「行キーが1回踏まれた」「印が踏まれた」
//  「時間が経った」の3つだけを受け取り、そのつどスナップショットを返す。
//  マットが手元に無くてもキーボードで同じ経路を通せるのはこのため。
// ============================================================

import { RINGS, MARK_RING, TIMING } from './config.js';

/**
 * 「変種の字 → それが属する環と位置」の逆引き表。
 *
 * 確定済みの末尾に印を掛けるとき、その字がすでに「ば」なのか「は」なのかを
 * 知らないと次へ進めない。MARK_RING を1度なめて逆引きを作っておけば、
 * 未確定・確定済みのどちらにも同じ手続きで印を掛けられる。
 */
const MARK_LOOKUP = new Map();
for (const ring of Object.values(MARK_RING)) {
  ring.forEach((ch, i) => MARK_LOOKUP.set(ch, { ring, index: i }));
}

/** その字に印を掛けられるか（掛けられない字は SELECT を踏んでも無反応） */
export function canMark(ch) {
  return MARK_LOOKUP.has(ch);
}

/** 印をひとつ進めた字を返す。進められない字はそのまま返す */
export function nextMark(ch) {
  const found = MARK_LOOKUP.get(ch);
  if (!found) return ch;
  return found.ring[(found.index + 1) % found.ring.length];
}

/** その字が属する印の環（画面に「は ば ぱ」と並べるため）。無ければ null */
export function markRingOf(ch) {
  const found = MARK_LOOKUP.get(ch);
  return found ? found.ring : null;
}

/**
 * 「その字を出すにはどの面を踏むか」の逆引き表。
 *
 * 環に並んだ字だけでなく、そこから印で派生する字も同じ行に登録する
 * （「が」は か行、「っ」は た行、「ー」は わ行）。
 * タイムアタックで「お題の字を出せない面」を弾くのに使う。
 */
const ROW_OF = new Map();
for (const [row, ring] of Object.entries(RINGS)) {
  for (const ch of ring) {
    ROW_OF.set(ch, row);
    for (const marked of MARK_RING[ch] ?? []) ROW_OF.set(marked, row);
  }
}

/** その字を出せる行。出せない字なら null */
export function rowForChar(ch) {
  return ROW_OF.get(ch) ?? null;
}

/** その字がこの入力方式で打てるか。お題の検算に使う */
export function canType(ch) {
  return ROW_OF.has(ch);
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
    this.pending = null; // { row, ringIndex, markIndex, at, gapMs }
    /** 直近に受け付けた踏みの時刻。字をまたいで持ち越す（間隔を測る基準） */
    this.lastPressAt = null;
    /**
     * お題の字。null なら自由入力（従来どおり）。
     * 入っているあいだは動きが3つ変わる。
     *   - その字を出せない行の面は受け付けない（rejected を返す）
     *   - お題と一致した瞬間に確定する（待たない）
     *   - 時間切れの自動確定をしない（違う字が確定してしまうため）
     */
    this.expected = null;
  }

  /** 確定済みの文字列。chars から組み立てる（外からはこれまでどおり文字列に見える） */
  get committed() { return this.chars.map((c) => c.ch).join(''); }

  /** お題の字を設定する。null に戻すと自由入力に戻る */
  setExpected(ch) {
    this.expected = ch ?? null;
    return this;
  }

  get gated() { return this.expected !== null; }

  // ── 入力 ──────────────────────────────────────────────────

  /**
   * 行の面が1回踏まれた。
   * @param {string} row RINGS のキー（'あ' 'か' … 'わ'）
   * @param {number} now performance.now()
   */
  press(row, now = performance.now()) {
    if (!RINGS[row]) return this.snapshot(now);

    // お題の字を出せない行は受け付けない。
    // トグルは目的の字に着くまで必ず違う字を経由する（「う」は あ・い を通る）ので、
    // 弾けるのは「行が違う」ところまで。段のほうは一致するまで回してよい
    if (this.gated && row !== rowForChar(this.expected)) {
      return { ...this.snapshot(now), rejected: true };
    }

    if (this.pending && this.pending.row === row) {
      // 同じ面 → 環を1つ進める。印はここで落ちる（は→ば のあと踏めば ひ になる）
      this.pending.ringIndex = (this.pending.ringIndex + 1) % RINGS[row].length;
      this.pending.markIndex = 0;
    } else {
      // 別の面 → いま保留中の字を先に確定してから、新しい面の1字目を保留する
      this.#commit(now);
      // この字の大きさは、**踏みはじめた瞬間に決まる**。
      // 前の字の最後の踏みからここまでの「踏んでいない時間」がそれ
      this.pending = {
        row, ringIndex: 0, markIndex: 0, at: now,
        gapMs: this.lastPressAt === null ? 0 : now - this.lastPressAt,
      };
    }
    this.pending.at = now;
    this.lastPressAt = now;
    return this.#settle(now);
  }

  /**
   * 印（濁点・半濁点・小文字）の面が1回踏まれた。
   *
   * 保留中の字があればそれに掛け、**保留のまま**にする（続けて印を回せる）。
   * 保留が無ければ確定済みの末尾1字に掛ける。iOS の `^^` と同じ挙動。
   */
  pressMark(now = performance.now()) {
    if (this.pending) {
      const base = this.#baseChar();
      const ring = MARK_RING[base];
      if (ring) {
        this.pending.markIndex = (this.pending.markIndex + 1) % ring.length;
        this.pending.at = now; // 印を踏むのも「踏み」なので確定を待ち直す
        this.lastPressAt = now;
      }
      return this.#settle(now);
    }

    // お題モードでは、確定済みの字は「正解として通った字」なので後から変えさせない。
    // 掛ける相手が無いのに印を踏んだ＝踏み間違いなので、行違いと同じくミスとして返す
    if (this.gated) return { ...this.snapshot(now), rejected: true };

    if (this.chars.length > 0) {
      const tail = this.chars[this.chars.length - 1];
      const next = nextMark(tail.ch);
      if (next !== tail.ch) tail.ch = next; // 大きさ（ms）は据え置き
      this.lastPressAt = now;              // 印を踏むのも踏みなので基準は進める
    }
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

  /**
   * 時間経過。最後の踏みから commitMs 過ぎていれば自動確定する。
   * お題モードでは何もしない。放っておくと、目的の字に着く前の字が確定してしまうため
   * （確定はお題と一致した瞬間だけ、#settle が行う）。
   */
  tick(now = performance.now()) {
    if (this.gated) return this.snapshot(now);
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
    // お題モードは時間切れ確定をしないので、メーターは常に空にしておく
    const elapsed = this.pending && !this.gated ? now - this.pending.at : this.commitMs;
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
      /** 印を掛ける前の素の字。画面に「は ば ぱ」の環を出すのに使う */
      baseChar: base,
      markRing: base ? (MARK_RING[base] ?? null) : null,
      markIndex: this.pending?.markIndex ?? 0,
      /** 確定までの進み具合 0〜1。1 になった瞬間に確定する */
      commitProgress: this.pending && !this.gated ? Math.min(1, elapsed / this.commitMs) : 0,
      remainMs: this.pending && !this.gated ? remain : 0,
    };
  }

  // ── 内部 ──────────────────────────────────────────────────

  /** 保留中の「印を掛ける前」の字 */
  #baseChar() {
    return RINGS[this.pending.row][this.pending.ringIndex];
  }

  /** 保留中の字（印を掛けたあと） */
  #pendingChar() {
    const base = this.#baseChar();
    const ring = MARK_RING[base];
    if (!ring) return base;
    return ring[this.pending.markIndex % ring.length];
  }

  /**
   * 踏んだ直後の後始末。
   * お題モードで、いま出ている字がお題と一致していたら、待たずにその場で確定する。
   * @returns {object} スナップショット（一致して進んだときだけ matched: true）
   */
  #settle(now) {
    if (this.gated && this.pending && this.#pendingChar() === this.expected) {
      this.#commit(now);
      return { ...this.snapshot(now), matched: true };
    }
    return this.snapshot(now);
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
