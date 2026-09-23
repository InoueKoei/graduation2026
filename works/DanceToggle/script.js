// ============================================================
//  script.js — 配線
//
//  MatReader（マットとキーボード）→ ToggleEngine（かなの状態機械）→ ui（描画）
//  を繋ぐだけの薄い層。判断はここに書かず、上の3つに置く。
//
//  モードの分岐もここだけ。mat.js も toggle-core.js もモードを知らない。
// ============================================================

import {
  MAT_TO_ROW, MAT_TO_VOWEL, TIMING, DUO, SHIFT_MODES, DEFAULT_SHIFT_MODE, DEFAULT_DUO_WIDTH,
  DEFAULT_MODE, MODE_SLOTS, STORAGE_KEY,
} from './config.js';
import { MatReader } from './mat.js';
import { ToggleEngine } from './toggle-core.js';
import { DuoEngine, SIDE } from './duo.js';
import * as ui from './ui.js';

const THEME_KEY = 'dancetoggle.theme.v1';

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

  const row = MAT_TO_ROW[key];
  if (row) engine.press(row);
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
  engine.pressMark();
}

/** SELECT + START の同時踏み */
function handleBoth(slot) {
  // 二人モードの削除は子音マット側だけ。母音マットの SELECT/START は使わない
  if (mode === 'duo') {
    if (slot === 0) duo.backspace();
    return;
  }

  engine.backspace();
}

// ── モード ──────────────────────────────────────────────────

function setMode(next) {
  const changed = next !== mode;
  mode = next;

  // 使うマットの台数はモードで変わる。切り替えのたびに踏みっぱなしを持ち越さない
  reader.slotCount = MODE_SLOTS[mode] ?? 1;
  if (changed) reader.resetInputs();

  // 打ちかけを持ち越さない。どちらのモードも空から始める
  if (changed) { engine.clear(); duo.clear(); }

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
  ui.render(engine.tick(), reader.pressed, reader.holdProgress);
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
  onClear: () => { engine.clear(); duo.clear(); },
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
