// ============================================================
//  ui.js — DOM の取り回し
//  盤面・環・入力バッファ・調整パネル・テーマをここへ閉じ込め、
//  入力ロジック側から DOM の知識を切り離す。
// ============================================================

import {
  PANEL_GRID, MAT_TO_ROW, HOME_KEY, TIMING_RANGE,
  VOWEL_PANEL_GRID, MAT_TO_VOWEL, DUO_RANGE, TIME_WIDTH, DUO_BLUR, DUO_SLICE,
  DUO_SIZE, DUO_WIDTH,
} from './config.js';

const $ = (id) => document.getElementById(id);

const el = {
  status: $('status'),
  committed: $('committed'),
  pending: $('pending'),
  commitBar: $('commit-bar'),
  commitMs: $('commit-ms'),
  board: $('board'),
  ring: $('ring'),
  markRing: $('mark-ring'),
  themeToggle: $('theme-toggle'),
  holdRange: $('hold-range'),
  holdOut: $('hold-out'),
  repeatRange: $('repeat-range'),
  repeatOut: $('repeat-out'),
  homeRange: $('home-range'),
  homeOut: $('home-out'),
  commitRange: $('commit-range'),
  commitOut: $('commit-out'),
  debounceRange: $('debounce-range'),
  debounceOut: $('debounce-out'),
  keyboardCheck: $('keyboard-check'),
  clearBtn: $('clear-btn'),

  freeView: $('free-view'),
  modeBtns: [...document.querySelectorAll('.mode-btn')],

  boardTitle: $('board-title'),
  vowelWrap: $('vowel-wrap'),
  vowelBoard: $('vowel-board'),
  ringsBlock: $('rings-block'),
  soloHint: $('solo-hint'),
  duoHintRight: $('duo-hint-right'),

  duoView: $('duo-view'),
  caret: $('caret'),
  duoBuffer: $('duo-buffer'),
  duoCaret: $('duo-caret'),
  duoSlots: document.querySelector('.duo-slots'),
  duoConsonant: $('duo-consonant'),
  duoVowel: $('duo-vowel'),
  duoBar: $('duo-bar'),
  duoMs: $('duo-ms'),
  duoGap: $('duo-gap'),

  shiftSetting: $('shift-setting'),
  shiftNote: $('shift-note'),
  pairSetting: $('pair-setting'),
  pairNote: $('pair-note'),
  shiftBtns: [...document.querySelectorAll('.shift-btn')],
  duoWidthCheck: $('duo-width-check'),
  pairRange: $('pair-range'),
  pairOut: $('pair-out'),
  swapBtn: $('swap-btn'),
  settingsToggle: $('settings-toggle'),
  settingsBody: $('settings-body'),
};

/** 秒を小数1桁で。タイムは 0.1 秒まで見せれば足りる */
const secs = (ms) => (ms / 1000).toFixed(1);

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
 * 幅を字に当てる style。
 *
 * 可変フォントの幅軸（`font-variation-settings: "wdth"`）は軸を持つフォントでしか
 * 効かず、無い端末では黙って素の幅のまま出てしまう。そこで軸には頼らず、
 * `scaleX` で字そのものを横に引き伸ばす／縮める——どのフォントでも必ず効く。
 *
 * ただし `transform` は組版の幅を変えない（掛けても隣の字は動かない）ので、
 * 足りない／余る分を `margin-right` で足し引きして字送りを合わせる。
 * かなは全角＝1em 送りなので、半分に縮めた字は右へ 0.5em 詰める。
 *
 * 箱そのものの幅はいじらない。箱に付いた飾りが、字と同じ倍率で一緒に伸び縮みするため。
 * 大きさ（font-size）は動かさないため、行の高さは揃ったまま。
 */
function widthStyle(ms) {
  return scaleXStyle(widthForMs(ms) / 100);
}

/** 横倍率 → style。字送りの補正込み（二人モードの「字幅」でも使う） */
function scaleXStyle(scale) {
  return {
    transform: `scaleX(${scale.toFixed(4)})`,
    marginRight: `${(scale - 1).toFixed(4)}em`,
  };
}

