// ============================================================
// 「な」しかないカルタ 表示画面ロジック
// SSE で届く3種のイベントを捌く:
//   type:"game"   … ゲーム状態(idle/playing/finished・経過時間・進捗)
//   type:"prompt" … いまのお題(書体名)
//   type:"scan"   … 札スキャン結果(○/×)
// ============================================================
const $ = (id) => document.getElementById(id);
const body = document.body;
const els = {
  timer: $("timer"), startBtn: $("startBtn"), endBtn: $("endBtn"),
  qNo: $("qNo"), qTotal: $("qTotal"), odai: $("odai"), feedback: $("feedback"),
  hintChar: $("hintChar"), resultTime: $("resultTime"), resultMsg: $("resultMsg"),
  simBtns: $("simBtns"), modeSelect: $("modeSelect"),
};

let promptTitle = "—";
let currentPromptId = null;
let promptFont = "";
let selectedMode = "hint"; // 待機画面で選ぶモード
let tick = null; // タイマー更新用インターバル
let startAt = null; // 開始時刻(サーバ=同一Mac想定なので Date.now() と同基準)

// 読み上げ（詠み手）機能は public/readaloud.js に退避（現在オフ）。
// 再有効化の手順はそのファイル冒頭のコメントを参照。

// mm:ss.d 形式（分:秒.コンマ1桁）
function fmt(ms) {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${d}`;
}

function startTicking() {
  stopTicking();
  tick = setInterval(() => { if (startAt) els.timer.textContent = fmt(Date.now() - startAt); }, 100);
}
function stopTicking() { if (tick) clearInterval(tick); tick = null; }

// ---- ゲーム状態を反映 ----
function renderGame(g) {
  body.classList.remove("phase-idle", "phase-playing", "phase-finished");
  body.classList.add("phase-" + g.phase);
  // ヒントあり/なしの見た目切替（プレイ中に使う）
  if (g.mode) {
    body.classList.remove("mode-hint", "mode-nohint");
    body.classList.add("mode-" + g.mode);
  }
  els.qTotal.textContent = g.total;

  if (g.phase === "playing") {
    els.qNo.textContent = g.questionNo;
    startAt = g.startAt;
    startTicking();
    els.timer.textContent = fmt(Date.now() - startAt);
  } else if (g.phase === "finished") {
    stopTicking();
    els.timer.textContent = fmt(g.elapsedMs);
    els.resultTime.textContent = fmt(g.elapsedMs);
    els.resultMsg.textContent = `全${g.total}問クリア（お手つき ${g.misses} 回）`;
  } else { // idle
    stopTicking();
    startAt = null;
    els.timer.textContent = "0:00.0";
    els.feedback.textContent = "";
  }
}

// ---- お題を反映 ----
function renderPrompt(id, title, font) {
  currentPromptId = id;
  promptTitle = title || "—";
  promptFont = font || "";
  els.odai.textContent = promptTitle;
  // ヒント用の「な」を、その書体（CSS font-family）で描画。空ならブラウザ既定。
  els.hintChar.style.fontFamily = promptFont
    ? `"${promptFont}", "Hiragino Kaku Gothic ProN", sans-serif`
    : "";
  [...els.simBtns.children].forEach((b) =>
    b.classList.toggle("isPrompt", b.dataset.id === String(id)));
}

// ---- スキャン結果を反映（一瞬フィードバック） ----
function renderScan(e) {
  els.feedback.classList.toggle("miss", e.correct === false);
  els.feedback.innerHTML =
    `<span class="fbmark">${e.mark}</span><span>${escapeHtml(e.message)}</span>`;
  // 正解で次の問題に進むと prompt/ game が別途届く。表示は少し残してから薄く。
  clearTimeout(renderScan._t);
  renderScan._t = setTimeout(() => { els.feedback.textContent = ""; }, 2000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- モード選択（待機画面） ----
function selectMode(mode) {
  selectedMode = mode;
  [...els.modeSelect.children].forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode));
}
[...els.modeSelect.children].forEach((b) => (b.onclick = () => selectMode(b.dataset.mode)));
selectMode("hint"); // 既定はヒントあり

// ---- 下のテスト欄の表示/非表示（展示中は隠す。状態は記憶する） ----
const panelToggle = $("panelToggle");
function setPanelHidden(hidden) {
  body.classList.toggle("hide-panel", hidden);
  localStorage.setItem("hidePanel", hidden ? "1" : "0");
  panelToggle.textContent = hidden ? "⚙" : "✕";
  panelToggle.title = hidden ? "テスト欄を表示（Dキー）" : "テスト欄を隠す（Dキー）";
}
panelToggle.onclick = () => setPanelHidden(!body.classList.contains("hide-panel"));
// D キーでも切替（展示中に手早く出し入れする用）
document.addEventListener("keydown", (e) => {
  if ((e.key === "d" || e.key === "D") && !e.metaKey && !e.ctrlKey) {
    setPanelHidden(!body.classList.contains("hide-panel"));
  }
});
setPanelHidden(localStorage.getItem("hidePanel") === "1"); // 前回の状態を復元

// ---- 操作 ----
els.startBtn.onclick = () => fetch(`/game?action=start&mode=${selectedMode}`);
els.endBtn.onclick = () => fetch("/game?action=end");

// ---- 初期化：接続URL表示・札のシミュレートボタンを生成 ----
fetch("/api/state").then((r) => r.json()).then((s) => {
  // この機の接続先URL（IPが変わってもここに出る）。タグには …/scan?card=NN を書く。
  const connUrl = $("connUrl");
  if (connUrl) {
    const base = (s.urls && s.urls[0]) || location.origin;
    connUrl.textContent = `接続先: ${base}/　（タグ: ${base}/scan?card=NN）`;
  }
  (s.cards || []).forEach((c) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.dataset.id = c.id;
    b.textContent = `${c.id} ${c.title}`;
    b.onclick = () => fetch(`/scan?card=${encodeURIComponent(c.id)}&format=haptic`);
    els.simBtns.appendChild(b);
  });
  if (s.game) renderGame(s.game);
  if (s.prompt) renderPrompt(s.prompt.id, s.prompt.title, s.prompt.font);
});

// ---- リアルタイム受信 ----
const es = new EventSource("/events");
es.onmessage = (ev) => {
  const e = JSON.parse(ev.data);
  if (e.type === "game") renderGame(e);
  else if (e.type === "prompt") renderPrompt(e.promptId, e.promptTitle, e.promptFont);
  else if (e.type === "scan") renderScan(e);
};
