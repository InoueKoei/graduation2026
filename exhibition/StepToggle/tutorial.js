// ============================================================
//  tutorial.js — 展示版のチュートリアル
//
//  台本は Figma「卒制_UIデザイン各種」のページ「ステップ」そのまま
//  （チュートリアル-0 / 1人チュートリアル-1〜20 / 2人チュートリアル-1〜20）。
//  文言を直すときはここだけ触ればよい。画面の組み方は ui.js、進め方は下の Tutorial。
//
//  1段の書き方
//    msg   … 下の文章ウィンドウに出す本文（\n で改行）
//    sub   … 本文の右に小さく添える補足
//    step  … 中央に「ここに立つ」足あとを出すマット（0=左 / 1=右）
//    foot  … 中央に片足だけ残して見せるマット（「右足は中央に残したまま」）
//    hint  … オレンジの枠で囲む面。{ マット: [面の字] }
//    until … 先へ進む条件。書かなければ時間で進む
//              { stand: [0, 1] }   そのマットの中央に立ったら
//              { text: 'あん' }     確定した字がこうなったら（この段だけ入力を受け付ける）
//              { text, timeout }   上と同じだが、時間が来たら次の段へも進む
//    ms    … 時間で進む段の表示時間。書かなければ文の長さから決める
// ============================================================

import { MAT_TO_ROW, MAT_TO_VOWEL, FLOW } from './config.js';

/** チュートリアル-0。ひとりでもふたりでも最初に出す */
const INTRO = Object.freeze({
  screen: 'intro',
  msg: '細かいアイサツはぬきにして、やっていきましょう！\n大丈夫、すぐにわかるはず！',
});

const SOLO = [
  INTRO,
  { msg: 'まず、両足をそろえて左マットのまんなかに立ってみましょう', step: [0], until: { stand: [0] } },
  { msg: 'いい感じ！', step: [0] },
  { msg: 'カンタンに説明すると、ケータイのキーボード的な感じです。', step: [0] },
  { msg: 'とにかく、実際に文字を入力してみましょう！', step: [0] },
  { msg: 'ためしに、「あんず」と入力してみましょう！', step: [0] },
  { msg: '右足は中央に残したまま、「あ」を1回踏んでみてください。', foot: [0], hint: { 0: ['あ'] }, until: { text: 'あ' } },
  { msg: 'ばっちりです！', foot: [0], hint: { 0: ['あ'] } },
  {
    msg: '次は「ん」ですが、これは「わ」を3回踏みます。', sub: '（わ、を、んですからね）',
    foot: [0], hint: { 0: ['わ'] }, until: { text: 'あん' },
  },
  { msg: 'さすがです！', foot: [0] },
  { msg: '最後は「ず」ですが…', foot: [0] },
  { msg: 'まずはさっきと同じように、「す」を入力してみましょう。', foot: [0], until: { text: 'あんす', timeout: true } },
  { msg: 'さっきと同じですから、ヒントはありません！', foot: [0], until: { text: 'あんす' } },
  { msg: 'すばらしい！', foot: [0] },
  { msg: 'さて、「濁点」をつけないといけませんね。', foot: [0] },
  { msg: 'だまされたと思って、まんなかで2回ジャンプしてみてください！', step: [0], until: { text: 'あんず' } },
  { msg: 'カンペキです！', step: [0] },
  { msg: '半濁点（まる）は3回、小さい文字は4回ジャンプでできます。', step: [0] },
  { msg: 'ちょっとシンドイですが、いろんな文字を入れてみてください。', step: [0] },
  { msg: 'そうそう… もじはすばやいほど狭く、おそいほど広くなります。', step: [0] },
  { msg: 'テンポに合わせたり、ひたすら踏みまくったり、あとはご自由に！', step: [0] },
];

/*
 * Figma の2人チュートリアルは、5枚目が「かんじ」、10枚目以降が「ぶ」（ふ→ぶ）で
 * 食い違っていた。後半の枚数が多い「かんぶ」に揃え、11枚目の「す」も「ふ」にしてある。
 * 14枚目と15枚目は同じ文言だったので1段にまとめた。
 */
const DUO = [
  INTRO,
  { msg: 'まずはふたりとも、両足をそろえて中央に立ってみましょう', step: [0, 1], until: { stand: [0, 1] } },
  { msg: 'いい感じ！', step: [0, 1] },
  { msg: '左プレイヤーは「子音」、右プレイヤーは「母音」担当です。', step: [0, 1] },
  { msg: 'とにかく、実際に文字を入力してみましょう！', step: [0, 1] },
  { msg: 'ためしに、「かんぶ」と入力してみましょう！', step: [0, 1] },
  { msg: '左プレイヤーは「か」を、右プレイヤーは「あ」を踏みます。', hint: { 0: ['か'], 1: ['あ'] }, until: { text: 'か' } },
  { msg: 'ばっちりです！', hint: { 0: ['か'], 1: ['あ'] } },
  { msg: '次は「ん」。左プレイヤーは「わ」を、右プレイヤーは「ん」を踏みます。', hint: { 0: ['わ'], 1: ['ん'] }, until: { text: 'かん' } },
  { msg: 'さすがです！' },
  { msg: '最後は「ぶ」ですが…' },
  { msg: 'まずは今までと同じように、「ふ」を入力してみましょう。', until: { text: 'かんふ', timeout: true } },
  { msg: '今までと同じですから、ヒントはありません！', until: { text: 'かんふ' } },
  { msg: 'すばらしい！' },
  { msg: 'さて、「濁点」をつけないといけませんね。' },
  { msg: '右プレイヤーさん、まんなかで2回ジャンプしてみてください！', until: { text: 'かんぶ' } },
  { msg: 'カンペキです！' },
  { msg: '半濁点（まる）は3回、小さい文字は4回ジャンプでできます。' },
  { msg: 'そうそう… タイミングを合わせるほど、もじは大きくなります！' },
  { msg: '協力しながら、テンポに合わせたり踏みまくったり、あとはご自由に！' },
];