/** 幅の指定を消して素の字に戻す（未確定の字が消えたときなど） */
const NO_WIDTH = Object.freeze({ transform: '', marginRight: '' });

/**
 * 二人のずれ → ぼかし量（em）。
 * 既存作 works/boin-shiin-mvp と同じで、ずれ ÷ 許容ずれ をそのまま写す。
 * そろっているほどくっきり、ずれるほどぼける。
 */
function blurForGap(gapMs, pairMs) {
  const ratio = Math.min(1, Math.max(0, gapMs / pairMs));
  return ratio * DUO_BLUR.maxEm;
}

/**
 * 二人のずれ → 字の大きさ（em）と横幅（％）。
 *
 * ぼかし・短冊とは**向きが逆**。あちらは「ずれ＝崩れ」だが、こちらは
 * **そろうほど得をする**——ぴたりと合えば字が育ち（広がり）、ずれるほど痩せる。
 * 踏む側の動機が「崩さないように」から「合わせにいく」に変わる。
 */
function sizeForGap(gapMs, pairMs) {
  const ratio = Math.min(1, Math.max(0, gapMs / pairMs));
  // 比をそのまま写すと、実際のずれ（50〜500ms）が比の下のほうに固まって差が出ない。
  // curve 乗して小さいずれのあたりを引き伸ばす（config.js の DUO_SIZE を見よ）
  const t = ratio ** DUO_SIZE.curve;
  return DUO_SIZE.maxEm + t * (DUO_SIZE.minEm - DUO_SIZE.maxEm);
}

function duoWidthForGap(gapMs, pairMs) {
  const ratio = Math.min(1, Math.max(0, gapMs / pairMs));
  return DUO_WIDTH.maxPct + ratio * (DUO_WIDTH.minPct - DUO_WIDTH.maxPct);
}

/**
 * ずれ → 短冊の割れ方。
 *
 * 字を横に count 本の短冊へ切り、一本ずつ左右にずらす。
 * ずらし量は上端から下端へ進む正弦波で、**振幅が二人のずれ**。
 * そろっていれば一直線、ずれるほど大きく割れる。
 *
 * 既存作 works/Sessan の #paintSlices と同じ考え方（あちらは縦に切って上下へ、
 * 振幅は心拍）。こちらは canvas を持ち出さず、同じ字を count 枚重ねて
 * clip-path で一本ぶんだけ見せている。
 *
 * @returns {{amp:number, layers:Array<{clip:string, shiftEm:number}>}}
 */
function sliceLayers(gapMs, pairMs) {
  const ratio = Math.min(1, Math.max(0, gapMs / pairMs));
  const amp = ratio * DUO_SLICE.maxShiftEm;
  const n = DUO_SLICE.count;
  const layers = [];
  for (let i = 0; i < n; i++) {
    const top = (i / n) * 100;
    const bottom = 100 - ((i + 1) / n) * 100;
    // 切れ目がドット単位でずれて隙間が出ないよう、上下に少しだけ食い込ませる
    const bleed = i === 0 || i === n - 1 ? 0 : 0.35;
    layers.push({
      clip: `inset(${Math.max(0, top - bleed)}% 0 ${Math.max(0, bottom - bleed)}% 0)`,
      shiftEm: Math.sin(-(i / n) * Math.PI * 2 * DUO_SLICE.waveTurns) * amp,
    });
  }
  // 振幅も返す。割れた字ほど左右に余白を取り、自分で隣を押しのけるようにする
  // （そうしないと、大きく割れた字が隣と重なって読めなくなる）
  return { amp, layers };
}

/**
 * 1字ずつ span に分けて並べる。
 * 中身が変わっていなければ作り直さない（毎フレーム DOM を捨てると入力中にちらつく）。
 *
 * @param {HTMLElement} target
 * @param {Array} items [{ ch, style }] style は span にそのまま当てる
 * @param {string} signature 中身が同じかを見分ける鍵
 */
function renderChars(target, items, signature) {
  if (target.dataset.signature === signature) return;
  target.dataset.signature = signature;

  target.innerHTML = '';
  for (const it of items) {
    target.appendChild(it.layers ? sliceSpan(it) : plainSpan(it));
  }
}

