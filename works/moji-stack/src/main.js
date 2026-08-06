// エントリポイント: UI(書体／ウェイト／サイズ／デスクトップ書体／入力／リセット) とシーンの接続。

import { FONT_FAMILIES, CURATED_FONTS, SIZE } from './fonts.js';
import { loadFont, buildLetterGeometry } from './glyph.js';
import { createScene } from './scene.js';
import { createVoiceInput } from './voice.js';
import { createFontMenu } from './fontmenu.js';

const canvas = document.getElementById('stage');
const weightSelect = document.getElementById('weight-select');
const randomFontCheck = document.getElementById('random-font');
const randomColorCheck = document.getElementById('random-color');
const voiceBtn = document.getElementById('voice-btn');
const alignBtn = document.getElementById('align-btn');
const alignModal = document.getElementById('align-modal');
const alignBody = document.getElementById('align-body');
const alignClose = document.getElementById('align-close');
const bgColor = document.getElementById('bg-color');
const inkColor = document.getElementById('ink-color');
const sizeRange = document.getElementById('size-range');
const charInput = document.getElementById('char-input');
const resetBtn = document.getElementById('reset-btn');
const hint = document.getElementById('hint');
const permOverlay = document.getElementById('font-permission');
const permBtn = document.getElementById('font-permission-btn');

const scene = createScene(canvas);

// OS 標準ではないカスタム書体ドロップダウン（選択肢をその書体で表示）
const fontMenu = createFontMenu({
  button: document.getElementById('font-menu-button'),
  current: document.getElementById('font-menu-current'),
  list: document.getElementById('font-menu-list'),
  onChange: onFontChange,
});

let currentFont = null;
let fontSize = SIZE.default;
let dropX = window.innerWidth / 2; // 矢印キーで調整できる落下 X 座標
// 実際にインストールされていた限定リストの書体。
// 各要素 = { label, family(CSS表示用), faces: FontData[] }
let availableCurated = [];
// 表示する書体リスト（public/fonts.json から読み込む。失敗時は CURATED_FONTS）
let curatedList = CURATED_FONTS;

function isRandom() { return randomFontCheck.checked; }
function isColorRandom() { return randomColorCheck.checked; }

// ランダム文字色（彩度・明度を確保した HSL）
function randomColor() {
  const h = Math.floor(Math.random() * 360);
  const s = 60 + Math.floor(Math.random() * 25); // 60–85%
  const l = 45 + Math.floor(Math.random() * 15); // 45–60%
  return `hsl(${h}, ${s}%, ${l}%)`;
}

window.addEventListener('resize', () => {
  dropX = window.innerWidth / 2;
  scene.setPreviewX(dropX);
});

function setHint(text) {
  hint.textContent = text;
}

// 現在選択中の書体の表示名
function currentFontLabel() {
  const fam = fontMenu.getLabel();
  const w = weightSelect.selectedOptions[0]?.textContent ?? '';
  return `${fam} ${w}`.trim();
}

// 現在選択中の書体の CSS ファミリー名（整列モードでの再描画用）
function currentCssFamily() {
  return isSystemSelection() ? selectedCuratedEntry()?.family || null : BUNDLED_CSS_FAMILY;
}

// --- 整列モード -----------------------------------------------------------
// これまで出た文字を「入力1回ぶん」を1行として記録する。
// 各文字 = { char, family(CSS用), color, size }。color が null の文字は
// 表示時に現在の文字色（inkColor）を使う（シーンと同じ挙動）。
const arranged = []; // Array<Array<{char,family,color,size}>>（行の配列）
let pendingRow = true; // 次の記録で新しい行を開始するか
const BUNDLED_CSS_FAMILY = 'Zen Maru Gothic'; // バンドル書体の CSS ファミリー名

// 入力1回の開始（キーボードは Enter 1回、音声は1発話ごとに呼ぶ）
function startArrangedRow() {
  pendingRow = true;
}

function recordArranged(char, family, color, size) {
  if (pendingRow || arranged.length === 0) {
    arranged.push([]);
    pendingRow = false;
  }
  arranged[arranged.length - 1].push({ char, family, color, size });
}

