// ============================================================
//  mat.js — マットの読み取り
//
//  責務は「Gamepad の生の状態を、意味のあるイベントに変える」ことだけ。
//  かなの知識は持たない。キーボード代替も同じ経路に合流させてあるので、
//  この下（toggle-core.js / duo.js）はマットの有無を知らずに済む。
//
//  マットは最大2台。スロット0＝子音マット、スロット1＝母音マット（二人モードのみ）。
//  溜め・デバウンス・同時踏みの判定はすべて**スロットごとに独立**している。
//  二人が別々のマットで同時に踏んでも、互いの判定に干渉しない。
// ============================================================

import { BUTTON, CENTER_AXIS, PAD_HINTS, TIMING, KEYBOARD_FALLBACK, HOME_KEY } from './config.js';

/** マットの11入力。盤面の並びではなく、読み取り順の一覧 */
const ALL_KEYS = Object.freeze([
  'left', 'down', 'up', 'right',
  'square', 'triangle', 'cross', 'circle',
  'select', 'start', 'center',
]);

/** 削除に使う対（この2つが同時に踏まれたら press ではなく both になる） */
const PAIR = Object.freeze(['select', 'start']);

/** 対応する最大スロット数 */
const MAX_SLOTS = 2;

/** 内部の状態は「どのマットのどの面か」で引くので、スロット番号込みの鍵にする */
const idOf = (slot, key) => `${slot}:${key}`;

/** まだ一度も受け付けていない状態 */
const NO_FIRE = Object.freeze({ id: null, key: null, at: -Infinity });

/**
 * @typedef {object} MatCallbacks
 * @property {(key:string, slot:number)=>void} onPress 1回踏まれた（溜め・デバウンス済み）
 * @property {(slot:number)=>void}             onBoth  SELECT+START の同時踏み
 * @property {(state:{connected:boolean, message:string, padCount:number})=>void} onStatus
 * @property {()=>void}                        onFrame 毎フレーム（UI の再描画用）
 */

export class MatReader {
  /** @param {MatCallbacks} callbacks */
  constructor(callbacks) {
    this.cb = callbacks;
    this.holdMs = TIMING.holdMs;
    this.repeatHoldMs = TIMING.repeatHoldMs;
    this.homeDoubleMs = TIMING.homeDoubleMs;
    this.bothMs = TIMING.bothMs;
    this.releaseDebounceMs = TIMING.releaseDebounceMs;
    /**
     * 「同じ面の踏み直し」とみなす有効期限。
     * 踏み直しが短い溜めで通ってよいのは、その面の字をまだ回している最中だから。
     * script.js が commitMs と同じ値を入れる（＝未確定の字が生きているあいだ）。
     */
    this.repeatWindowMs = TIMING.commitMs;
    this.keyboardEnabled = true;

    /** いま使うスロット数。1＝1台（既定）、2＝二人モード */
    this.slotCount = 1;
    /**
     * 2台の割り当てを入れ替える。
     * 2台とも同じ VID/PID なので、どちらが子音側になるかは Gamepad の index 順
     * ＝ USB の列挙順まかせ。物理的に逆だったときの唯一の逃げ道がこれ。
     */
    this.swapped = false;

    /** slot → いま踏まれている面の Set（盤面表示用） */
    this.pressed = [new Set(), new Set()];
    /** slot → key → 溜めの進み具合 0〜1（受け付け済みは 1）。盤面に墨が満ちる表示に使う */
    this.holdProgress = [new Map(), new Map()];
    /** 見つかったマットの台数 */
    this.padCount = 0;

    this.#raw = { gamepad: new Set(), keyboard: new Set() }; // どちらも "slot:key" を持つ
    this.#down = new Set();
    this.#hold = new Map();
    this.#lastFired = [NO_FIRE, NO_FIRE];
    this.#pair = [null, null];
    this.#padKey = '';
    this.#running = false;
  }

  #raw; #down; #hold; #lastFired; #pair; #padKey; #running;

  // ── 開始 ──────────────────────────────────────────────────

