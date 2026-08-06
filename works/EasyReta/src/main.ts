// ============================================================
// エントリポイント：タブ切り替え
// ============================================================

import './style.css';
import { renderEditor } from './editor';
import { renderPreview } from './preview';

const app = document.getElementById('app') as HTMLElement;
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');

function activate(name: string): void {
  tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
  if (name === 'editor') {
    renderEditor(app);
  } else {
    // 試しうちに切り替えるたびに最新の骨格を読み直す
    renderPreview(app);
  }
}

tabs.forEach((t) => {
  t.addEventListener('click', () => activate(t.dataset.tab ?? 'editor'));
});

activate('editor');