function openAlign() {
  alignBody.innerHTML = '';
  const rows = arranged.filter((r) => r.length > 0);
  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'align__empty';
    p.textContent = 'まだ文字がありません。落としてから開いてください。';
    alignBody.appendChild(p);
  } else {
    for (const row of rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'align__row';
      for (const r of row) {
        const span = document.createElement('span');
        span.className = 'align__item';
        span.textContent = r.char;
        span.style.fontFamily = r.family ? `"${r.family}"` : 'inherit';
        span.style.color = r.color || inkColor.value; // 個別色がなければ現在の文字色
        span.style.fontSize = `${r.size}px`;
        rowEl.appendChild(span);
      }
      alignBody.appendChild(rowEl);
    }
  }
  alignModal.hidden = false;
}

function closeAlign() {
  alignModal.hidden = true;
  charInput.focus();
}

alignBtn.addEventListener('click', openAlign);
alignClose.addEventListener('click', closeAlign);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !alignModal.hidden) closeAlign();
});

// --- ウェイトセレクタ -----------------------------------------------------
function populateWeights(family) {
  weightSelect.innerHTML = '';
  weightSelect.disabled = false;
  for (const w of family.weights) {
    const opt = document.createElement('option');
    opt.value = w.url;
    opt.textContent = w.label;
    weightSelect.appendChild(opt);
  }
  const defaultW = family.weights.find((w) => w.isDefault) ?? family.weights[0];
  weightSelect.value = defaultW.url;
}

function populateSystemWeights(faces) {
  weightSelect.innerHTML = '';
  weightSelect.disabled = false;
  faces.forEach((fd, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = fd.style || fd.fullName || `${i}`;
    weightSelect.appendChild(opt);
  });
}

// --- カラーピッカー（背景色 / 文字色） ------------------------------------
bgColor.value = '#f2f2f2';
inkColor.value = '#1a1a1a';
bgColor.addEventListener('input', () => {
  document.documentElement.style.setProperty('--bg', bgColor.value);
  scene.setBackgroundColor(bgColor.value);
});
inkColor.addEventListener('input', () => {
  scene.setInkColor(inkColor.value);
});

// --- サイズスライダ -------------------------------------------------------
sizeRange.min = String(SIZE.min);
sizeRange.max = String(SIZE.max);
sizeRange.value = String(SIZE.default);
sizeRange.addEventListener('input', () => {
  fontSize = Number(sizeRange.value);
  updatePreview();
});

// --- プレビュー（入力中の文字をキャンバス上部にゴースト表示） ----------
function updatePreview() {
  const char = Array.from(charInput.value)[0];
  if (!char || !currentFont) { scene.setPreview(null); return; }
  const geo = buildLetterGeometry(currentFont, char, fontSize);
  scene.setPreview(geo ?? null);
}

// --- 書体の適用（URL or ArrayBuffer） -------------------------------------
async function applyFont(source, label) {
  charInput.disabled = true;
  try {
    currentFont = await loadFont(source);
    charInput.disabled = false;
    setHint(`${label} ／ 文字を入力 → Enter で落下`);
    charInput.focus();
    updatePreview();
  } catch (err) {
    console.error(err);
    currentFont = null;
    setHint(`書体を読み込めませんでした（${label}）。別の書体／ウェイトをお試しください。`);
  }
}

function loadSelectedWeight() {
  const family = FONT_FAMILIES[Number(fontMenu.getValue())];
  const weightLabel = weightSelect.selectedOptions[0]?.textContent ?? '';
  applyFont(weightSelect.value, `${family.label} ${weightLabel}`.trim());
}

function selectedCuratedEntry() {
  return availableCurated[Number(fontMenu.getValue().slice(4))]; // 'cur:' を除く
}

async function loadSelectedFace() {
  const entry = selectedCuratedEntry();
  if (!entry) return;
  const fd = entry.faces[Number(weightSelect.value)] || entry.faces[0];
  if (!fd) return;
  charInput.disabled = true;
  try {
    const buf = await (await fd.blob()).arrayBuffer();
    await applyFont(buf, `${entry.label} ${fd.style || ''}`.trim());
  } catch (err) {
    console.error(err);
    setHint(`「${entry.label}」を読み込めませんでした（コレクション形式などは未対応の場合があります）。`);
  }
}

function isSystemSelection() {
  return !!fontMenu.getValue()?.startsWith('cur:');
}

