// ============================================================
//  ui.js — DOM の取り回し（展示版）
//  画面の切り替え・盤面・入力欄・文章ウィンドウ・調整パネルをここへ閉じ込め、
//  入力ロジック側から DOM の知識を切り離す。
//  見た目の数値は style.css（Figma のフレームから写したもの）にある。
// ============================================================

import {
  PANEL_GRID, MAT_TO_ROW, HOME_KEY, TIMING_RANGE,
  VOWEL_PANEL_GRID, MAT_TO_VOWEL, DUO_RANGE, TIME_WIDTH, DUO_BLUR, DUO_SLICE,
  DUO_SIZE, DUO_WIDTH, FLOW, METRONOME,
} from './config.js';

const $ = (id) => document.getElementById(id);

const el = {
  stage: $('stage'),
  screens: { select: $('screen-select'), intro: $('screen-intro'), play: $('screen-play') },
  pills: [...document.querySelectorAll('.pill')],
  introText: $('intro-text'),
  msg: $('msg'),
  msgText: $('msg-text'),
  msgSub: $('msg-sub'),
  boards: [$('board-0'), $('board-1')],
  textBox: $('text-box'),
  committed: $('committed'),
  pending: $('pending'),
  caret: $('caret'),
  beatDots: [...document.querySelectorAll('.beat-dot')],
  beatBpm: $('beat-bpm'),

  status: $('status'),
  holdRange: $('hold-range'), holdOut: $('hold-out'),
  repeatRange: $('repeat-range'), repeatOut: $('repeat-out'),
  homeRange: $('home-range'), homeOut: $('home-out'),
  commitRange: $('commit-range'), commitOut: $('commit-out'),
  debounceRange: $('debounce-range'), debounceOut: $('debounce-out'),
  pairRange: $('pair-range'), pairOut: $('pair-out'),
  idleRange: $('idle-range'), idleOut: $('idle-out'),
  volumeRange: $('volume-range'), volumeOut: $('volume-out'),
  keyboardCheck: $('keyboard-check'),
  shiftBtns: [...document.querySelectorAll('.shift-btn')],
  duoWidthCheck: $('duo-width-check'),
  swapBtn: $('swap-btn'),
  clearBtn: $('clear-btn'),
  toSelect: $('to-select'),
  skipStep: $('skip-step'),
  toInput: $('to-input'),
  settingsToggle: $('settings-toggle'),
  settingsBody: $('settings-body'),
};

// ── 舞台の縮尺 ──────────────────────────────────────────────

/**
 * 舞台を窓に収まる倍率で縮める。展示機の解像度が違っても Figma のままの比で出る。
 * 窓が縦長なら縦置きのフレーム（1080×1920）に組み替える。モニタを縦に回しても設定は要らない
 */
export function fitStage() {
  const fit = () => {
    const portrait = window.innerHeight > window.innerWidth;
    const [w, h] = portrait ? [1080, 1920] : [1920, 1080];
    const s = Math.min(window.innerWidth / w, window.innerHeight / h);
    document.documentElement.dataset.orient = portrait ? 'portrait' : 'landscape';
    document.documentElement.style.setProperty('--fit', s.toFixed(4));
  };
  fit();
  window.addEventListener('resize', fit);
}

// ── 画面の切り替え ──────────────────────────────────────────

/**
 * @param {'select'|'intro'|'play'} name
 * @param {{mode?:string, phase?:string}} [opts] play のときの組み方
 */
export function showScreen(name, opts = {}) {
  for (const [k, node] of Object.entries(el.screens)) node.hidden = k !== name;
  if (name === 'play') {
    el.screens.play.dataset.mode = opts.mode ?? 'free';
    el.screens.play.dataset.phase = opts.phase ?? 'tutorial';
  }
  // 画面の地の色は舞台の外にも広げる（窓の比が 16:9 でないとき、余白が浮かないように）
  document.body.style.background = name === 'select' ? '#fff' : '';
}