function plainSpan(it) {
  const span = document.createElement('span');
  span.className = it.className ?? 'ch';
  span.textContent = it.ch;
  Object.assign(span.style, it.style ?? {});
  return span;
}

/**
 * 短冊に割れた1字。
 * 字送りの幅は見えない土台がそのまま担い、その上に短冊を重ねる
 * （重ねるほうを絶対配置にしているので、ずらしても行が崩れない）。
 */
function sliceSpan(it) {
  const wrap = document.createElement('span');
  wrap.className = 'ch slice';
  Object.assign(wrap.style, it.style ?? {});

  const base = document.createElement('span');
  base.className = 'slice-base';
  base.textContent = it.ch;
  wrap.appendChild(base);

  for (const layer of it.layers) {
    const el = document.createElement('span');
    el.className = 'slice-layer';
    el.textContent = it.ch;
    el.style.clipPath = layer.clip;
    el.style.transform = `translateX(${layer.shiftEm.toFixed(4)}em)`;
    wrap.appendChild(el);
  }
  return wrap;
}

/** 盤面のセル。key → DOM。毎フレーム querySelector しないため一度だけ作って持つ */
const cells = new Map();
/** 母音マットの盤面（二人モードのみ表示） */
const vowelCells = new Map();

/**
 * SELECT / START は行の頭文字ではないので、盤面に出す字を別に決める。
 * SELECT は「濁点・半濁点・小文字」の3つを1枚で兼ねるので記号を並べて示す。
 */
const SPECIAL_KANA = { [HOME_KEY]: '゛゜小' };

// ── 盤面 ────────────────────────────────────────────────────

/**
 * 盤面を1枚組む。
 * @param {HTMLElement} target 差し込み先
 * @param {ReadonlyArray} grid 面の並び（PANEL_GRID / VOWEL_PANEL_GRID）
 * @param {(key:string)=>string|undefined} labelOf その面に出す字。undefined なら「使わない面」
 * @param {Map} store key → セルの控え（毎フレーム querySelector しないため）
 */
function buildBoardInto(target, grid, labelOf, store) {
  const frag = document.createDocumentFragment();
  for (const row of grid) {
    for (const panel of row) {
      const cell = document.createElement('div');
      if (!panel) {
        cell.className = 'cell empty'; // マットの上段中央は面が無い
        frag.appendChild(cell);
        continue;
      }
      const kana = labelOf(panel.key);
      const isHome = panel.key === HOME_KEY && kana;
      cell.className = 'cell'
        + (isHome ? ' small home' : '')
        + (kana ? '' : ' unused');
      cell.innerHTML = `<span class="cell-mark"></span><span class="cell-kana"></span>`;
      cell.querySelector('.cell-mark').textContent = panel.mark;
      cell.querySelector('.cell-kana').textContent = kana ?? '・';
      store.set(panel.key, cell);
      frag.appendChild(cell);
    }
  }
  target.appendChild(frag);
}

/** 子音盤（反転）と母音盤（正の向き）を両方組んでおく。表示の出し分けは setMode が行う */
export function buildBoard() {
  buildBoardInto(el.board, PANEL_GRID, (k) => MAT_TO_ROW[k] ?? SPECIAL_KANA[k], cells);
  buildBoardInto(el.vowelBoard, VOWEL_PANEL_GRID, (k) => MAT_TO_VOWEL[k], vowelCells);
}

// ── 毎フレームの描画 ────────────────────────────────────────

/**
 * @param {object} snap ToggleEngine.snapshot() の返り値
 * @param {Set<string>} pressed いま踏まれている面
 * @param {Map<string, number>} holdProgress key → 溜めの進み具合 0〜1（受付済みは 1）
 */
