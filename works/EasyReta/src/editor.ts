// ============================================================
// 骨格登録タブ
// ・左：エレメントパレット（キャンバスへドラッグ＆ドロップ）
// ・中央：正方形キャンバス。置いたエレメントを選択して
//   移動・角/辺ハンドルでリサイズ（縦横比に依存しない）・削除。
// ・右：文字選択（五十音）。選んだ文字ごとに骨格を編集する。
// ============================================================

import { ELEMENTS, ELEMENT_MAP } from './elements';
import { HIRAGANA_ROWS } from './chars';
import {
  loadSkeletons,
  saveSkeletons,
  exportJSON,
  importJSON,
  newPlacementId,
  type Placement,
  type Skeletons,
} from './store';

// --- 調整しやすいパラメータ ---------------------------------
const DROP_DEFAULT_H = 0.35; // ドロップ時のデフォルト高さ（キャンバス比）
const MIN_SIZE = 0.02; // エレメントの最小サイズ（キャンバス比）
const HANDLE = 9; // ハンドルの一辺(px)。CSS と揃える
// -----------------------------------------------------------

let skeletons: Skeletons = loadSkeletons();
let currentChar = 'あ';
let selectedId: string | null = null;

// 再描画のためにキャンバス要素を保持
let canvasEl: HTMLDivElement;
let charGridEl: HTMLDivElement;

export function renderEditor(root: HTMLElement): void {
  skeletons = loadSkeletons();
  root.innerHTML = '';

  const layout = document.createElement('div');
  layout.className = 'editor-layout';

  layout.appendChild(buildPalette());
  layout.appendChild(buildCanvasArea());
  layout.appendChild(buildCharPanel());

  root.appendChild(layout);
  drawCanvas();
  refreshCharGrid();
}

// --- パレット（左） -----------------------------------------
function buildPalette(): HTMLElement {
  const panel = document.createElement('aside');
  panel.className = 'palette';
  panel.innerHTML = '<h2 class="panel-title">エレメント</h2>';

  const list = document.createElement('div');
  list.className = 'palette-list';

  for (const el of ELEMENTS) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.draggable = true;
    item.innerHTML = `<img src="${el.src}" alt="${el.label}" /><span>${el.label}</span>`;
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/element', el.id);
    });
    list.appendChild(item);
  }

  panel.appendChild(list);
  return panel;
}

// --- キャンバス（中央） -------------------------------------
function buildCanvasArea(): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'canvas-area';

  const head = document.createElement('div');
  head.className = 'canvas-head';
  head.innerHTML = `<span class="editing-char">編集中：<b id="editing-char-label">${currentChar}</b></span>`;

  const flipXBtn = document.createElement('button');
  flipXBtn.className = 'btn';
  flipXBtn.textContent = '左右反転';
  flipXBtn.addEventListener('click', () => flipSelected('x'));
  head.appendChild(flipXBtn);

  const flipYBtn = document.createElement('button');
  flipYBtn.className = 'btn';
  flipYBtn.textContent = '上下反転';
  flipYBtn.addEventListener('click', () => flipSelected('y'));
  head.appendChild(flipYBtn);

  const del = document.createElement('button');
  del.className = 'btn btn-danger';
  del.textContent = '選択を削除';
  del.addEventListener('click', () => deleteSelected());
  head.appendChild(del);

  const clear = document.createElement('button');
  clear.className = 'btn';
  clear.textContent = 'この文字をクリア';
  clear.addEventListener('click', () => {
    skeletons[currentChar] = [];
    selectedId = null;
    persist();
    drawCanvas();
    refreshCharGrid();
  });
  head.appendChild(clear);

  wrap.appendChild(head);

  const stage = document.createElement('div');
  stage.className = 'canvas-stage';

  canvasEl = document.createElement('div');
  canvasEl.className = 'canvas';
  // 中央の十字ガイドは CSS の ::before/::after で描く

  // ドロップ受け入れ
  canvasEl.addEventListener('dragover', (e) => e.preventDefault());
  canvasEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const elId = e.dataTransfer?.getData('text/element');
    if (!elId) return;
    dropElement(elId, e);
  });
  // 空白クリックで選択解除
  canvasEl.addEventListener('pointerdown', (e) => {
    if (e.target === canvasEl) {
      selectedId = null;
      drawCanvas();
    }
  });

  stage.appendChild(canvasEl);
  wrap.appendChild(stage);
  return wrap;
}

