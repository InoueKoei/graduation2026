// ============================================================
//  script.js — 配線（展示版）
//
//  MatReader（マットとキーボード）→ ToggleEngine / DuoEngine（かなの状態機械）→ ui（描画）
//  を繋ぐ薄い層。展示の流れ（モード選択 → チュートリアル → 入力）もここだけが持つ。
//  mat.js も toggle-core.js もモードや流れを知らない。
// ============================================================

import {
  MAT_TO_ROW, MAT_TO_VOWEL, TIMING, DUO, SHIFT_MODES, DEFAULT_SHIFT_MODE, DEFAULT_DUO_WIDTH,
  MODE_SLOTS, STORAGE_KEY, SELECT_KEYS, FLOW, HOME_KEY, METRONOME,
} from './config.js';
import { MatReader } from './mat.js';
import { ToggleEngine } from './toggle-core.js';
import { DuoEngine, SIDE } from './duo.js';
import { SCRIPTS, Tutorial } from './tutorial.js';
import { Metronome, bpmForTyped } from './metronome.js';
import * as ui from './ui.js';

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
    idleResetMs: FLOW.idleResetMs,
    volume: METRONOME.volume,
    shiftMode: DEFAULT_SHIFT_MODE,
    duoWidth: DEFAULT_DUO_WIDTH,
    // 初めは「調整」の札だけ。開けば次からも開いたまま出る（盤面にかぶるので既定は閉じる）
    settingsOpen: false,
    keyboard: true,
  };
  try {
    const saved = { ...base, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
    // 見せ方の名前は増減するので、残っていた値が今無ければ既定に戻す
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

/** 'select'（モード選択）→ 'tutorial' → 'input' */
let phase = 'select';
/** 'free'（ひとりで）| 'duo'（ふたりで） */
let mode = 'free';
let tutorial = null;
/** 最後に誰かが踏んでいた時刻。無操作で最初に戻すのに使う */
let lastActivity = performance.now();

const engine = new ToggleEngine(settings.commitMs);
const duo = new DuoEngine(settings.pairMs);
const metronome = new Metronome();
metronome.volume = settings.volume;
/** 入力中に打った字の数。消しても減らさない（テンポは打った量で上がる） */
let typed = 0;
/** 前のフレームで残っていた字の数。増えた分だけ typed に足す */
let lastLen = 0;

const reader = new MatReader({
  onPress: handlePress,
  onBoth: handleBoth,
  onHomeDouble: handleHomeDouble,
  onStatus: ui.setStatus,
  onFrame: frame,
});
reader.holdMs = settings.holdMs;
reader.repeatHoldMs = settings.repeatHoldMs;
reader.homeDoubleMs = settings.homeDoubleMs;
// 踏み直しを短い溜めで通してよいのは、その字をまだ回しているあいだだけ。
// 期限は確定待ちと同じなので、commitMs を動かしたらこちらも合わせる
reader.repeatWindowMs = settings.commitMs;
reader.releaseDebounceMs = settings.releaseDebounceMs;
reader.keyboardEnabled = settings.keyboard;

// ── 流れ ────────────────────────────────────────────────────

/** モード選択へ戻す。どちらのマットで選んでもよいので2台とも読む */
function goSelect() {
  phase = 'select';
  tutorial = null;
  reader.slotCount = 2;
  reader.resetInputs();
  engine.clear(); duo.clear();
  stopMetronome();
  ui.showScreen('select');
}

/** モードを決めてチュートリアルを始める */
function startMode(next) {
  mode = next;
  phase = 'tutorial';
  reader.slotCount = MODE_SLOTS[mode] ?? 1;
  reader.resetInputs();
  engine.clear(); duo.clear();
  stopMetronome();
  tutorial = new Tutorial(SCRIPTS[mode], tutorialContext());
  tutorial.start();
  showTutorialStep();
}

/** チュートリアルを終えて（または飛ばして）自由入力へ。チュートリアルの字は持ち越さない */
function startInput() {
  phase = 'input';
  tutorial = null;
  engine.clear(); duo.clear();
  typed = 0; lastLen = 0;
  metronome.start(bpmForTyped(0));
  ui.setBpm(metronome.bpm);
  ui.showScreen('play', { mode, phase });
}

function stopMetronome() {
  metronome.stop();
  ui.renderBeat(-1);
}

/** 入力中、字が増えた分だけ数えてテンポを上げる。上がった値は次の拍の間隔から効く */
function countTyped(len) {
  if (len > lastLen) typed += len - lastLen;
  lastLen = len;
  const bpm = bpmForTyped(typed);
  if (bpm !== metronome.bpm) { metronome.bpm = bpm; ui.setBpm(bpm); }
}

let shownStep = null;
function showTutorialStep() {
  const step = tutorial.step;
  if (step === shownStep) return;
  shownStep = step;
  ui.setMessage(step);
  ui.showScreen(step.screen === 'intro' ? 'intro' : 'play', { mode, phase: 'tutorial' });
}

/** チュートリアルがエンジンとマットを見るための窓口。モードの差はここで吸収する */
function tutorialContext() {
  const eng = () => (mode === 'duo' ? duo : engine);
  return {
    committed: () => eng().committed,
    hasPending: () => mode !== 'duo' && engine.pending !== null,
    chars: () => eng().chars.map((c) => ({ ...c })),
    restore: (chars) => eng().restore(chars),
    standing: (slot) => reader.pressed[slot]?.has(HOME_KEY) && (reader.holdProgress[slot]?.get(HOME_KEY) ?? 0) >= 1,
  };
}

/** いま踏んだ字を入力として通すか。チュートリアル中は字を求める段だけ通す */
function accepting() {
  if (phase === 'input') return true;
  return phase === 'tutorial' && tutorial?.accepts;
}

// ── 入力の振り分け ──────────────────────────────────────────

function handlePress(key, slot) {
  lastActivity = performance.now();

  if (phase === 'select') {
    const next = SELECT_KEYS[key];
    if (next) { ui.flashPill(next); startMode(next); }
    return;
  }
  if (!accepting()) return;

  if (mode === 'duo') { handleDuoPress(key, slot); return; }
  const row = MAT_TO_ROW[key];
  if (row) engine.press(row);
}

/**
 * ふたりで。スロット0＝子音マット（1回踏めば行が決まる。環は回さない）、
 * スロット1＝母音マット（あ い う / え お / ん）
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
 * 中央を続けて count 回（2回目から毎回）。2=濁点 3=半濁点 4=小さい字。
 * ふたりでは、どちらのマットの中央からでも掛けられる（チュートリアルでは右プレイヤーが跳ぶ）
 */
function handleHomeDouble(slot, count) {
  lastActivity = performance.now();
  if (!accepting()) return;
  if (mode === 'duo') duo.pressMark(count);
  else engine.pressMark(count);
}

/** SELECT + START の同時踏み ＝ 1字削除。ふたりでは子音マット側だけ */
function handleBoth(slot) {
  lastActivity = performance.now();
  if (!accepting()) return;
  if (mode === 'duo') {
    if (slot === 0) duo.backspace();
    return;
  }
  engine.backspace();
}

// ── 毎フレーム ──────────────────────────────────────────────

const ROW_KEY = invert(MAT_TO_ROW);
const VOWEL_KEY = invert(MAT_TO_VOWEL);
function invert(map) {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
}

const NO_LOOK = Object.freeze({ step: false, foot: false, hint: new Set() });

function frame() {
  const now = performance.now();
  ui.setSoundBlocked(metronome.blocked);

  // 誰かが乗っているあいだは「操作中」。中央で立ち止まって考えている人を追い出さない
  if (reader.pressed.some((s) => s.size > 0)) lastActivity = now;
  if (phase !== 'select' && settings.idleResetMs > 0 && now - lastActivity > settings.idleResetMs) {
    goSelect();
    return;
  }

  if (phase === 'select') return;

  if (phase === 'tutorial') {
    tutorial.update(now);
    if (tutorial.done) startInput();
    else showTutorialStep();
  }

  const looks = [0, 1].map((slot) => ({
    ...(tutorial ? tutorial.boardState(slot) : NO_LOOK),
    focus: new Set(),
  }));

  if (phase === 'input') {
    countTyped((mode === 'duo' ? duo : engine).chars.length);
    ui.renderBeat(metronome.currentBeat());
  }

  if (mode === 'duo') {
    const d = duo.tick(now);
    // 相方を待っている面は、そろうか時間切れになるまで青い枠のまま残す
    if (d.waitingSide === SIDE.consonant) looks[0].focus.add(ROW_KEY[d.waitingValue]);
    if (d.waitingSide === SIDE.vowel) looks[1].focus.add(VOWEL_KEY[d.waitingValue]);
    ui.renderBoards(reader.pressed, reader.holdProgress, looks);
    ui.renderDuo(d, duo.pairMs, settings.shiftMode, settings.duoWidth);
    return;
  }

  const snap = engine.tick(now);
  if (snap.row) looks[0].focus.add(ROW_KEY[snap.row]); // いま回している行の面
  ui.renderBoards(reader.pressed, reader.holdProgress, looks);
  ui.renderSolo(snap);
}

// ── 画面 ────────────────────────────────────────────────────

ui.fitStage();
ui.buildBoards();
ui.bindModeSelect(startMode);
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
  onPairMs: (v) => { duo.pairMs = v; settings.pairMs = v; saveSettings(settings); },
  onIdleResetMs: (v) => { settings.idleResetMs = v; saveSettings(settings); },
  onVolume: (v) => { metronome.volume = v; settings.volume = v; saveSettings(settings); },
  onKeyboard: (v) => { reader.keyboardEnabled = v; settings.keyboard = v; saveSettings(settings); },
  onShiftMode: (v) => { settings.shiftMode = v; saveSettings(settings); },
  onDuoWidth: (v) => { settings.duoWidth = v; saveSettings(settings); },
  onSettingsOpen: (v) => { settings.settingsOpen = v; saveSettings(settings); },
  onSwap: () => {
    const swapped = reader.toggleSwap();
    ui.setStatus({
      connected: reader.padCount >= 2,
      message: swapped ? '子音と母音を入れ替えました' : '割り当てを元に戻しました',
    });
  },
  onClear: () => { engine.clear(); duo.clear(); },
  onToSelect: goSelect,
  onSkipStep: () => { if (phase === 'tutorial') tutorial.skip(); },
  onToInput: () => { if (phase === 'tutorial') startInput(); },
}, settings);

/*
 * 係の人の操作。Esc でモード選択へ、Enter でチュートリアルを1段進める。
 * 来場者はマットしか触らないので、キーボードはこの2つだけ（とキーボード代替）。
 */
window.addEventListener('keydown', (e) => {
  metronome.unlock();
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'Escape') goSelect();
  else if (e.key === 'Enter' && phase === 'tutorial') { e.preventDefault(); tutorial.skip(); }
});

// 音はクリックかキーが一度来るまで出せない（metronome.js の blocked）
window.addEventListener('pointerdown', () => metronome.unlock());

goSelect();
ui.setStatus({ connected: false, message: 'マットを探しています — 挿してから一度踏んでください' });
reader.start();