export const SCRIPTS = Object.freeze({ free: SOLO, duo: DUO });

/** 面の字 → 物理キー（hint を盤面のどのマスに当てるか） */
const KEY_OF = [invert(MAT_TO_ROW), invert(MAT_TO_VOWEL)];
function invert(map) {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
}

/**
 * 時間で進む段の表示時間。読み終わる前に消えないよう文の長さで伸ばし、
 * 短い相づち（「いい感じ！」）でも一呼吸は置く。
 */
function durationOf(step) {
  if (step.ms) return step.ms;
  const len = step.msg.replace(/\s/g, '').length;
  return Math.min(5200, Math.max(2600, 1400 + len * 90));
}

/** 打ち間違えた字を、消す前に見せておく時間。即座に消すと何が起きたか分からない */
const MISTAKE_SHOW_MS = 700;

/**
 * 台本を1段ずつ進める。
 *
 * 入力の中身（エンジン）とマットの状態は ctx 越しにしか見ない。
 *   ctx.committed()  確定した文字列
 *   ctx.hasPending() 未確定の字があるか（あるあいだは正誤を判定しない）
 *   ctx.chars()      確定した字の控え（打ち直しで戻す先）
 *   ctx.restore(c)   確定した字を控えに戻す
 *   ctx.standing(s)  そのマットの中央に乗っているか
 */
export class Tutorial {
  constructor(steps, ctx) {
    this.steps = steps;
    this.ctx = ctx;
    this.index = 0;
    this.done = false;
  }

  start(now = performance.now()) {
    this.#enter(0, now);
  }

  get step() { return this.steps[this.index]; }

  /** この段で踏んだ字を入力として通すか。字を求める段だけ通す */
  get accepts() { return Boolean(this.step?.until?.text); }

  /** 盤面に当てる見た目。マットごとに { step, foot, hint:Set<key> } */
  boardState(slot) {
    const s = this.step ?? {};
    const hint = new Set((s.hint?.[slot] ?? []).map((ch) => KEY_OF[slot][ch]).filter(Boolean));
    return { step: Boolean(s.step?.includes(slot)), foot: Boolean(s.foot?.includes(slot)), hint };
  }

  /** 毎フレーム呼ぶ。終わったら done が立つ */
  update(now = performance.now()) {
    if (this.done) return;
    const s = this.step;
    const until = s.until;

    if (until?.stand) {
      const all = until.stand.every((slot) => this.ctx.standing(slot));
      if (!all) { this.standSince = null; return; }
      this.standSince ??= now;
      if (now - this.standSince >= FLOW.standMs) this.#enter(this.index + 1, now);
      return;
    }

    if (until?.text) {
      this.#checkText(until.text, now);
      if (!this.done && this.step === s && until.timeout && now - this.enteredAt >= durationOf(s)) {
        this.#enter(this.index + 1, now);
      }
      return;
    }

    if (now - this.enteredAt >= durationOf(s)) this.#enter(this.index + 1, now);
  }

  /** 係の人が飛ばすとき（Enter キー） */
  skip(now = performance.now()) {
    if (!this.done) this.#enter(this.index + 1, now);
  }

  /**
   * 字を求める段の判定。
   *   - 狙いの字になった            → 同じ字を求める段をまとめて飛ばして次へ
   *   - 段の始めのまま／途中まで合っている → 待つ
   *   - それ以外（打ち間違い）       → 少し見せてから段の始めに戻す
   */
  #checkText(target, now) {
    if (this.ctx.hasPending()) { this.mistakeSince = null; return; }
    const text = this.ctx.committed();

    if (text === target) {
      let next = this.index + 1;
      while (this.steps[next]?.until?.text === target) next++;
      this.#enter(next, now);
      return;
    }

    const onTrack = text === this.entryText
      || (target.startsWith(text) && text.length > this.entryText.length);
    if (onTrack) { this.mistakeSince = null; return; }

    this.mistakeSince ??= now;
    if (now - this.mistakeSince >= MISTAKE_SHOW_MS) {
      this.ctx.restore(this.entryChars);
      this.mistakeSince = null;
    }
  }

  #enter(index, now) {
    if (index >= this.steps.length) { this.done = true; return; }
    this.index = index;
    this.enteredAt = now;
    this.standSince = null;
    this.mistakeSince = null;
    this.entryChars = this.ctx.chars();
    this.entryText = this.ctx.committed();
  }
}