// --- 文字パネル（右） ---------------------------------------
function buildCharPanel(): HTMLElement {
  const panel = document.createElement('aside');
  panel.className = 'char-panel';
  panel.innerHTML = '<h2 class="panel-title">文字を選ぶ</h2>';

  charGridEl = document.createElement('div');
  charGridEl.className = 'char-grid';
  for (const row of HIRAGANA_ROWS) {
    for (const c of row) {
      const cell = document.createElement('button');
      cell.className = 'char-cell';
      if (c === '') {
        cell.classList.add('is-empty');
        cell.disabled = true;
      } else {
        cell.textContent = c;
        cell.dataset.char = c;
        cell.addEventListener('click', () => {
          currentChar = c;
          selectedId = null;
          drawCanvas();
          refreshCharGrid();
          const label = document.getElementById('editing-char-label');
          if (label) label.textContent = c;
        });
      }
      charGridEl.appendChild(cell);
    }
  }
  panel.appendChild(charGridEl);

  // 保存系
  const io = document.createElement('div');
  io.className = 'io-buttons';

  const expBtn = document.createElement('button');
  expBtn.className = 'btn';
  expBtn.textContent = 'JSON書き出し';
  expBtn.addEventListener('click', downloadJSON);
  io.appendChild(expBtn);

  const impBtn = document.createElement('button');
  impBtn.className = 'btn';
  impBtn.textContent = 'JSON読み込み';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) loadJSONFile(file);
    fileInput.value = '';
  });
  impBtn.addEventListener('click', () => fileInput.click());
  io.appendChild(impBtn);
  io.appendChild(fileInput);

  panel.appendChild(io);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'ブラウザに自動保存されます。';
  panel.appendChild(hint);

  return panel;
}

// --- 描画 ---------------------------------------------------
function drawCanvas(): void {
  canvasEl.querySelectorAll('.placed').forEach((n) => n.remove());
  const list = skeletons[currentChar] ?? [];

  for (const p of list) {
    const def = ELEMENT_MAP[p.element];
    if (!def) continue;
    const node = document.createElement('div');
    node.className = 'placed';
    if (p.id === selectedId) node.classList.add('is-selected');
    node.style.left = `${p.x * 100}%`;
    node.style.top = `${p.y * 100}%`;
    node.style.width = `${p.w * 100}%`;
    node.style.height = `${p.h * 100}%`;
    node.style.transform = `rotate(${p.rotation ?? 0}deg)`;
    // キャンバス外にはみ出したものは（選択中以外）半透明にして位置を示す
    if (p.id !== selectedId && isOutside(p)) node.style.opacity = '0.5';

    const img = document.createElement('img');
    img.src = def.src;
    img.draggable = false;
    // 反転は画像だけに適用（枠やハンドルには影響させない）
    img.style.transform = `scale(${p.flipX ? -1 : 1}, ${p.flipY ? -1 : 1})`;
    node.appendChild(img);

    // 本体ドラッグ＝移動
    node.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      selectedId = p.id;
      drawCanvas();
      startMove(p, e);
    });

    // 選択中はハンドルを出す
    if (p.id === selectedId) {
      for (const h of HANDLES) {
        const handle = document.createElement('div');
        handle.className = `handle handle-${h}`;
        handle.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          startResize(p, h, e);
        });
        node.appendChild(handle);
      }
      // 回転ハンドル（上辺の外側）
      const rot = document.createElement('div');
      rot.className = 'handle handle-rot';
      rot.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        startRotate(p, e);
      });
      node.appendChild(rot);
    }

    canvasEl.appendChild(node);
  }
}

// ハンドル位置（角4＋辺4）
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type HandlePos = (typeof HANDLES)[number];

// --- ドロップで新規配置 -------------------------------------
function dropElement(elId: string, e: DragEvent): void {
  const def = ELEMENT_MAP[elId];
  if (!def) return;
  const rect = canvasEl.getBoundingClientRect();
  const h = DROP_DEFAULT_H;
  const w = h * (def.natW / def.natH) * (rect.height / rect.width);
  // 落とした位置を中心に配置
  const cx = (e.clientX - rect.left) / rect.width;
  const cy = (e.clientY - rect.top) / rect.height;
  const p: Placement = {
    id: newPlacementId(),
    element: elId,
    x: clamp01(cx - w / 2),
    y: clamp01(cy - h / 2),
    w,
    h,
  };
  if (!skeletons[currentChar]) skeletons[currentChar] = [];
  skeletons[currentChar].push(p);
  selectedId = p.id;
  persist();
  drawCanvas();
  refreshCharGrid();
}

