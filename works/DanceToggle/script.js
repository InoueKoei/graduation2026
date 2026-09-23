// ============================================================
//  script.js — 配線
//
//  MatReader（マットとキーボード）→ ToggleEngine（かなの状態機械）→ ui（描画）
//  を繋ぐだけの薄い層。判断はここに書かず、上の3つに置く。
//
//  モードの分岐もここだけ。mat.js はモードを知らず、
//  toggle-core.js も「お題の字」を1つ受け取るだけで、進行は game.js に閉じている。
// ============================================================

import {
  MAT_TO_ROW, MAT_TO_VOWEL, TIMING, DUO, SHIFT_MODES, DEFAULT_SHIFT_MODE, DEFAULT_DUO_WIDTH,
  DEFAULT_MODE, MODE_SLOTS, STORAGE_KEY,
} from './config.js';
import { MatReader } from './mat.js';
import { ToggleEngine, canType } from './toggle-core.js';
import { TimeAttack } from './game.js';
import { DuoEngine, SIDE } from './duo.js';
import { PHRASES, validatePhrases } from './phrases.js';
import * as ui from './ui.js';

const THEME_KEY = 'dancetoggle.theme.v1';

// お題に打てない字が混じっていないかを起動時に確かめる。
// phrases.js を書き換えたときに、踏んでみて初めて気づく事故を防ぐ
const badPhrases = validatePhrases(canType);
if (badPhrases.length) {
  console.warn('[DanceToggle] 打てない字を含むお題があります:', badPhrases);
}

// ── 設定の保持 ──────────────────────────────────────────────

/** 展示のたびに詰め直すので、スライダの値は残す */
function loadSettings() {
  const base = {
    holdMs: TIMING.holdMs,
    repeatHoldMs: TIMING.repeatHoldMs,
    homeDoubleMs: TIMING.homeDoubleMs,
    commitMs: TIMING.commitMs,
    releaseDebounceMs: TIMING.releaseDebounceMs,
    pairMs: DUO.pairMs,
    shiftMode: DEFAULT_SHIFT_MODE,
    duoWidth: DEFAULT_DUO_WIDTH,
    settingsOpen: true,
    keyboard: true,
  };
  try {
    const saved = { ...base, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
    // 見せ方の名前は増減するので、残っていた値が今無ければ既定に戻す
    // （知らない名前のままだと、どのボタンも光っていない状態になる）
    if (!(saved.shiftMode in SHIFT_MODES)) saved.shiftMode = DEFAULT_SHIFT_MODE;
    return saved;
  } catch {
    return base; // 壊れた値が入っていても起動は止めない
  }
}

function saveSettings(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* 保存できなくても動く */ }
}

const settings = loadSettings();

// ── 組み立て ────────────────────────────────────────────────

let mode = DEFAULT_MODE;
let game = null; // タイムアタック中だけ入る

const engine = new ToggleEngine(settings.commitMs);
const duo = new DuoEngine(settings.pairMs);

const reader = new MatReader({
  onPress: handlePress,
  onBoth: handleBoth,
  onHomeDouble: handleHomeDouble,
  onStatus: ui.setStatus,
  onFrame: draw,
});
reader.holdMs = settings.holdMs;
reader.repeatHoldMs = settings.repeatHoldMs;
reader.homeDoubleMs = settings.homeDoubleMs;
// 踏み直しを短い溜めで通してよいのは、その字をまだ回しているあいだだけ。
// 期限は確定待ちと同じなので、commitMs を動かしたらこちらも合わせる
reader.repeatWindowMs = settings.commitMs;
reader.releaseDebounceMs = settings.releaseDebounceMs;
reader.keyboardEnabled = settings.keyboard;

// ── 入力の振り分け ──────────────────────────────────────────

/**
 * 踏まれた面をかなの操作に振り分ける。
 * SELECT だけが行ではなく「直前の字を変化させる」面なので、ここで分ける。
 */
function handlePress(key, slot) {
  if (mode === 'duo') { handleDuoPress(key, slot); return; }

  // タイムアタックでは、最初の踏みで計測が始まる（正解でもミスでも）。
  // 位置につくまでの時間を計らないため、モードに入った時点では始めない
  if (game && !game.finished) game.startClock();

  const row = MAT_TO_ROW[key];
  const snap = row ? engine.press(row) : null;
  if (!snap || !game || game.finished) return;

  // お題の字を出せない行だった → 入力は通っていない。ミスとして数えて面を光らせる
  if (snap.rejected) {
    game.miss();
    ui.flashMiss(key);
    return;
  }

  // お題と一致して確定した → 次の字へ進める
  if (snap.matched) advanceGame();
}

/**
 * 二人モードの振り分け。
 *
 * スロット0＝子音マット（今までの盤面のまま。ただし環は回さず、1回踏めば行が決まる）
 * スロット1＝母音マット（正の向き。✕=あ ↑=い ○=う ←=え →=お）
 */
function handleDuoPress(key, slot) {
  if (slot === 1) {
    const vowel = MAT_TO_VOWEL[key];
    if (vowel) duo.press(SIDE.vowel, vowel);  // 割り当ての無い面は黙って無視
    return;
  }

  const row = MAT_TO_ROW[key];
  if (row) duo.press(SIDE.consonant, row);
}