/** モード選択の2つのボタン。マットで選んだときも押した見た目にする */
export function bindModeSelect(onSelect) {
  for (const btn of el.pills) btn.addEventListener('click', () => onSelect(btn.dataset.mode));
}

export function flashPill(mode) {
  const btn = el.pills.find((b) => b.dataset.mode === mode);
  if (!btn) return;
  btn.classList.add('is-pressed');
  setTimeout(() => btn.classList.remove('is-pressed'), 180);
}

/** 文章ウィンドウ。チュートリアル-0 は独立した画面なので別の箱に書く */
export function setMessage(step) {
  const msg = step?.msg ?? '';
  if (step?.screen === 'intro') {
    el.introText.textContent = msg;
    return;
  }
  el.msgText.textContent = msg;
  el.msgSub.textContent = step?.sub ?? '';
}

// ── 盤面 ────────────────────────────────────────────────────

/** slot → key → 面の DOM。毎フレーム querySelector しないため一度だけ作って持つ */
const pads = [new Map(), new Map()];

/**
 * 盤面を1枚組む。マットの並び（PANEL_GRID）のまま 3×4 に並べる。
 * 字の無い面（母音マットの下段など）と、マットに面が無い場所は空けておく。
 * 中央だけは字が無くても白い面として出す（立つ場所なので）。
 */
function buildBoardInto(target, grid, labels, store) {
  const frag = document.createDocumentFragment();
  for (const row of grid) {
    for (const panel of row) {
      const pad = document.createElement('div');
      const isHome = panel?.key === HOME_KEY;
      const kana = panel ? labels[panel.key] : undefined;
      if (!panel || (!kana && !isHome)) {
        pad.className = 'pad is-void';
        frag.appendChild(pad);
        continue;
      }
      pad.className = isHome ? 'pad is-home' : 'pad';
      pad.innerHTML = '<span class="pad-kana"></span>'
        + '<img class="pad-step" src="assets/footprints.svg" alt="" />'
        + '<img class="pad-foot" src="assets/foot-right.svg" alt="" />';
      pad.querySelector('.pad-kana').textContent = isHome ? '' : kana;
      store.set(panel.key, pad);
      frag.appendChild(pad);
    }
  }
  target.appendChild(frag);
}

export function buildBoards() {
  buildBoardInto(el.boards[0], PANEL_GRID, MAT_TO_ROW, pads[0]);
  buildBoardInto(el.boards[1], VOWEL_PANEL_GRID, MAT_TO_VOWEL, pads[1]);
}

/**
 * 盤面2枚を塗る。
 * @param {Array<Set<string>>} pressed いま踏まれている面（スロットごと）
 * @param {Array<Map<string,number>>} holdProgress 溜めの進み具合 0〜1（受付済みは 1）
 * @param {Array<{step:boolean, foot:boolean, hint:Set<string>, focus:Set<string>}>} looks
 */
export function renderBoards(pressed, holdProgress, looks) {
  for (let slot = 0; slot < 2; slot++) {
    const look = looks[slot];
    for (const [key, pad] of pads[slot]) {
      const p = holdProgress[slot]?.get(key) ?? 0;
      const down = pressed[slot]?.has(key) ?? false;
      const isHome = key === HOME_KEY;
      const step = isHome && look.step;
      const hint = look.hint.has(key);
      // 受け付けた面と、いま回している字の面は青い枠。溜めの途中は薄く出し、
      // 通過しただけの面が拾われなかったことも見えるようにする
      // 片足を残して見せている中央は、乗っていても枠を出さない（Figma どおり）
      const quiet = step || hint || (isHome && look.foot);
      const focused = !quiet && ((down && p >= 1) || look.focus.has(key));
      pad.classList.toggle('is-step', step);
      pad.classList.toggle('is-hint', hint);
      pad.classList.toggle('is-focused', focused);
      pad.classList.toggle('is-holding', !quiet && !focused && down);
      pad.classList.toggle('has-foot', isHome && look.foot);
      pad.style.setProperty('--hold', p.toFixed(3));
    }
  }
}

// ── 入力中の文字 ────────────────────────────────────────────

