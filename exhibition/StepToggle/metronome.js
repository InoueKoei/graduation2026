// ============================================================
//  metronome.js — 入力中に下で鳴らすクリック
//
//  音は Web Audio でその場で合成する（音源ファイルを持たない）。
//  参考は onlinemetronome.app の「クリック」：短いノイズの頭に、すぐ減衰する高いサインを重ねた音。
//  1拍目は高く大きく、2拍目は低く小さく。
//
//  setTimeout だけで鳴らすとフレームの混み具合で拍がよれるので、
//  25ms ごとに「少し先までの拍」を AudioContext の時計に予約しておく（よくある先読み方式）。
// ============================================================

import { METRONOME } from './config.js';

/** 予約を見直す間隔と、どこまで先を予約しておくか */
const TICK_MS = 25;
const AHEAD_S = 0.12;

export class Metronome {
  #ctx = null;
  #noise = null;
  #timer = null;
  #nextTime = 0;
  #beat = 0;
  /** 予約済みの拍 { time, beat }。画面のランプを音に合わせて点けるのに使う */
  #queue = [];

  bpm = METRONOME.startBpm;
  volume = METRONOME.volume;

  get running() { return this.#timer !== null; }

  /**
   * 音が止められているか。ブラウザは人の操作（クリック・キー）が来るまで音を出させない。
   * マットの踏み込み（Gamepad）はその「操作」に数えられないので、
   * 展示では起動後に一度画面をクリックするか、Chrome を自動再生許可で起動する（README）。
   */
  get blocked() { return this.#ctx?.state !== 'running'; }

  /** クリックやキーのたびに呼ぶ。止められていた音を出せるようにする */
  unlock() {
    this.#ensure();
    if (this.#ctx.state !== 'running') this.#ctx.resume().catch(() => {});
  }

  start(bpm = METRONOME.startBpm) {
    this.stop();
    this.unlock();
    this.bpm = bpm;
    this.#beat = 0;
    this.#nextTime = this.#ctx.currentTime + 0.1;
    this.#timer = setInterval(() => this.#schedule(), TICK_MS);
    this.#schedule();
  }

  stop() {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this.#queue = [];
  }

  /** いま鳴っている拍（0 始まり）。まだ鳴っていない／止まっているときは -1 */
  currentBeat() {
    if (!this.#ctx || !this.running) return -1;
    const now = this.#ctx.currentTime;
    while (this.#queue.length > 1 && this.#queue[1].time <= now) this.#queue.shift();
    const head = this.#queue[0];
    return head && head.time <= now ? head.beat : -1;
  }

  #ensure() {
    if (this.#ctx) return;
    this.#ctx = new AudioContext();
    // クリックの頭に使う白色ノイズ。毎拍作らず一度だけ
    const len = Math.ceil(this.#ctx.sampleRate * 0.03);
    this.#noise = this.#ctx.createBuffer(1, len, this.#ctx.sampleRate);
    const data = this.#noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  #schedule() {
    const ctx = this.#ctx;
    // 音が止められているあいだは時計が進まない。溜めずに、出せるようになった時点から刻み直す
    if (ctx.state !== 'running') { this.#nextTime = ctx.currentTime + 0.1; return; }
    if (this.#nextTime < ctx.currentTime) this.#nextTime = ctx.currentTime + 0.02; // タブが眠っていた後
    while (this.#nextTime < ctx.currentTime + AHEAD_S) {
      this.#click(this.#nextTime, this.#beat === 0);
      this.#queue.push({ time: this.#nextTime, beat: this.#beat });
      // テンポは次の拍の間隔から効く。打った瞬間に今の拍が詰まることはない
      this.#nextTime += 60 / this.bpm;
      this.#beat = (this.#beat + 1) % METRONOME.beatsPerBar;
    }
  }

  #click(t, accent) {
    if (this.volume <= 0) return;
    const ctx = this.#ctx;
    const out = ctx.createGain();
    out.gain.value = this.volume * (accent ? 1 : 0.65);
    out.connect(ctx.destination);

    // 鳴り：高いサインをすぐ減衰させる
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1760 : 1320;
    const body = ctx.createGain();
    body.gain.setValueAtTime(0.0001, t);
    body.gain.exponentialRampToValueAtTime(0.9, t + 0.001);
    body.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(body).connect(out);
    osc.start(t);
    osc.stop(t + 0.06);

    // 頭：帯域を絞ったノイズで「カッ」という当たりを足す
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = accent ? 4200 : 3200;
    band.Q.value = 1.2;
    const hit = ctx.createGain();
    hit.gain.setValueAtTime(0.7, t);
    hit.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
    src.connect(band).connect(hit).connect(out);
    src.start(t);
    src.stop(t + 0.03);
  }
}

/** 打った字の数 → テンポ */
export function bpmForTyped(typed) {
  const { startBpm, stepBpm, charsPerStep, maxBpm } = METRONOME;
  return Math.min(maxBpm, startBpm + Math.floor(typed / charsPerStep) * stepBpm);
}