/**
 * 中央（home）の2度踏み ＝ 濁点・半濁点・小文字。
 *
 * 中央は文字に使わず立って休む場所にしたので、空いた濁点をここへ移した。
 * home にいながらその場で踏み直すだけなので、動作としては一番軽い。
 * 濁点は頻度が高いのでこの割り当てにしている。
 */
function handleHomeDouble(slot) {
  if (mode === 'duo') {
    if (slot === 0) duo.pressMark();   // 濁点は子音マット側だけ
    return;
  }
  const snap = engine.pressMark();
  if (!game || game.finished) return;
  if (snap.rejected) { game.miss(); ui.flashMiss('center'); return; }
  if (snap.matched) advanceGame();
}

/** SELECT + START の同時踏み */
function handleBoth(slot) {
  // 二人モードの削除は子音マット側だけ。母音マットの SELECT/START は使わない
  if (mode === 'duo') {
    if (slot === 0) duo.backspace();
    return;
  }

  // タイムアタックでは確定済み＝正解として通った字なので、消させない。
  //
  // なお、お題モードでは目的の字を通り過ぎることが起きない（通った瞬間に確定するため）。
  // ここが要るのは「回している途中で分からなくなったので頭からやり直したい」ときで、
  // 出かかっている字を捨てて環の先頭に戻す逃げ道として残してある
  if (game && !game.finished) {
    if (engine.pending) engine.backspace();
    return;
  }
  engine.backspace();
}

/** 1字進める。文を打ち切ったら次の文、全部打ち切ったら終了 */
function advanceGame() {
  const what = game.advance();
  if (what === 'phrase' || what === 'finish') engine.clear();
  engine.setExpected(game.expected); // 終了時は null が入り、自由入力の挙動に戻る
}

// ── モード ──────────────────────────────────────────────────

function setMode(next, { restart = false } = {}) {
  const changed = next !== mode;
  mode = next;

  // 使うマットの台数はモードで変わる。切り替えのたびに踏みっぱなしを持ち越さない
  reader.slotCount = MODE_SLOTS[mode] ?? 1;
  if (changed) reader.resetInputs();

  if (mode === 'duo') {
    game = null;
    engine.setExpected(null);
    engine.clear();
    if (changed || restart) duo.clear();
  } else if (mode === 'game') {
    // 同じモードのまま押し直したときは引き直さない（誤操作で記録が消えないように）
    if (changed || restart || !game) {
      game = new TimeAttack(PHRASES);
      engine.clear();
      engine.setExpected(game.expected);
    }
  } else {
    game = null;
    engine.setExpected(null);
    engine.clear();
  }
  ui.setMode(mode);
  draw();
}

// ── 毎フレーム ──────────────────────────────────────────────

function draw() {
  if (mode === 'duo') {
    const d = duo.tick();
    ui.render(null, reader.pressed, reader.holdProgress); // 盤面2枚だけ塗る
    ui.renderDuo(d, duo.pairMs, settings.shiftMode, settings.duoWidth);
    return;
  }
  const snap = engine.tick();
  ui.render(snap, reader.pressed, reader.holdProgress);
  if (game) ui.renderGame(game.snapshot(), snap.pendingChar, snap.chars);
}

// ── 画面 ────────────────────────────────────────────────────

ui.buildBoard();
ui.bindTheme(THEME_KEY);
ui.bindModes(setMode);
ui.bindSettings({
  onHoldMs: (v) => { reader.holdMs = v; settings.holdMs = v; saveSettings(settings); },
  onRepeatHoldMs: (v) => { reader.repeatHoldMs = v; settings.repeatHoldMs = v; saveSettings(settings); },
  onHomeDoubleMs: (v) => { reader.homeDoubleMs = v; settings.homeDoubleMs = v; saveSettings(settings); },
  onCommitMs: (v) => {
    engine.commitMs = v;
    reader.repeatWindowMs = v;
    settings.commitMs = v; saveSettings(settings);
  },
  onDebounceMs: (v) => { reader.releaseDebounceMs = v; settings.releaseDebounceMs = v; saveSettings(settings); },
  onKeyboard: (v) => { reader.keyboardEnabled = v; settings.keyboard = v; saveSettings(settings); },
  onClear: () => {
    engine.clear(); duo.clear();
    if (game) engine.setExpected(game.expected);
  },
}, settings);

ui.bindShiftMode((v) => { settings.shiftMode = v; saveSettings(settings); draw(); }, settings.shiftMode);
ui.bindDuoWidth((v) => { settings.duoWidth = v; saveSettings(settings); draw(); }, settings.duoWidth);
ui.bindSettingsOpen((v) => { settings.settingsOpen = v; saveSettings(settings); }, settings.settingsOpen);
ui.bindDuoSettings({
  onPairMs: (v) => { duo.pairMs = v; settings.pairMs = v; saveSettings(settings); },
}, settings);
ui.bindSwap(() => {
  const swapped = reader.toggleSwap();
  ui.setStatus({
    connected: reader.padCount >= 2,
    message: swapped ? '子音と母音を入れ替えました' : '割り当てを元に戻しました',
  });
});

reader.slotCount = MODE_SLOTS[mode] ?? 1;
ui.setMode(mode);
ui.setStatus({ connected: false, message: 'マットを探しています — 挿してから一度踏んでください' });
reader.start();