/**
 * 止まっていた時間 → 字の横幅（％）。
 * 短いほど細く、長いほど広い。minMs 以下・maxMs 以上は頭打ちにする。
 */
function widthForMs(ms) {
  const { minMs, maxMs, minPct, maxPct } = TIME_WIDTH;
  const t = Math.min(1, Math.max(0, (ms - minMs) / (maxMs - minMs)));
  return minPct + t * (maxPct - minPct);
}

/**
 * 横倍率 → style。
 * `transform` は組版の幅を変えないので、足りない／余る分を margin-right で足し引きして
 * 字送りを合わせる（かなは全角＝1em 送り）。可変フォントの幅軸に頼らないので、どのフォントでも効く。
 */
function scaleXStyle(scale) {
  return { transform: `scaleX(${scale.toFixed(4)})`, marginRight: `${(scale - 1).toFixed(4)}em` };
}
const widthStyle = (ms) => scaleXStyle(widthForMs(ms) / 100);
const NO_WIDTH = Object.freeze({ transform: '', marginRight: '' });

/** ずれ → ぼかし量（em）。そろっているほどくっきり、ずれるほどぼける */
function blurForGap(gapMs, pairMs) {
  return Math.min(1, Math.max(0, gapMs / pairMs)) * DUO_BLUR.maxEm;
}

/** ずれ → 字の大きさ（em）。そろうほど育つ。curve で小さなずれを引き伸ばす（config.js） */
function sizeForGap(gapMs, pairMs) {
  const t = Math.min(1, Math.max(0, gapMs / pairMs)) ** DUO_SIZE.curve;
  return DUO_SIZE.maxEm + t * (DUO_SIZE.minEm - DUO_SIZE.maxEm);
}

function duoWidthForGap(gapMs, pairMs) {
  const ratio = Math.min(1, Math.max(0, gapMs / pairMs));
  return DUO_WIDTH.maxPct + ratio * (DUO_WIDTH.minPct - DUO_WIDTH.maxPct);
}

/** ずれ → 短冊の割れ方。字を横に切り、正弦波で左右へずらす（振幅＝ずれ） */
function sliceLayers(gapMs, pairMs) {
  const amp = Math.min(1, Math.max(0, gapMs / pairMs)) * DUO_SLICE.maxShiftEm;
  const n = DUO_SLICE.count;
  const layers = [];
  for (let i = 0; i < n; i++) {
    const top = (i / n) * 100;
    const bottom = 100 - ((i + 1) / n) * 100;
    const bleed = i === 0 || i === n - 1 ? 0 : 0.35; // 切れ目に隙間が出ないよう少し食い込ませる
    layers.push({
      clip: `inset(${Math.max(0, top - bleed)}% 0 ${Math.max(0, bottom - bleed)}% 0)`,
      shiftEm: Math.sin(-(i / n) * Math.PI * 2 * DUO_SLICE.waveTurns) * amp,
    });
  }
  return { amp, layers };
}

/**
 * 1字ずつ span に分けて並べる。
 * 中身が変わっていなければ作り直さない（毎フレーム DOM を捨てると入力中にちらつく）。
 */
function renderChars(target, items, signature) {
  if (target.dataset.signature === signature) return false;
  target.dataset.signature = signature;
  target.innerHTML = '';
  for (const it of items) target.appendChild(it.layers ? sliceSpan(it) : plainSpan(it));
  return true;
}

function plainSpan(it) {
  const span = document.createElement('span');
  span.className = 'ch';
  span.textContent = it.ch;
  Object.assign(span.style, it.style ?? {});
  return span;
}

function sliceSpan(it) {
  const wrap = document.createElement('span');
  wrap.className = 'ch slice';
  Object.assign(wrap.style, it.style ?? {});
  const base = document.createElement('span');
  base.className = 'slice-base';
  base.textContent = it.ch;
  wrap.appendChild(base);
  for (const layer of it.layers) {
    const s = document.createElement('span');
    s.className = 'slice-layer';
    s.textContent = it.ch;
    s.style.clipPath = layer.clip;
    s.style.transform = `translateX(${layer.shiftEm.toFixed(4)}em)`;
    wrap.appendChild(s);
  }
  return wrap;
}