// --- イベント -------------------------------------------------------------
// カスタム書体メニューで選択が変わったとき
function onFontChange() {
  if (isSystemSelection()) {
    populateSystemWeights(selectedCuratedEntry()?.faces || []);
    loadSelectedFace();
  } else {
    const family = FONT_FAMILIES[Number(fontMenu.getValue())];
    if (!family) return;
    populateWeights(family);
    loadSelectedWeight();
  }
}

weightSelect.addEventListener('change', () => {
  if (isSystemSelection()) loadSelectedFace();
  else loadSelectedWeight();
});

// --- 書体メニューの構築 ---------------------------------------------------

// 限定リスト（インストール済みのもの）でメニューを構築。各選択肢はその書体自身で表記。
function buildCuratedMenu() {
  const opts = availableCurated.map((c, i) => ({
    value: `cur:${i}`,
    label: c.label,
    family: c.family,
  }));
  fontMenu.setOptions(opts, opts[0].value);
  populateSystemWeights(availableCurated[0].faces);
  loadSelectedFace();
}

// 限定リストが使えない時のフォールバック（非対応ブラウザ／未許可／未インストール）
function buildBundledMenu() {
  const opts = FONT_FAMILIES.map((f, i) => ({ value: String(i), label: f.label, family: null }));
  fontMenu.setOptions(opts, opts.length ? '0' : null);
  if (FONT_FAMILIES.length > 0) {
    populateWeights(FONT_FAMILIES[0]);
    loadSelectedWeight();
  }
}

let curatedReady = false;
let curatedLoading = false; // 二重に許可ダイアログを出さないための再入ガード

// 名前のゆるい照合: 完全一致 → 大小無視の完全一致 → 部分一致（どちらかが他方を含む）。
// 表記ゆれ（Pr6N の有無・スペース・大小）があっても拾える。
function nameMatches(name, wanted) {
  if (!name) return false;
  const a = name.toLowerCase().trim();
  const b = wanted.toLowerCase().trim();
  return a === b || a.includes(b) || b.includes(a);
}

// 指定名に一致する「実在の」ファミリー名を探す（family 指定用）。
function findInstalledFamily(map, wanted) {
  if (map.has(wanted)) return wanted;
  return [...map.keys()].find((k) => nameMatches(k, wanted)) || null;
}

// curated エントリから該当フェイス群を解決する。
//   postscript 指定 → PostScript 名で照合（'-H' 等でウェイトをピン留めできる）
//   family 指定     → ファミリー名で照合（そのファミリーの全ウェイト）
function resolveFaces(entry, fonts, map) {
  if (entry.postscript) {
    return fonts.filter((fd) => nameMatches(fd.postscriptName, entry.postscript));
  }
  if (entry.family) {
    const fam = findInstalledFamily(map, entry.family);
    return fam ? map.get(fam) : [];
  }
  return [];
}

// 限定リストの書体読み込みを試みる（権限が下りていれば成功）。
// あわせて「何が一致し／何が見つからなかったか」を診断としてコンソールに出す。
async function tryLoadCurated() {
  if (curatedReady || curatedLoading || !('queryLocalFonts' in window)) return false;
  curatedLoading = true;
  let fonts;
  try {
    fonts = await window.queryLocalFonts();
  } catch {
    return false; // 権限プロンプトにユーザー操作が必要 等／拒否された
  } finally {
    curatedLoading = false;
  }

  // family → faces マップ（family 指定の照合に使う）
  const map = new Map();
  for (const fd of fonts) {
    if (!map.has(fd.family)) map.set(fd.family, []);
    map.get(fd.family).push(fd);
  }

  const avail = [];
  const matched = [];
  const missing = [];
  for (const c of curatedList) {
    const how = c.postscript ? `PS「${c.postscript}」` : `family「${c.family}」`;
    const faces = resolveFaces(c, fonts, map);
    if (faces.length) {
      // CSS 表示用に実在のファミリー名を採用。faces はそのまま保持。
      avail.push({ label: c.label, family: faces[0].family, faces });
      matched.push(`✓ ${c.label}：${how} → ${faces.length}フェイス（${faces[0].family}）`);
    } else {
      missing.push(`✗ ${c.label}：${how} が見つからない`);
    }
  }

  // 診断ログ（DevTools コンソールで確認できる）。family と PostScript 名を併記。
  console.groupCollapsed(`[書体診断] 一致 ${avail.length} / 指定 ${curatedList.length}`);
  matched.forEach((m) => console.log(m));
  missing.forEach((m) => console.warn(m));
  console.log('— インストール済み一覧（family  |  PostScript名）。この名前を fonts.json に —');
  console.log(
    fonts
      .map((fd) => `${fd.family}  |  ${fd.postscriptName}`)
      .sort((a, b) => a.localeCompare(b))
      .join('\n')
  );
  console.groupEnd();

  if (avail.length === 0) return false;
  availableCurated = avail;
  buildCuratedMenu();
  curatedReady = true;
  return true;
}

