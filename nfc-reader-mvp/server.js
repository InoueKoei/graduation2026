// ============================================================
// 「な」しかないカルタ ─ NFCリーダー(iPhone)運用の検証MVP
// ------------------------------------------------------------
// 遊び方: 表示画面で「スタート」→ 書体名（お題）が1問ずつ出る。
//   全部『な』の一文字で書体だけ違う札（NFCタグ）から、お題の書体を探して
//   iPhoneでスキャン。一致で次の問題へ。全8問そろえるまでのタイムを測る。
//
//   NFCタグ (URL: http://<MacのIP>:3000/scan?card=01)
//     → iPhone「ショートカット」が URL を取得/開く
//       → サーバーが「スキャンした札 === いまのお題」を判定
//         → 正解なら次の問題、不正解なら振動。SSEで画面をリアルタイム更新。
//
// 依存パッケージなし。`node server.js` だけで起動します。
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = 3000; // ポートを変えたいときはここ
const QUESTION_COUNT = 8; // ★ 1ゲームの出題数（全8問）。ここを変えれば問題数が変わる。

const ROOT = __dirname;
const CARDS_PATH = path.join(ROOT, "cards.json");

const MIME = {
  ".css": "text/css",
  ".js": "application/javascript",
  ".html": "text/html",
  ".json": "application/json",
};

// --- 状態（サーバー起動中だけメモリに保持）---
let manualPromptId = null; // ゲーム外で手動指定したお題
let lastScan = null;
const scanLog = [];
const sseClients = new Set();

// ゲーム状態
const game = {
  phase: "idle", // "idle" | "playing" | "finished"
  mode: "hint", // "hint"（その書体の『な』を見せる）| "nohint"（書体名だけ）
  questions: [], // 出題する札idの配列（長さ QUESTION_COUNT）
  index: 0, // いま何問目か（0始まり）
  startAt: null, // 開始時刻(epoch ms)
  endAt: null, // 終了時刻(epoch ms)
  misses: 0, // 誤答(お手つき)回数
};

// --- cards.json を毎回読む（編集は再起動不要で反映）---
function loadCards() {
  try {
    return JSON.parse(fs.readFileSync(CARDS_PATH, "utf8")).cards || [];
  } catch (e) {
    console.error("cards.json の読み込みに失敗:", e.message);
    return [];
  }
}
function findCard(id) {
  return loadCards().find((c) => String(c.id) === String(id)) || null;
}

// いまのお題（ゲーム中はその問題、ゲーム外は手動指定 or 先頭）
function currentPromptId() {
  if (game.phase === "playing") return game.questions[game.index];
  const cards = loadCards();
  if (!manualPromptId && cards.length) manualPromptId = cards[0].id;
  return manualPromptId;
}
function getPrompt() {
  const card = findCard(currentPromptId());
  return card
    ? { id: card.id, title: card.title, font: card.font || "" }
    : { id: null, title: "（お題なし）", font: "" };
}

// --- SSE 配信 ---
function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}
function gameState() {
  return {
    type: "game",
    phase: game.phase,
    mode: game.mode, // "hint" | "nohint"
    questionNo: game.phase === "idle" ? 0 : game.index + 1, // 1始まり
    total: game.questions.length || QUESTION_COUNT,
    startAt: game.startAt,
    endAt: game.endAt,
    elapsedMs: game.startAt ? (game.endAt || Date.now()) - game.startAt : 0,
    misses: game.misses,
  };
}
function promptState() {
  const p = getPrompt();
  return { type: "prompt", promptId: p.id, promptTitle: p.title, promptFont: p.font };
}
function broadcastGameAndPrompt() {
  broadcast(gameState());
  broadcast(promptState());
}

// --- ゲーム操作 ---
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function startGame(mode) {
  const deck = loadCards();
  const n = Math.min(QUESTION_COUNT, deck.length);
  game.mode = mode === "nohint" ? "nohint" : "hint";
  game.questions = shuffle(deck).slice(0, n).map((c) => c.id);
  game.index = 0;
  game.misses = 0;
  game.startAt = Date.now();
  game.endAt = null;
  game.phase = "playing";
  console.log(`[game] スタート（${n}問・${game.mode}）: ${game.questions.join(", ")}`);
  broadcastGameAndPrompt();
}
function finishGame(aborted) {
  game.endAt = Date.now();
  game.phase = "finished";
  console.log(`[game] ${aborted ? "中断" : "クリア"} 経過=${game.endAt - game.startAt}ms 誤答=${game.misses}`);
  broadcast(gameState());
}