  start() {
    if (this.#running) return;
    this.#running = true;

    window.addEventListener('keydown', this.#onKeyDown);
    window.addEventListener('keyup', this.#onKeyUp);
    // 別ウィンドウに移った隙に押しっぱなしが残らないように
    window.addEventListener('blur', this.#onBlur);

    // Chrome はこのイベントでもパッドを教えてくれるが、これだけには頼らない。
    // 実測では「一度踏むまで getGamepads() が null を返す」ことがあるため、
    // 毎フレーム探し直すのが確実（ナレッジ 3章の注意）。
    window.addEventListener('gamepadconnected', this.#onGamepad);
    window.addEventListener('gamepaddisconnected', this.#onGamepad);

    this.#loop();
  }

  stop() {
    this.#running = false;
    window.removeEventListener('keydown', this.#onKeyDown);
    window.removeEventListener('keyup', this.#onKeyUp);
    window.removeEventListener('blur', this.#onBlur);
    window.removeEventListener('gamepadconnected', this.#onGamepad);
    window.removeEventListener('gamepaddisconnected', this.#onGamepad);
  }

  // ── 毎フレーム ────────────────────────────────────────────

  #loop = () => {
    if (!this.#running) return;
    const now = performance.now();

    this.#readGamepads();

    // Gamepad は「読みに行く」しかないので、ここで前フレームとの差を見る。
    // キーボードは押した瞬間にイベントが来るので、そちらは #onKeyDown で直に処理する
    // （1フレームより短い打鍵を取りこぼさないため）。合流点は #edgeDown / #edgeUp。
    for (let slot = 0; slot < this.slotCount; slot++) {
      for (const key of ALL_KEYS) {
        const id = idOf(slot, key);
        const isDown = this.#raw.gamepad.has(id) || this.#raw.keyboard.has(id);
        const wasDown = this.#down.has(id);
        if (isDown && !wasDown) this.#edgeDown(id, slot, key, now);
        else if (!isDown && wasDown) this.#edgeUp(id, now);
      }
    }

    this.#updateHolds(now);

    this.cb.onFrame?.();
    requestAnimationFrame(this.#loop);
  };

  /**
   * 溜めの進行。踏み続けている面が holdMs に届いたらそこで初めて入力として通す。
   *
   * ここが「移動の途中で通過した面」を落とす仕掛け。
   * 通過した面は holdMs に届く前に足が離れるので、一度も通らずに捨てられる。
   */
  #updateHolds(now) {
    const pressed = [new Set(), new Set()];
    const progress = [new Map(), new Map()];

    for (const [id, st] of this.#hold) {
      // 離れが releaseDebounceMs より長く続いたら、本当に足が離れたとみなす。
      // それより短い離れはチャタリングの跳ね返りなので、溜めを引き継いだまま踏み続けとして扱う
      if (st.releasedAt !== null && now - st.releasedAt >= this.releaseDebounceMs) {
        this.#hold.delete(id);
        continue;
      }

      if (!st.fired && now - st.downAt >= st.need) {
        st.fired = true;
        const prev = this.#lastFired[st.slot];           // 更新前を控えてから差し替える
        this.#lastFired[st.slot] = { id, key: st.key, at: now };

        if (st.key === HOME_KEY) this.#onHomeKey(st.slot, prev, now);
        else if (PAIR.includes(st.key)) this.#onPairKey(st.slot, st.key, now);
        else this.cb.onPress?.(st.key, st.slot);
      }

      pressed[st.slot].add(st.key);
      progress[st.slot].set(st.key, st.fired ? 1 : Math.min(1, (now - st.downAt) / (st.need || 1)));
    }

    this.pressed = pressed;
    this.holdProgress = progress;
  }

  /**
   * Gamepad の現在状態を読む。
   *
   * 対象パッドは製品名か VID/PID で絞る（ナレッジ 13章）。どれにも当たらなければ
   * 見つかったパッドをそのまま使う。別のパッドを挿していると誤爆するが、
   * 「マットのつもりで挿したのに認識されない」ほうが困るのでこちらを優先する。
   *
   * 2台とも id が同一（"USB Joystick ... Vendor: 0079 Product: 0006"）なので、
   * 区別できるのは index だけ。index の昇順でスロットに割り当てる。
   */
  #readGamepads() {
    const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean);
    const mats = pads.filter((g) => PAD_HINTS.some((h) => g.id.toLowerCase().includes(h)));
    const list = (mats.length ? mats : pads).sort((a, b) => a.index - b.index);

    // 入れ替えは先頭2つだけを交換する（3台以上挿さっていても壊さない）
    const ordered = this.swapped && list.length >= 2
      ? [list[1], list[0], ...list.slice(2)]
      : list;

    this.padCount = list.length;
    this.#reportStatus(ordered);

    const next = new Set();
    for (let slot = 0; slot < this.slotCount; slot++) {
      const pad = ordered[slot];
      if (!pad) continue;
      for (const [key, i] of Object.entries(BUTTON)) {
        if (pad.buttons[i]?.pressed) next.add(idOf(slot, key));
      }
      // 中央パネルだけはボタンではなく軸に出る（生 HID では data[1] の最上位ビット）
      if ((pad.axes[CENTER_AXIS.index] ?? 0) > CENTER_AXIS.threshold) next.add(idOf(slot, 'center'));
    }
    this.#raw.gamepad = next;
  }

  /** 接続状況は中身が変わったときだけ伝える（毎フレーム文字列を作らない） */
  #reportStatus(ordered) {
    const need = this.slotCount;
    const found = ordered.slice(0, need).filter(Boolean).length;
    const key = `${found}/${need}/${ordered.slice(0, need).map((g) => g?.index ?? '-').join(',')}`;
    if (key === this.#padKey) return;
    this.#padKey = key;

    if (found === 0) {
      this.cb.onStatus?.({
        connected: false, padCount: this.padCount,
        message: 'マット未接続 — 挿してから一度踏んでください',
      });
      return;
    }
    if (found < need) {
      this.cb.onStatus?.({
        connected: false, padCount: this.padCount,
        message: `マットが ${found} 台だけ — 二人モードは2台要ります（2台目を挿して一度踏む）`,
      });
      return;
    }
    const where = need === 1
      ? `接続：Joy${ordered[0].index}`
      : `接続：子音=Joy${ordered[0].index} / 母音=Joy${ordered[1].index}`;
    this.cb.onStatus?.({ connected: true, padCount: this.padCount, message: where });
  }

  /** 子音側と母音側を入れ替える。物理的に逆だったとき用 */
  toggleSwap() {
    this.swapped = !this.swapped;
    this.#padKey = '';   // 状況表示を出し直させる
    this.resetInputs();  // 踏みっぱなしの状態を持ち越さない
    return this.swapped;
  }

  /** モードを切り替えるときなど、入力状態を白紙に戻す */
  resetInputs() {
    this.#down.clear();
    this.#hold.clear();
    this.#raw.gamepad = new Set();
    this.#raw.keyboard = new Set();
    this.#lastFired = [NO_FIRE, NO_FIRE];
    for (const p of this.#pair) if (p) clearTimeout(p.timer);
    this.#pair = [null, null];
    this.pressed = [new Set(), new Set()];
    this.holdProgress = [new Map(), new Map()];
  }

  // ── エッジの処理 ──────────────────────────────────────────

  /**
   * 踏まれた瞬間。マットからでもキーボードからでもここに合流する。
   * ここでは入力として通さず、溜めを始めるだけ（通すのは #updateHolds）。
   *
   * マットの接点は金属箔なので、着地の衝撃で ON/OFF が数ミリ秒で往復する（チャタリング）。
   * 跳ね返りのたびに溜めを 0 から数え直すと、いつまでも holdMs に届かない。
   * 離れてから releaseDebounceMs 以内に戻ってきた踏みは同じストロークの続きとみなし、
   * **溜めを引き継ぐ**。
   */
  #edgeDown(id, slot, key, now) {
    if (this.#down.has(id)) return;
    this.#down.add(id);

    const st = this.#hold.get(id);
    if (st && st.releasedAt !== null && now - st.releasedAt < this.releaseDebounceMs) {
      st.releasedAt = null; // 跳ね返り。downAt も need も fired もそのまま
      return;
    }
    // 要る溜めは踏み始めに決めて state に持たせる。途中で判定が変わらないようにするため
    this.#hold.set(id, {
      slot, key, downAt: now, need: this.#neededHold(id, slot, now),
      fired: false, releasedAt: null,
    });
  }

  /**
   * この踏みに要る溜めを決める。
   *
   * 溜めが要るのは移動があるからで、通過してしまう面があるのは「別の面へ足を運ぶ」ときだけ。
   * **直前に受け付けたのと同じ面を、その字をまだ回しているあいだに踏み直した**なら、
   * 足はその面から動いていない。通過の危険が無いので短い溜めで通す。
   *
   * 直前の踏みは**スロットごとに**覚えている。相方が別のマットを踏んでも、
   * こちらの「踏み直し」判定は影響を受けない。
   */
  #neededHold(id, slot, now) {
    const last = this.#lastFired[slot];
    const isRepeat = last.id !== null && id === last.id && now - last.at < this.repeatWindowMs;
    return isRepeat ? Math.min(this.repeatHoldMs, this.holdMs) : this.holdMs;
  }

  /**
   * 離れた瞬間。ここでは溜めを捨てない。
   * チャタリングかもしれないので時刻だけ控え、判断は #updateHolds に任せる。
   */
  #edgeUp(id, now) {
    if (!this.#down.has(id)) return;
    this.#down.delete(id);
    const st = this.#hold.get(id);
    if (st && st.releasedAt === null) st.releasedAt = now;
  }

  /**
   * 中央（home）。
   *
   * **1回踏んだだけでは何も起こさない。**ここは立って休む場所で、
   * 文字を割り当てると休むたび・戻るたびに1字打たれてしまうため。
   *
   * 直前に受け付けたのも中央で、猶予内なら「2度踏み」とみなして濁点に回す。
   * 「直前の受付が中央であること」まで見ているので、よそを踏んでから
   * 戻ってきただけでは成立しない（それは移動であって、踏み直しではない）。
   */
  #onHomeKey(slot, prev, now) {
    const isDouble = prev.key === HOME_KEY && now - prev.at < this.homeDoubleMs;
    if (!isDouble) return; // 1度目。休んでいるだけかもしれないので黙っている

    this.#lastFired[slot] = NO_FIRE; // 3度目が続けて成立しないように区切る
    this.cb.onHomeDouble?.(slot);
  }

  /**
   * SELECT / START は、単体なら「な行」「わ行」、同時なら「削除」。
   * 両足で踏むので完全同時にはならず 50〜150ms ずれるため、どちらなのかは
   * 片方が来た瞬間には決められない。
   *
   * ただし holdMs の溜めを入れてからは、待つ必要がほとんど無くなった。
   * 片方の溜めが満ちる頃には、もう片方はすでに足の下にあるからで、
   * その場合は待たずに同時踏みと判定できる（下の「相方がすでに足の下」）。
   *
   * 相方がまだ来ていないときだけ、足りない分（bothMs − holdMs）を待つ。
   * holdMs が bothMs 以上なら溜めだけで窓が足りているので、待ち時間は 0 になる。
   *
   * 判定は**同じマットの中だけ**で閉じる。子音マットの SELECT と
   * 母音マットの START を同時に踏んでも削除にはならない。
   */
  #onPairKey(slot, key, now) {
    const other = PAIR.find((k) => k !== key);
    const pair = this.#pair[slot];

    // 相方が先に発火して待っている最中に来た → 同時踏み
    if (pair && pair.key === other) {
      clearTimeout(pair.timer);
      this.#pair[slot] = null;
      this.cb.onBoth?.(slot);
      return;
    }
    if (pair) return; // 同じ側。相方待ちは1つだけ

    // 相方がすでに足の下にある（溜めの途中でもよい）→ 待たずに同時踏み。
    // 相方が後から単体で発火しないよう、そちらの溜めも使用済みにしておく
    const otherHold = this.#hold.get(idOf(slot, other));
    if (otherHold && otherHold.releasedAt === null) {
      otherHold.fired = true;
      this.cb.onBoth?.(slot);
      return;
    }

    const wait = Math.max(0, this.bothMs - this.holdMs);
    if (wait === 0) { this.cb.onPress?.(key, slot); return; }

    const timer = setTimeout(() => {
      this.#pair[slot] = null;
      this.cb.onPress?.(key, slot);
    }, wait);
    this.#pair[slot] = { key, timer, at: now };
  }

  // ── キーボード代替 ────────────────────────────────────────

  /**
   * キーボードは押した瞬間にそのままエッジを通す。
   * フレーム境界を待つと、1フレーム（約16ms）より短い打鍵が丸ごと落ちる。
   * マットは接触が 100ms 以上あるので取りこぼさないが、指はそこまで待ってくれない。
   */
  #onKeyDown = (e) => {
    if (!this.keyboardEnabled || e.repeat) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const hit = KEYBOARD_FALLBACK[e.code];
    if (!hit) return;
    const [slot, key] = hit;
    if (slot >= this.slotCount) return; // いまのモードで使わないマットのキーは無視
    e.preventDefault();
    const id = idOf(slot, key);
    this.#raw.keyboard.add(id);
    this.#edgeDown(id, slot, key, performance.now());
  };

  #onKeyUp = (e) => {
    const hit = KEYBOARD_FALLBACK[e.code];
    if (!hit) return;
    const id = idOf(hit[0], hit[1]);
    this.#raw.keyboard.delete(id);
    if (!this.#raw.gamepad.has(id)) this.#edgeUp(id, performance.now());
  };

  /** 別ウィンドウに移った隙に押しっぱなしが残らないように、キーボード側だけ落とす */
  #onBlur = () => {
    const now = performance.now();
    for (const id of this.#raw.keyboard) {
      if (!this.#raw.gamepad.has(id)) this.#edgeUp(id, now);
    }
    this.#raw.keyboard.clear();
  };

  #onGamepad = () => { this.#padKey = ''; }; // 次のフレームで探し直させる
}