export function render(snap, pressed, holdProgress) {
  paintBoard(cells, pressed[0], holdProgress[0]);
  paintBoard(vowelCells, pressed[1], holdProgress[1]);

  if (!snap) return; // 二人モードはトグルの状態を持たない

  // 確定した字は「前の字を踏み終えてから踏みはじめるまで」の間隔で幅が決まる。
  // 踏みはじめた瞬間に決まるので、確定を待つあいだに変わることはない
  const sized = snap.chars.map((c) => ({ ch: c.ch, style: widthStyle(c.ms) }));
  renderChars(el.committed, sized, snap.chars.map((c) => `${c.ch}${Math.round(c.ms / 50)}`).join(','));

  el.pending.textContent = snap.pendingChar ?? '';
  Object.assign(el.pending.style, snap.pendingChar ? widthStyle(snap.pendingMs) : NO_WIDTH);

  // カーソルは「次の字が今どれだけの幅で出るか」をそのまま幅で見せる。
  // 踏まずに止まっているほど伸び、頭打ちに達したら色で知らせる。
  //
  // 字を回しているあいだ（未確定がある）は出さない。出す側の字も薄いので、
  // 「薄い字＋線」が並ぶと、どこまでが字でどこからが次なのかが読めなくなる。
  // 1字打ち終えてから次の溜めが見えはじめる、という順番のほうが素直
  el.caret.hidden = Boolean(snap.pendingChar);
  const caretPct = widthForMs(snap.idleMs);
  el.caret.style.width = `${(caretPct / 100).toFixed(4)}em`;
  el.caret.classList.toggle('full', caretPct >= TIME_WIDTH.maxPct - 0.5);

  // 確定メーターは「残り」を出す。減っていくほうが待ちの体感に合う
  const remain = snap.pendingChar ? 1 - snap.commitProgress : 0;
  el.commitBar.style.width = `${(remain * 100).toFixed(1)}%`;
  el.commitMs.textContent = snap.pendingChar ? `${Math.round(snap.remainMs)} ms` : '—';

  renderRing(el.ring, snap.ring, snap.ringIndex, 'まだ踏まれていません');
  renderRing(el.markRing, snap.markRing, snap.markIndex, '—');
}

/** 盤面1枚ぶんの塗り替え */
function paintBoard(store, pressed, holdProgress) {
  if (!pressed) return;
  for (const [key, cell] of store) {
    const p = holdProgress?.get(key) ?? 0;
    // 溜めの途中は下から墨が満ちる。満ちきった面だけが反転して「入った」ことを示す。
    // 通過しただけの面は途中まで満ちて消えるので、拾われなかったことが目で分かる
    cell.classList.toggle('on', pressed.has(key) && p >= 1);
    cell.classList.toggle('holding', pressed.has(key) && p < 1);
    cell.style.setProperty('--hold', p.toFixed(3));
  }
}

/**
 * 環を横一列に並べ、いまの位置を強調する。
 * 「何回目を踏んでいるか」を数えずに目で確かめられるようにするための表示。
 */
function renderRing(target, ring, index, emptyText) {
  // 中身が同じなら作り直さない（毎フレーム DOM を捨てると入力中にちらつく）
  const signature = ring && ring.length ? `${ring.join('')}|${index}` : '';
  if (target.dataset.signature === signature) return;
  target.dataset.signature = signature;

  if (!signature) {
    // 空にするときも署名を '' に更新しておくこと。
    // 更新を忘れると、同じ環・同じ位置に戻ってきたときに署名が一致してしまい、
    // 「まだ踏まれていません」の表示のまま張り付く。
    target.innerHTML = `<span class="ring-empty"></span>`;
    target.firstChild.textContent = emptyText;
    return;
  }

  target.innerHTML = '';
  ring.forEach((ch, i) => {
    const item = document.createElement('span');
    item.className = i === index ? 'ring-item current' : 'ring-item';
    item.textContent = ch;
    target.appendChild(item);
  });
}

// ── 状態表示 ────────────────────────────────────────────────

export function setStatus({ connected, message }) {
  el.status.textContent = message;
  el.status.classList.toggle('connected', Boolean(connected));
}

// ── 調整パネル・テーマ ──────────────────────────────────────

/**
 * 調整パネルを配線する。値の保持は呼び出し側（script.js）の責任で、
 * ここは「動かされたら教える」だけにしてある。
 *
 * @param {object} handlers
 * @param {{commitMs:number, releaseDebounceMs:number, keyboard:boolean}} initial
 */