/** 欄からあふれたら、いま打っている行が見えるよう下へ送る */
function keepTailVisible() {
  const box = el.textBox;
  if (box.scrollHeight > box.clientHeight) box.scrollTop = box.scrollHeight;
}

/** ひとりで。字幅＝踏みはじめるまでの間（すばやいほど狭く、おそいほど広い） */
export function renderSolo(snap) {
  const sized = snap.chars.map((c) => ({ ch: c.ch, style: widthStyle(c.ms) }));
  const changed = renderChars(el.committed, sized, snap.chars.map((c) => `${c.ch}${Math.round(c.ms / 50)}`).join(','));

  el.pending.textContent = snap.pendingChar ?? '';
  Object.assign(el.pending.style, snap.pendingChar ? widthStyle(snap.pendingMs) : NO_WIDTH);

  // 字を回しているあいだは出さない。1字打ち終えてから次の溜めが見えはじめる
  el.caret.hidden = Boolean(snap.pendingChar);
  const caretPct = widthForMs(snap.idleMs);
  el.caret.style.width = `${(caretPct / 100).toFixed(4)}em`;
  el.caret.classList.toggle('full', caretPct >= TIME_WIDTH.maxPct - 0.5);

  if (changed) keepTailVisible();
}

/** ふたりで。ずれの見せ方（大きさ／ぼかし／短冊）と字幅の入／切 */
export function renderDuo(d, pairMs, shiftMode = 'size', widthOn = false) {
  const items = d.chars.map((c) => {
    const style = {};
    let layers = null;
    let pad = 0; // 短冊が隣を押しのけるぶんの余白（em）

    if (shiftMode === 'slice') {
      const r = sliceLayers(c.gapMs, pairMs);
      layers = r.layers;
      pad = r.amp;
    } else if (shiftMode === 'size') {
      style.fontSize = `${sizeForGap(c.gapMs, pairMs).toFixed(4)}em`;
    } else {
      style.filter = `blur(${blurForGap(c.gapMs, pairMs).toFixed(4)}em)`;
    }

    const scale = widthOn ? duoWidthForGap(c.gapMs, pairMs) / 100 : 1;
    if (widthOn) style.transform = `scaleX(${scale.toFixed(4)})`;
    if (pad || widthOn) {
      style.marginLeft = `${pad.toFixed(4)}em`;
      style.marginRight = `${(pad + scale - 1).toFixed(4)}em`;
    }
    return { ch: c.ch, layers, style };
  });
  const signature = `${shiftMode}${widthOn ? '+w' : ''}|`
    + d.chars.map((c) => `${c.ch}${Math.round(c.gapMs / 25)}`).join(',');
  const changed = renderChars(el.committed, items, signature);

  el.pending.textContent = '';
  Object.assign(el.pending.style, NO_WIDTH);

  // カーソルは「相方が今踏めばどんな字になるか」。待つほど縮む（ずれるほど痩せるので）
  const waited = d.waitingSide ? pairMs - d.remainMs : 0;
  const caretEm = (shiftMode === 'size' ? sizeForGap(waited, pairMs) : 1)
    * (widthOn ? duoWidthForGap(waited, pairMs) / 100 : 1);
  el.caret.hidden = false;
  el.caret.classList.remove('full');
  el.caret.style.width = `${caretEm.toFixed(4)}em`;

  if (changed) keepTailVisible();
}

// ── メトロノーム ────────────────────────────────────────────

/** いま鳴っている拍のランプを点ける。-1 なら全部消す */
export function renderBeat(beat) {
  el.beatDots.forEach((dot, i) => dot.classList.toggle('is-on', i === beat));
}

export function setBpm(bpm) {
  el.beatBpm.textContent = `${bpm}BPM`;
}