// ランダムモード: 表示中の書体プール（限定リスト or バンドル）から1つ選んで返す
async function loadRandomFont() {
  const pool = [];
  if (availableCurated.length > 0) {
    for (const c of availableCurated) {
      for (const fd of c.faces) {
        pool.push({
          load: async () => loadFont(await (await fd.blob()).arrayBuffer()),
          label: `${c.label} ${fd.style || ''}`.trim(),
          family: c.family,
        });
      }
    }
  } else {
    for (const fam of FONT_FAMILIES) {
      for (const w of fam.weights) {
        pool.push({
          load: () => loadFont(w.url),
          label: `${fam.label} ${w.label}`,
          family: BUNDLED_CSS_FAMILY,
        });
      }
    }
  }
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  try {
    return { font: await pick.load(), label: pick.label, family: pick.family };
  } catch {
    return null;
  }
}

// 1文字をフォント・サイズ・X座標を指定して落下させる共通関数
async function spawnChar(char, size, x) {
  if (!char || !char.trim()) return;

  let fontToUse = currentFont;
  let fontLabel = currentFontLabel();
  let cssFamily = currentCssFamily();

  if (isRandom()) {
    const result = await loadRandomFont();
    if (!result) { setHint('書体が見つかりませんでした。'); return; }
    fontToUse = result.font;
    fontLabel = result.label;
    cssFamily = result.family;
  } else if (!fontToUse) return;

  const geometry = buildLetterGeometry(fontToUse, char, size);
  if (!geometry) {
    setHint(`「${char}」はこの書体に含まれていないようです。`);
    return;
  }
  const color = isColorRandom() ? randomColor() : null;
  scene.addLetter(geometry, x, color);
  recordArranged(char, cssFamily, color, size); // 整列モード用に記録
  if (isRandom()) setHint(`${char}（${fontLabel}）`);
}

async function spawnFromInput() {
  const char = Array.from(charInput.value)[0];
  if (!char || !char.trim()) return;

  charInput.value = '';
  scene.setPreview(null);
  const spawnX = dropX;
  dropX = window.innerWidth / 2;
  scene.setPreviewX(dropX);

  startArrangedRow(); // 入力1回 = 整列モードの1行
  await spawnChar(char, fontSize, spawnX);
}

charInput.addEventListener('input', () => {
  // 1文字目だけ残す（IME 確定後に複数文字が入ることへの保険）
  const chars = Array.from(charInput.value);
  if (chars.length > 1) charInput.value = chars[0];
  // 新しい文字を入力したら落下位置を中央にリセット
  dropX = window.innerWidth / 2;
  scene.setPreviewX(dropX);
  updatePreview();
});

charInput.addEventListener('keydown', (e) => {
  // IME(日本語変換)の確定 Enter は無視（二重登録の防止）
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    spawnFromInput();
    return;
  }
  // 左右矢印キーで落下位置を調整（プレビューがあるときだけ）
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && charInput.value) {
    e.preventDefault();
    const step = 30;
    const margin = 60;
    dropX = Math.max(margin, Math.min(window.innerWidth - margin,
      dropX + (e.key === 'ArrowLeft' ? -step : step)));
    scene.setPreviewX(dropX);
  }
});

// どこをクリックしても入力フィールドにフォーカスを戻す
document.addEventListener('click', (e) => {
  if (!e.target.closest('select, button, input[type="range"]')) charInput.focus();
});

// --- 音声入力 -------------------------------------------------------------
let voiceInput = null;