export function bindSettings(handlers, initial) {
  applyRange(el.holdRange, TIMING_RANGE.holdMs, initial.holdMs);
  applyRange(el.repeatRange, TIMING_RANGE.repeatHoldMs, initial.repeatHoldMs);
  applyRange(el.homeRange, TIMING_RANGE.homeDoubleMs, initial.homeDoubleMs);
  applyRange(el.commitRange, TIMING_RANGE.commitMs, initial.commitMs);
  applyRange(el.debounceRange, TIMING_RANGE.releaseDebounceMs, initial.releaseDebounceMs);
  el.keyboardCheck.checked = initial.keyboard;
  el.holdOut.textContent = `${initial.holdMs} ms`;
  el.repeatOut.textContent = `${initial.repeatHoldMs} ms`;
  el.homeOut.textContent = `${initial.homeDoubleMs} ms`;
  el.commitOut.textContent = `${initial.commitMs} ms`;
  el.debounceOut.textContent = `${initial.releaseDebounceMs} ms`;

  el.holdRange.addEventListener('input', () => {
    const v = Number(el.holdRange.value);
    el.holdOut.textContent = `${v} ms`;
    handlers.onHoldMs?.(v);
  });
  el.repeatRange.addEventListener('input', () => {
    const v = Number(el.repeatRange.value);
    el.repeatOut.textContent = `${v} ms`;
    handlers.onRepeatHoldMs?.(v);
  });
  el.homeRange.addEventListener('input', () => {
    const v = Number(el.homeRange.value);
    el.homeOut.textContent = `${v} ms`;
    handlers.onHomeDoubleMs?.(v);
  });
  el.commitRange.addEventListener('input', () => {
    const v = Number(el.commitRange.value);
    el.commitOut.textContent = `${v} ms`;
    handlers.onCommitMs?.(v);
  });
  el.debounceRange.addEventListener('input', () => {
    const v = Number(el.debounceRange.value);
    el.debounceOut.textContent = `${v} ms`;
    handlers.onDebounceMs?.(v);
  });
  el.keyboardCheck.addEventListener('change', () => handlers.onKeyboard?.(el.keyboardCheck.checked));
  el.clearBtn.addEventListener('click', () => handlers.onClear?.());
}

function applyRange(input, range, value) {
  input.min = range.min;
  input.max = range.max;
  input.step = range.step;
  input.value = value;
}

/** ライト / ダーク切替。既存作品と同じく <html data-theme> を差し替えるだけ */
export function bindTheme(storageKey) {
  const saved = localStorage.getItem(storageKey);
  if (saved) document.documentElement.dataset.theme = saved;

  el.themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(storageKey, next);
  });
}


// ── モード切替 ──────────────────────────────────────────────

export function setMode(mode) {
  const duo = mode === 'duo';

  el.freeView.hidden = duo;
  el.duoView.hidden = !duo;

  // 右カラム：二人モードだけ盤面を2枚出し、トグルの環は引っこめる
  el.vowelWrap.hidden = !duo;
  el.boardTitle.hidden = !duo;
  el.ringsBlock.hidden = duo;
  el.soloHint.hidden = duo;
  el.duoHintRight.hidden = !duo;

  // 調整パネル：二人モードでしか効かないものを出し入れする
  el.shiftSetting.hidden = !duo;
  el.shiftNote.hidden = !duo;
  el.pairSetting.hidden = !duo;
  el.pairNote.hidden = !duo;
  el.swapBtn.hidden = !duo;

  for (const btn of el.modeBtns) btn.classList.toggle('is-on', btn.dataset.mode === mode);
}

export function bindModes(onChange) {
  for (const btn of el.modeBtns) {
    btn.addEventListener('click', () => onChange(btn.dataset.mode));
  }
}

/** マットの入れ替えボタン。2台とも同じ VID/PID で、どちらが子音側かは列挙順まかせなので要る */
export function bindSwap(onSwap) {
  el.swapBtn.addEventListener('click', onSwap);
}

// ── 二人モードの描画 ────────────────────────────────────────

/**
 * @param {object} d DuoEngine.snapshot() の返り値
 */