/**
 * 音が止められているとき、係の人に分かるよう「調整」の札に一言添える。
 * 来場者の目に入らないよう、札と同じ小ささのまま
 */
export function setSoundBlocked(blocked) {
  const label = blocked ? '調整・音を出すには画面をクリック' : '調整';
  if (el.settingsToggle.textContent !== label) el.settingsToggle.textContent = label;
}

// ── 状態表示 ────────────────────────────────────────────────

export function setStatus({ connected, message }) {
  el.status.textContent = message;
  el.status.classList.toggle('connected', Boolean(connected));
}

// ── 調整パネル ──────────────────────────────────────────────

function applyRange(input, range, value) {
  input.min = range.min;
  input.max = range.max;
  input.step = range.step;
  input.value = value;
}

/** スライダ1本ぶんの配線。値の保持は呼び出し側（script.js）の責任 */
function bindRange(input, out, range, value, format, onChange) {
  applyRange(input, range, value);
  out.textContent = format(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    onChange?.(v);
  });
}

const ms = (v) => `${v} ms`;
const sec = (v) => (v ? `${Math.round(v / 1000)} 秒` : '切');
const pct = (v) => (v ? `${Math.round(v * 100)}%` : '切');

export function bindSettings(handlers, initial) {
  bindRange(el.holdRange, el.holdOut, TIMING_RANGE.holdMs, initial.holdMs, ms, handlers.onHoldMs);
  bindRange(el.repeatRange, el.repeatOut, TIMING_RANGE.repeatHoldMs, initial.repeatHoldMs, ms, handlers.onRepeatHoldMs);
  bindRange(el.homeRange, el.homeOut, TIMING_RANGE.homeDoubleMs, initial.homeDoubleMs, ms, handlers.onHomeDoubleMs);
  bindRange(el.commitRange, el.commitOut, TIMING_RANGE.commitMs, initial.commitMs, ms, handlers.onCommitMs);
  bindRange(el.debounceRange, el.debounceOut, TIMING_RANGE.releaseDebounceMs, initial.releaseDebounceMs, ms, handlers.onDebounceMs);
  bindRange(el.pairRange, el.pairOut, DUO_RANGE.pairMs, initial.pairMs, ms, handlers.onPairMs);
  bindRange(el.idleRange, el.idleOut, FLOW.idleResetRange, initial.idleResetMs, sec, handlers.onIdleResetMs);
  bindRange(el.volumeRange, el.volumeOut, METRONOME.volumeRange, initial.volume, pct, handlers.onVolume);

  el.keyboardCheck.checked = initial.keyboard;
  el.keyboardCheck.addEventListener('change', () => handlers.onKeyboard?.(el.keyboardCheck.checked));

  setShiftMode(initial.shiftMode);
  for (const btn of el.shiftBtns) {
    btn.addEventListener('click', () => { setShiftMode(btn.dataset.shift); handlers.onShiftMode?.(btn.dataset.shift); });
  }
  el.duoWidthCheck.checked = initial.duoWidth;
  el.duoWidthCheck.addEventListener('change', () => handlers.onDuoWidth?.(el.duoWidthCheck.checked));

  el.swapBtn.addEventListener('click', () => handlers.onSwap?.());
  el.clearBtn.addEventListener('click', () => handlers.onClear?.());
  el.toSelect.addEventListener('click', () => handlers.onToSelect?.());
  el.skipStep.addEventListener('click', () => handlers.onSkipStep?.());
  el.toInput.addEventListener('click', () => handlers.onToInput?.());

  setSettingsOpen(initial.settingsOpen);
  el.settingsToggle.addEventListener('click', () => {
    const open = el.settingsBody.hidden; // 今たたまれていれば開く
    setSettingsOpen(open);
    handlers.onSettingsOpen?.(open);
  });
}

function setShiftMode(mode) {
  for (const btn of el.shiftBtns) btn.classList.toggle('is-on', btn.dataset.shift === mode);
}

function setSettingsOpen(open) {
  el.settingsBody.hidden = !open;
  el.settingsToggle.setAttribute('aria-expanded', String(open));
}