voiceBtn.addEventListener('click', async () => {
  if (voiceInput) {
    // 停止
    voiceInput.stop();
    voiceInput = null;
    scene.setVoiceLevel(0);
    voiceBtn.classList.remove('is-active', 'is-recording');
    setHint('音声入力を停止しました');
    return;
  }

  const vi = createVoiceInput({
    onVolume: (rms) => scene.setVoiceLevel(rms),
    onResult: async (text, size) => {
      // スライダーを音量由来のサイズに同期して視覚フィードバック
      sizeRange.value = String(size);
      setHint(`「${text}」/ サイズ ${size}`);

      startArrangedRow(); // 1発話 = 整列モードの1行
      const spread = Math.min(window.innerWidth * 0.25, 200);
      for (const char of [...text]) {
        if (!char.trim()) continue;
        const x = window.innerWidth / 2 + (Math.random() * 2 - 1) * spread;
        await spawnChar(char, size, x);
        await new Promise(r => setTimeout(r, 120)); // 複数文字を時間差で落とす
      }
    },
    onStatus: setHint,
  });

  if (!vi) {
    setHint('音声入力は Chrome / Edge でのみ利用できます。');
    return;
  }

  const ok = await vi.start();
  if (ok) {
    voiceInput = vi;
    voiceBtn.classList.add('is-active', 'is-recording');
  }
});

randomFontCheck.addEventListener('change', () => {
  setHint(randomFontCheck.checked
    ? '書体ランダム ON：落とすたびに書体が変わります'
    : '文字を入力 → Enter で落下');
  charInput.focus();
});

randomColorCheck.addEventListener('change', () => {
  setHint(randomColorCheck.checked
    ? '文字色ランダム ON：落とすたびに文字色が変わります'
    : '文字を入力 → Enter で落下');
  charInput.focus();
});

resetBtn.addEventListener('click', () => {
  scene.reset();
  arranged.length = 0;
  pendingRow = true;
  charInput.focus();
});

// 書体リストを public/fonts.json から読み込む（失敗時は CURATED_FONTS のまま）
async function loadCuratedList() {
  try {
    const res = await fetch('/fonts.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    // family か postscript のどちらかと label があれば有効
    const fonts = (data?.fonts || []).filter((f) => f && f.label && (f.family || f.postscript));
    if (fonts.length) curatedList = fonts;
  } catch {
    /* フォールバック（CURATED_FONTS）のまま */
  }
}

// 許可オーバーレイの表示／非表示
function showPermOverlay() {
  permOverlay.hidden = false;
}
function hidePermOverlay() {
  permOverlay.hidden = true;
  charInput.focus();
}

// オーバーレイ上のどこでも（ボタン含む）クリックで許可フローを起動。
// ブラウザ仕様上、許可ダイアログには必ずユーザー操作が要るため 1 クリックで発火させる。
async function requestFontAccess() {
  const ok = await tryLoadCurated();
  if (ok) {
    hidePermOverlay();
  } else {
    // 拒否 or 対象書体が未インストール → バンドル書体で続行
    hidePermOverlay();
    setHint('書体を読み込めませんでした（未許可 or 対象書体が未インストール）。バンドル書体で動作します。');
  }
}
permOverlay.addEventListener('click', requestFontAccess);
permBtn.addEventListener('click', (e) => { e.stopPropagation(); requestFontAccess(); });

// --- 初期化 ---------------------------------------------------------------
// 起動時に書体リストを読み込み、デスクトップ書体を反映する。
// 権限が既に下りていれば即メニュー化。未許可なら許可オーバーレイを前面に出し、
// 1 クリックで許可ダイアログ → 読み込みへ。
(async function initFonts() {
  await loadCuratedList();

  if (!('queryLocalFonts' in window)) {
    buildBundledMenu();
    setHint('指定書体の読み込みは Chrome / Edge でのみ可能です。バンドル書体で動作します。');
    return;
  }

  // 暫定でバンドル書体を用意（許可されるまで／されなくても動くように）
  buildBundledMenu();

  if (await tryLoadCurated()) return; // 権限済みなら即完了（オーバーレイ不要）

  // 未許可: アクセス時にすぐ前面へ許可オーバーレイを出す
  showPermOverlay();
})();