export function renderDuo(d, pairMs, shiftMode = 'blur', widthOn = false) {
  // 「相手と合ったかどうか」がそのまま字の像として残る。
  // ぼかし・短冊は合った字ほどくっきり、大きさ・字幅は合った字ほど育つ
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

    // 字幅は上の3つのどれにも重ねられる。
    // margin は短冊の余白と取り合いになるので、まとめてここで書く
    // （em は自分の font-size 基準なので、大きさを変えた字でも送りは正しく詰まる）
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
  renderChars(el.duoBuffer, items, signature);

  // 成立しなかった組み合わせは、そのまま両側に残して一瞬見せる。
  // 「や と い を踏んだが字にならなかった」ことが分かるように、消さずに出す
  const rej = d.lastReject;
  const consonant = rej ? rej.consonant : (d.waitingSide === 'consonant' ? d.waitingValue : null);
  const vowel = rej ? rej.vowel : (d.waitingSide === 'vowel' ? d.waitingValue : null);

  el.duoConsonant.querySelector('b').textContent = consonant ?? '—';
  el.duoVowel.querySelector('b').textContent = vowel ?? '—';
  el.duoConsonant.classList.toggle('waiting', !rej && d.waitingSide === 'consonant');
  el.duoVowel.classList.toggle('waiting', !rej && d.waitingSide === 'vowel');
  el.duoSlots.classList.toggle('rejected', Boolean(rej));

  // カーソルは一人モードと同じ約束で、**相方が今踏めばどんな字になるか**を幅で見せる。
  // 一人モードは待つほど伸びるが、こちらは逆で**待つほど縮む**（ずれるほど痩せるので）。
  // 見せ方が大きさでも字幅でもないとき（ぼかし・短冊）は幅が変わらないので、素の1em のまま
  const waited = d.waitingSide ? pairMs - d.remainMs : 0;
  const caretEm = (shiftMode === 'size' ? sizeForGap(waited, pairMs) : 1)
    * (widthOn ? duoWidthForGap(waited, pairMs) / 100 : 1);
  el.duoCaret.style.width = `${caretEm.toFixed(4)}em`;

  // 相方待ちの残り時間。減っていくほうが「間に合わない」感じに合う
  el.duoBar.style.width = `${(d.waitingRemain * 100).toFixed(1)}%`;
  el.duoMs.textContent = d.waitingSide ? `${Math.round(d.remainMs)} ms` : '—';

  // 直近に成立した1文字のずれ。呼吸が合ったかどうかがそのまま数字になる
  el.duoGap.textContent = d.lastPair ? `${Math.round(d.lastPair.gapMs)} ms` : '—';
}

/** 二人モードの許容ずれスライダ */
export function bindDuoSettings(handlers, initial) {
  applyRange(el.pairRange, DUO_RANGE.pairMs, initial.pairMs);
  el.pairOut.textContent = `${initial.pairMs} ms`;
  el.pairRange.addEventListener('input', () => {
    const v = Number(el.pairRange.value);
    el.pairOut.textContent = `${v} ms`;
    handlers.onPairMs?.(v);
  });
}


/** ずれの見せ方（大きさ / ぼかし / 短冊）の切り替え */
export function bindShiftMode(onChange, initial) {
  setShiftMode(initial);
  for (const btn of el.shiftBtns) {
    btn.addEventListener('click', () => { setShiftMode(btn.dataset.shift); onChange(btn.dataset.shift); });
  }
}

/** 調整パネルの開閉。見出しがそのままボタン */
export function bindSettingsOpen(onChange, initial) {
  setSettingsOpen(initial);
  el.settingsToggle.addEventListener('click', () => {
    const open = el.settingsBody.hidden;   // 今たたまれていれば開く
    setSettingsOpen(open);
    onChange(open);
  });
}

function setSettingsOpen(open) {
  el.settingsBody.hidden = !open;
  el.settingsToggle.setAttribute('aria-expanded', String(open));
}

/** 字幅の入／切。見せ方3つのどれにも重ねられるので、ボタン列とは別立てにしてある */
export function bindDuoWidth(onChange, initial) {
  el.duoWidthCheck.checked = initial;
  el.duoWidthCheck.addEventListener('change', () => onChange(el.duoWidthCheck.checked));
}

export function setShiftMode(mode) {
  for (const btn of el.shiftBtns) btn.classList.toggle('is-on', btn.dataset.shift === mode);
}