// --- 移動 ---------------------------------------------------
function startMove(p: Placement, e: PointerEvent): void {
  const rect = canvasEl.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  const origX = p.x;
  const origY = p.y;

  const move = (ev: PointerEvent) => {
    // 移動は中心の平行移動。キャンバス外へも自由に出せる（クランプなし）
    const dx = (ev.clientX - startX) / rect.width;
    const dy = (ev.clientY - startY) / rect.height;
    p.x = origX + dx;
    p.y = origY + dy;
    drawCanvas();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    persist();
    refreshCharGrid();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// --- リサイズ（縦横比に依存しない・回転対応） ---------------
// 反対側の角/辺を固定してサイズを変える。回転している場合も
// ローカル軸（＝見た目の縦横）でリサイズされるよう計算する。
function startResize(p: Placement, pos: HandlePos, e: PointerEvent): void {
  const rect = canvasEl.getBoundingClientRect();
  const S = rect.width; // キャンバスは正方形なので幅=高さ
  const theta = ((p.rotation ?? 0) * Math.PI) / 180;
  const minPx = MIN_SIZE * S;

  // 操作ハンドルのローカル方向 (-1|0|1)
  const sx = pos.includes('e') ? 1 : pos.includes('w') ? -1 : 0;
  const sy = pos.includes('s') ? 1 : pos.includes('n') ? -1 : 0;

  // 開始時の中心・半サイズ（px, キャンバス左上原点）
  const c0x = (p.x + p.w / 2) * S;
  const c0y = (p.y + p.h / 2) * S;
  const hw0 = (p.w * S) / 2;
  const hh0 = (p.h * S) / 2;

  // 固定アンカー（操作の反対側）をワールド固定
  const a = rot(-sx * hw0, -sy * hh0, theta);
  const ax = c0x + a.x;
  const ay = c0y + a.y;

  const move = (ev: PointerEvent) => {
    // マウス位置（キャンバス左上原点 px）
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    // 固定点を原点にローカル軸へ引き戻す
    const local = rot(mx - ax, my - ay, -theta);

    const newW = sx !== 0 ? Math.max(minPx, sx * local.x) : hw0 * 2;
    const newH = sy !== 0 ? Math.max(minPx, sy * local.y) : hh0 * 2;

    // 固定点が動かないよう新しい中心を求める
    const cOff = rot((sx * newW) / 2, (sy * newH) / 2, theta);
    const cx = ax + cOff.x;
    const cy = ay + cOff.y;

    p.w = newW / S;
    p.h = newH / S;
    p.x = (cx - newW / 2) / S;
    p.y = (cy - newH / 2) / S;
    drawCanvas();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    persist();
    refreshCharGrid();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// --- 回転 ---------------------------------------------------
// 中心とマウスの角度から回転量を決める。Shift 押下で 15°スナップ。
function startRotate(p: Placement, e: PointerEvent): void {
  const rect = canvasEl.getBoundingClientRect();
  const cx = rect.left + (p.x + p.w / 2) * rect.width;
  const cy = rect.top + (p.y + p.h / 2) * rect.height;

  const move = (ev: PointerEvent) => {
    let deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
    if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
    p.rotation = Math.round(deg);
    drawCanvas();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    persist();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ベクトル (vx,vy) を ang(rad) 回転
function rot(vx: number, vy: number, ang: number): { x: number; y: number } {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: vx * c - vy * s, y: vx * s + vy * c };
}

// キャンバス [0,1]×[0,1] を一部でもはみ出しているか（回転は近似で無視）
function isOutside(p: Placement): boolean {
  return p.x < 0 || p.y < 0 || p.x + p.w > 1 || p.y + p.h > 1;
}

// --- 反転（選択中のエレメント） -----------------------------
function flipSelected(axis: 'x' | 'y'): void {
  if (!selectedId) return;
  const p = (skeletons[currentChar] ?? []).find((q) => q.id === selectedId);
  if (!p) return;
  if (axis === 'x') p.flipX = !p.flipX;
  else p.flipY = !p.flipY;
  persist();
  drawCanvas();
}

// --- 削除 ---------------------------------------------------
function deleteSelected(): void {
  if (!selectedId) return;
  const list = skeletons[currentChar] ?? [];
  skeletons[currentChar] = list.filter((p) => p.id !== selectedId);
  selectedId = null;
  persist();
  drawCanvas();
  refreshCharGrid();
}

// キーボードでも削除できるように
window.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    deleteSelected();
  }
});

// --- 文字グリッドの「登録済み」表示を更新 -------------------
function refreshCharGrid(): void {
  if (!charGridEl) return;
  charGridEl.querySelectorAll<HTMLButtonElement>('.char-cell').forEach((cell) => {
    const c = cell.dataset.char;
    if (!c) return;
    cell.classList.toggle('is-current', c === currentChar);
    cell.classList.toggle('has-data', (skeletons[c]?.length ?? 0) > 0);
  });
}

// --- 保存とJSON入出力 --------------------------------------
function persist(): void {
  saveSkeletons(skeletons);
}

function downloadJSON(): void {
  const blob = new Blob([exportJSON(skeletons)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'easyreta-font.json';
  a.click();
  URL.revokeObjectURL(url);
}

function loadJSONFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    const data = importJSON(String(reader.result));
    if (!data) {
      alert('JSON の読み込みに失敗しました。');
      return;
    }
    skeletons = data;
    selectedId = null;
    persist();
    drawCanvas();
    refreshCharGrid();
  };
  reader.readAsText(file);
}

// --- 小さなユーティリティ -----------------------------------
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

// HANDLE を CSS 変数に流し込む（未使用警告回避もかねて実利用）
document.documentElement.style.setProperty('--handle-size', `${HANDLE}px`);