// --- スキャン1回を判定・記録・配信 ---
function recordScan(cardId) {
  const card = findCard(cardId);
  const prompt = getPrompt();
  const correct = card ? String(card.id) === String(prompt.id) : false;

  // ゲーム進行：正解なら次の問題へ（最後なら終了）。不正解はお手つきとして数える。
  let advanced = false;
  if (game.phase === "playing") {
    if (correct) {
      if (game.index + 1 >= game.questions.length) {
        finishGame(false);
        advanced = true;
      } else {
        game.index++;
        advanced = true;
      }
    } else if (card) {
      game.misses++;
    }
  }

  let message, mark;
  if (!card) {
    message = `未登録の札です（card="${cardId}"）`;
    mark = "—";
  } else if (correct) {
    message = `正解！「${card.title}」`;
    mark = "○";
  } else {
    // 取った札が何だったかを返す（お題は画面に出ているので重ねて言わない）
    message = `それは「${card.title}」！`;
    mark = "×";
  }

  const g = gameState();
  const entry = {
    type: "scan",
    at: new Date().toISOString(),
    requestedId: cardId,
    found: !!card,
    id: card ? card.id : cardId,
    title: card ? card.title : "未登録タグ",
    promptTitle: prompt.title,
    correct: card ? correct : null,
    mark,
    message,
    vibrate: !correct, // 不正解・未登録で振動
    haptic: !correct ? "vibrate" : "none",
    // ゲーム進行のスナップショット
    questionNo: g.questionNo,
    total: g.total,
    phase: g.phase,
  };
  lastScan = entry;
  scanLog.unshift(entry);
  if (scanLog.length > 50) scanLog.pop();

  broadcast(entry);
  // 問題が進んだ／終わったら、お題・ゲーム状態も更新配信
  if (advanced) broadcastGameAndPrompt();
  return entry;
}

// ============================================================
// iPhoneのSafariでタグを直接開いたとき用の簡易ページ
// ============================================================
function resultPage(entry) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>${escapeHtml(entry.title)}</title>
<style>
  html,body{margin:0;height:100%;font-family:"ZEN Interface",system-ui,sans-serif;}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;
       background:${entry.correct ? "#000" : "#fff"};color:${entry.correct ? "#fff" : "#000"};
       text-align:center;padding:24px;box-sizing:border-box;}
  .mark{font-size:22vw;line-height:1;font-weight:700;}
  .title{font-size:9vw;margin:8px 0 16px;font-weight:700;}
  .msg{font-size:1.1rem;opacity:.8;}
</style></head>
<body>
  <div class="mark">${entry.mark}</div>
  <div class="title">${escapeHtml(entry.title)}</div>
  <div class="msg">${escapeHtml(entry.message)}</div>
</body></html>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

// ============================================================
// ルーティング
// ============================================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // スキャン
  if (p === "/scan") {
    const cardId = url.searchParams.get("card") || "";
    const entry = recordScan(cardId);
    const format = url.searchParams.get("format");
    if (format === "json") return send(res, 200, "application/json; charset=utf-8", JSON.stringify(entry));
    if (format === "haptic") return send(res, 200, "text/plain; charset=utf-8", entry.haptic);
    return send(res, 200, "text/html; charset=utf-8", resultPage(entry));
  }

  // ゲーム操作: /game?action=start | end
  if (p === "/game") {
    const action = url.searchParams.get("action");
    if (action === "start") startGame(url.searchParams.get("mode"));
    else if (action === "end") finishGame(true);
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify(gameState()));
  }

  // お題を手動で切り替える（ゲーム外の確認用）: /prompt?card=03 | random=1
  if (p === "/prompt") {
    if (url.searchParams.get("random")) {
      const cards = loadCards();
      if (cards.length) manualPromptId = cards[Math.floor(Math.random() * cards.length)].id;
    } else if (findCard(url.searchParams.get("card"))) {
      manualPromptId = String(url.searchParams.get("card"));
    }
    broadcast(promptState());
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify(getPrompt()));
  }

  // リアルタイムストリーム
  if (p === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`data: ${JSON.stringify(gameState())}\n\n`);
    res.write(`data: ${JSON.stringify(promptState())}\n\n`);
    if (lastScan) res.write(`data: ${JSON.stringify(lastScan)}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // 状態一式（+ この機の接続URL。IPが変わっても画面に出せるように）
  if (p === "/api/state") {
    const urls = lanIPs().map((ip) => `http://${ip}:${PORT}`);
    return send(res, 200, "application/json; charset=utf-8",
      JSON.stringify({ game: gameState(), prompt: getPrompt(), last: lastScan, log: scanLog, cards: loadCards(), urls }));
  }

  // 表示画面
  if (p === "/" || p === "/display") {
    return send(res, 200, "text/html; charset=utf-8",
      fs.readFileSync(path.join(ROOT, "public", "display.html"), "utf8"));
  }

  // 静的ファイル
  const staticPath = path.join(ROOT, "public", path.basename(p));
  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    const type = MIME[path.extname(staticPath)] || "text/plain";
    return send(res, 200, `${type}; charset=utf-8`, fs.readFileSync(staticPath, "utf8"));
  }

  send(res, 404, "text/plain; charset=utf-8", "Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n======= 「な」しかないカルタ MVP 起動 =======");
  console.log(`表示画面(Mac/iPad):  http://localhost:${PORT}/`);
  console.log(`出題数: 全${QUESTION_COUNT}問`);
  console.log("\nNFCタグに書き込むURL（同じWi-Fi内から）:");
  for (const ip of lanIPs()) {
    console.log(`  http://${ip}:${PORT}/scan?card=01   ← card=の値を札の番号に (01〜)`);
  }
  console.log("============================================\n");
});

function lanIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces))
    for (const i of ifaces[name]) if (i.family === "IPv4" && !i.internal) out.push(i.address);
  return out.length ? out : ["<MacのIP>"];
}
