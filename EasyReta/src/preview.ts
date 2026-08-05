// ============================================================
// 試しうちタブ
// 入力欄に打った文字列を、骨格登録タブで組んだ配置どおりに
// エレメント画像を並べて表示する。
// フォントデータ化はせず、画像を重ねて「文字」を組み立てる。
// ============================================================

import { ELEMENT_MAP } from './elements';
import { loadSkeletons, type Skeletons } from './store';

// --- 調整しやすいパラメータ ---------------------------------
const DEFAULT_SIZE = 96; // 1文字の表示サイズ(px)
const DEFAULT_TEXT = 'あいうえお';
// -----------------------------------------------------------

let skeletons: Skeletons = {};

export function renderPreview(root: HTMLElement): void {
  skeletons = loadSkeletons();
  root.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'preview-layout';

  // 入力エリア
  const controls = document.createElement('div');
  controls.className = 'preview-controls';

  const textarea = document.createElement('textarea');
  textarea.className = 'preview-input';
  textarea.value = DEFAULT_TEXT;
  textarea.placeholder = 'ここにひらがなを入力';
  controls.appendChild(textarea);

  // サイズスライダー
  const sizeLabel = document.createElement('label');
  sizeLabel.className = 'size-control';
  sizeLabel.innerHTML = '文字サイズ ';
  const sizeInput = document.createElement('input');
  sizeInput.type = 'range';
  sizeInput.min = '32';
  sizeInput.max = '200';
  sizeInput.value = String(DEFAULT_SIZE);
  sizeLabel.appendChild(sizeInput);
  controls.appendChild(sizeLabel);

  wrap.appendChild(controls);

  // 出力エリア
  const output = document.createElement('div');
  output.className = 'preview-output';
  wrap.appendChild(output);

  const rerender = () => renderText(output, textarea.value, Number(sizeInput.value));
  textarea.addEventListener('input', rerender);
  sizeInput.addEventListener('input', rerender);

  root.appendChild(wrap);
  rerender();
}

function renderText(output: HTMLElement, text: string, size: number): void {
  output.innerHTML = '';
  for (const ch of text) {
    if (ch === '\n') {
      output.appendChild(document.createElement('br'));
      continue;
    }
    if (ch === ' ' || ch === '　') {
      const sp = document.createElement('span');
      sp.className = 'glyph glyph-space';
      sp.style.width = `${size}px`;
      sp.style.height = `${size}px`;
      output.appendChild(sp);
      continue;
    }
    output.appendChild(buildGlyph(ch, size));
  }
}

function buildGlyph(ch: string, size: number): HTMLElement {
  const glyph = document.createElement('div');
  glyph.className = 'glyph';
  glyph.style.width = `${size}px`;
  glyph.style.height = `${size}px`;

  const list = skeletons[ch];
  if (!list || list.length === 0) {
    // 未登録の文字はうっすら元の文字を表示（目印）
    glyph.classList.add('glyph-missing');
    glyph.textContent = ch;
    glyph.style.fontSize = `${size * 0.7}px`;
    return glyph;
  }

  for (const p of list) {
    const def = ELEMENT_MAP[p.element];
    if (!def) continue;
    const img = document.createElement('img');
    img.src = def.src;
    img.className = 'glyph-el';
    img.style.left = `${p.x * 100}%`;
    img.style.top = `${p.y * 100}%`;
    img.style.width = `${p.w * 100}%`;
    img.style.height = `${p.h * 100}%`;
    // 回転 → 反転の順で合成
    img.style.transform = `rotate(${p.rotation ?? 0}deg) scale(${p.flipX ? -1 : 1}, ${p.flipY ? -1 : 1})`;
    glyph.appendChild(img);
  }
  return glyph;
}
