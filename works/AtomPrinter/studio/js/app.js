// 画面の配線。描画は Render、送信は AtomPrinter に任せる。

const $ = (id) => document.getElementById(id);
const out = $('out');
const statusEl = $('status');

let mode = 'text';
let sourceImage = null;
let current = null;   // いま印刷される白黒 canvas
let busy = false;

// ---------- 設定の読み取り ----------

const num = (id) => Number($(id).value);

function textOptions() {
  return {
    text: $('t-text').value,
    font: $('t-font').value.trim() || 'Hiragino Mincho ProN',
    weight: $('t-weight').value,
    align: $('t-align').value,
    size: num('t-size'),
    lineHeight: num('t-lineHeight'),
    spacing: num('t-spacing'),
    margin: num('t-margin'),
    padding: num('t-padding'),
    threshold: num('t-threshold'),
    invert: $('t-invert').checked,
  };
}

function imageOptions() {
  return {
    scale: num('i-scale'),
    rotate: num('i-rotate'),
    dither: $('i-dither').value,
    brightness: num('i-brightness'),
    contrast: num('i-contrast'),
    threshold: num('i-threshold'),
    padding: num('i-padding'),
    invert: $('i-invert').checked,
  };
}

// ---------- プレビュー ----------

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  // requestAnimationFrame だとタブが裏にある間は止まるので setTimeout にする
  setTimeout(async () => {
    pending = false;
    await redraw();
  }, 0);
}

async function redraw() {
  if (mode === 'text') {
    current = await Render.text(textOptions());
  } else {
    current = sourceImage ? Render.image(sourceImage, imageOptions()) : null;
  }
  show(current);
}

function show(c) {
  const zoom = num('zoom');
  if (!c) {
    out.width = AtomPrinter.WIDTH;
    out.height = 120;
    out.getContext('2d').clearRect(0, 0, out.width, out.height);
    $('info').textContent = '画像が選ばれていません';
  } else {
    out.width = c.width;
    out.height = c.height;
    out.getContext('2d').drawImage(c, 0, 0);
    const sec = AtomPrinter.estimateSeconds(c.width, c.height);
    $('info').textContent =
      `${c.width} × ${c.height} ドット ／ 紙の長さ 約 ${(c.height / 8).toFixed(0)} mm ／ 送信 約 ${Math.ceil(sec)} 秒`;
  }
  out.style.width = `${out.width * zoom}px`;
  out.style.height = `${out.height * zoom}px`;
  $('print').disabled = busy || !c;
}

function syncOutputs() {
  document.querySelectorAll('output[data-for]').forEach((o) => {
    o.textContent = $(o.dataset.for).value;
  });
}

// ---------- 画像の読み込み ----------

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    sourceImage = img;
    $('drop-label').textContent = `${file.name || '貼り付けた画像'}（${img.naturalWidth} × ${img.naturalHeight}）`;
    schedule();
  };
  img.src = url;
}

const drop = $('drop');
drop.addEventListener('click', (e) => { if (e.target === drop || e.target.id === 'drop-label') $('i-file').click(); });
$('i-file').addEventListener('change', (e) => loadFile(e.target.files[0]));
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('is-over');
  loadFile(e.dataTransfer.files[0]);
});
window.addEventListener('paste', (e) => {
  const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
  if (!item) return;
  setMode('image');
  loadFile(item.getAsFile());
});

// ---------- タブ ----------

function setMode(m) {
  mode = m;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.mode === m));
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.dataset.panel !== m; });
  schedule();
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));

// ---------- 印刷 ----------

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('is-error', isError);
}

function host() {
  return $('host').value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function explain(err) {
  // ネットワークで落ちると TypeError、時間切れだと TimeoutError。どちらもたいてい Wi-Fi が ATOM につながっていない
  if (err instanceof TypeError || err.name === 'TimeoutError') {
    return `プリンタに届きませんでした（${host()}）。\nMac の Wi-Fi が ATOM-PRINTER_xxxx につながっているか確認してください。`;
  }
  return `失敗：${err.message}`;
}

async function withBusy(fn) {
  busy = true;
  $('print').disabled = true;
  $('feed-btn').disabled = true;
  try {
    await fn();
  } catch (err) {
    setStatus(explain(err), true);
  } finally {
    busy = false;
    $('feed-btn').disabled = false;
    $('progress').hidden = true;
    show(current);
  }
}

$('print').addEventListener('click', () => withBusy(async () => {
  if (!current) return;
  const job = current;
  const started = performance.now();
  $('progress').hidden = false;
  $('progress').value = 0;
  setStatus(`送信中… 約 ${Math.ceil(AtomPrinter.estimateSeconds(job.width, job.height))} 秒`);
  await AtomPrinter.printCanvas(host(), job, {
    feed: num('feed'),
    onProgress: (p) => { $('progress').value = p; },
  });
  setStatus(`印刷しました（${((performance.now() - started) / 1000).toFixed(1)} 秒）`);
}));

$('feed-btn').addEventListener('click', () => withBusy(async () => {
  await AtomPrinter.feed(host(), 3);
  setStatus('紙を送りました');
}));

// ---------- 起動 ----------

try {
  const saved = localStorage.getItem('atomprinter.host');
  if (saved) $('host').value = saved;
} catch (_) {}
$('host').addEventListener('change', () => {
  try { localStorage.setItem('atomprinter.host', host()); } catch (_) {}
});

document.querySelectorAll('.controls input, .controls select, .controls textarea').forEach((el) => {
  if (el.id === 'host' || el.type === 'file') return;
  el.addEventListener('input', () => { syncOutputs(); schedule(); });
});
$('zoom').addEventListener('change', () => show(current));

syncOutputs();
schedule();
