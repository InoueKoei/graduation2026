// ============================================================
//  portal.js — カタログ画面
//  一覧の描画・作品の起動/停止・子プロセスの標準出力の表示。
// ============================================================

const grid = document.getElementById('grid');
const dialog = document.getElementById('readme-dialog');
const readmeTitle = document.getElementById('readme-title');
const readmeBody = document.getElementById('readme-body');

const KIND_LABEL = { static: '静的', vite: 'vite', node: 'node サーバ' };

let TAGS = {};
/** 起動中の作品のログを追いかけるタイマー。slug → intervalId */
const logTimers = new Map();

// ── 一覧の取得と描画 ────────────────────────────────────────
async function loadWorks() {
  const res = await fetch('/api/works');
  const data = await res.json();
  TAGS = data.tags;
  grid.replaceChildren(...data.works.map(renderCard));
  for (const work of data.works) if (work.running) followLog(work.slug);
}

function renderCard(work) {
  const card = document.createElement('article');
  card.className = 'card' + (work.running ? ' is-running' : '');
  card.dataset.slug = work.slug;

  const tags = work.tags
    .map((t) => TAGS[t])
    .filter(Boolean)
    .map((t) => `<span class="tag">${t.icon} ${t.label}</span>`)
    .join('');

  card.innerHTML = `
    <div class="card-head">
      <span class="card-name">${escapeHtml(work.name)}</span>
      <span class="card-kind">${KIND_LABEL[work.kind]}${work.port ? ` : ${work.port}` : ''}</span>
    </div>
    <p class="card-blurb">${escapeHtml(work.blurb)}</p>
    ${tags ? `<div class="tags">${tags}</div>` : ''}
    ${work.hint ? `<p class="hint">${escapeHtml(work.hint)}</p>` : ''}
    <div class="state"><span class="dot"></span><span class="state-text">${stateText(work)}</span></div>
    <details class="log" ${work.running ? '' : 'hidden'}>
      <summary>ログ（起動時の URL はここ）</summary>
      <pre></pre>
    </details>
    <div class="actions">
      <button class="btn btn-open">開く</button>
      ${work.kind === 'static' ? '' : '<button class="btn btn-stop">停止</button>'}
      <button class="btn btn-readme">README</button>
    </div>
  `;

  card.querySelector('.btn-open').addEventListener('click', (e) => open(work, e.currentTarget, card));
  card.querySelector('.btn-stop')?.addEventListener('click', () => stop(work, card));
  card.querySelector('.btn-readme').addEventListener('click', () => showReadme(work));
  return card;
}

const stateText = (work) =>
  work.kind === 'static' ? 'ポータルが配信' : work.running ? `起動中 · localhost:${work.port}` : '停止中';

// ── 起動・停止 ──────────────────────────────────────────────
async function open(work, button, card) {
  // 静的作品は子プロセスが要らないので、待たずにそのまま開く
  if (work.kind === 'static') {
    window.open(`/w/${work.slug}/`, '_blank');
    return;
  }

  setState(card, '起動しています…');
  button.disabled = true;
  try {
    const res = await fetch(`/api/start/${work.slug}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? '起動に失敗しました');

    card.classList.add('is-running');
    setState(card, `起動中 · localhost:${work.port}`);
    card.querySelector('.log').hidden = false;
    followLog(work.slug);
    window.open(data.url, '_blank');
  } catch (err) {
    setState(card, err.message, true);
  } finally {
    button.disabled = false;
  }
}

async function stop(work, card) {
  await fetch(`/api/stop/${work.slug}`, { method: 'POST' });
  card.classList.remove('is-running');
  setState(card, '停止中');
  unfollowLog(work.slug);
}

function setState(card, text, isError = false) {
  card.querySelector('.state-text').textContent = text;
  card.querySelector('.state').classList.toggle('error', isError);
}

// ── 子プロセスの標準出力 ────────────────────────────────────
// MojiHakobi は P1/P2 コントローラの URL を、nfc-reader は NFC タグに書き込む URL を
// 起動時に標準出力へ出す。IP を画面側で計算し直さず、そのまま見せる。
function followLog(slug) {
  if (logTimers.has(slug)) return;
  const tick = async () => {
    const card = grid.querySelector(`[data-slug="${slug}"]`);
    if (!card) return unfollowLog(slug);
    const res = await fetch(`/api/log/${slug}`);
    const data = await res.json();
    card.querySelector('.log pre').textContent = data.log.trimEnd();
    if (!data.running) {
      // 作品が自分で落ちた場合もここで気づく
      card.classList.remove('is-running');
      setState(card, '停止中');
      unfollowLog(slug);
    }
  };
  tick();
  logTimers.set(slug, setInterval(tick, 1000));
}

function unfollowLog(slug) {
  clearInterval(logTimers.get(slug));
  logTimers.delete(slug);
}

// ── README ──────────────────────────────────────────────────
async function showReadme(work) {
  readmeTitle.textContent = work.name;
  readmeBody.textContent = '読み込み中…';
  dialog.showModal();
  const res = await fetch(`/api/readme/${work.slug}`);
  const data = await res.json();
  readmeBody.textContent = data.text ?? data.error;
}

document.getElementById('readme-close').addEventListener('click', () => dialog.close());

// ── テーマ（sumi は data-theme で反転する）────────────────────
document.getElementById('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

const escapeHtml = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

loadWorks().catch((err) => {
  grid.innerHTML = `<p class="loading">一覧を取得できません: ${escapeHtml(err.message)}</p>`;
});
