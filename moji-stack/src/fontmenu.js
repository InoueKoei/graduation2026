// OS 標準ではないカスタム書体ドロップダウン。
// 各選択肢を「その書体自身」でレンダリングするのが目的（native <select> では
// ブラウザ／OS により選択肢のフォント指定が効かないため自前で描画する）。
//
// 使い方:
//   const menu = createFontMenu({ button, current, list, onChange });
//   menu.setOptions([{ value, label, family }], selectedValue);
//   menu.getValue(); menu.getLabel();
//
//   value  : 内部識別子（'sys:ファミリー名' or バンドル書体のインデックス文字列）
//   label  : 表示名（和名など）
//   family : CSS で使うファミリー名。指定すると選択肢をその書体で描画する。

export function createFontMenu({ button, current, list, onChange }) {
  let options = [];
  let value = null;

  function open() {
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  function close() {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }
  function toggle() { (list.hidden ? open : close)(); }

  function updateButton() {
    const opt = options.find((o) => o.value === value);
    current.textContent = opt ? opt.label : '';
    current.style.fontFamily = opt?.family ? `"${opt.family}"` : '';
  }

  function syncSelected() {
    [...list.children].forEach((li, i) => {
      li.setAttribute('aria-selected', String(options[i]?.value === value));
    });
  }

  function select(v, fire = true) {
    if (v === value) return;
    value = v;
    updateButton();
    syncSelected();
    if (fire) onChange?.(value);
  }

  function render() {
    list.innerHTML = '';
    for (const opt of options) {
      const li = document.createElement('li');
      li.className = 'fontmenu__item';
      li.setAttribute('role', 'option');
      li.textContent = opt.label;
      if (opt.family) li.style.fontFamily = `"${opt.family}"`;
      li.setAttribute('aria-selected', String(opt.value === value));
      li.addEventListener('click', () => {
        select(opt.value);
        close();
      });
      list.appendChild(li);
    }
  }

  // --- イベント ---
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });

  document.addEventListener('click', (e) => {
    if (!list.hidden && !e.target.closest('.fontmenu')) close();
  });

  document.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = options.findIndex((o) => o.value === value);
      const next = e.key === 'ArrowDown'
        ? Math.min(options.length - 1, idx + 1)
        : Math.max(0, idx - 1);
      if (options[next]) {
        select(options[next].value);
        list.children[next]?.scrollIntoView({ block: 'nearest' });
      }
    }
  });

  return {
    // options を差し替える。selectedValue は onChange を発火させずに選択状態だけ設定。
    setOptions(opts, selectedValue) {
      options = opts;
      value = selectedValue ?? opts[0]?.value ?? null;
      render();
      updateButton();
    },
    getValue: () => value,
    getLabel: () => options.find((o) => o.value === value)?.label ?? '',
  };
}
