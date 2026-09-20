// ============================================================
// 文字運び ─ 共同運搬型かな文字入力 MVP
// ------------------------------------------------------------
// 構成:
//   メイン画面 (Mac)     : http://<MacのIP>:3100/        ← 文字と2つのカーソルを描画
//   P1 コントローラ      : http://<MacのIP>:3100/c?p=1   ← iPad / iPhone / PC
//   P2 コントローラ      : http://<MacのIP>:3100/c?p=2
//
// このサーバーは「中継役」と「記録役」だけを担当する。
// 文字の重さ判定・共同運搬・濁点スナップといったロジックは
// すべてメイン画面 (public/main.js) 側に置いてある。
// そうすると描画とロジックが同じ場所にまとまり、遅延も最小になる。
//
//   コントローラ --(指の座標)--> サーバー --(中継)--> メイン画面
//   メイン画面   --(研究ログ)--> サーバー --> logs/*.jsonl
//
// 依存パッケージなし。`node server.js` だけで起動する。
// WebSocket は RFC 6455 の必要な部分だけを手書きしてある（下部参照）。
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3100;

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const LOG_DIR = path.join(ROOT, "logs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// ============================================================
// 研究ログ
// ------------------------------------------------------------
// 1セッション = 1ファイル。1行1イベントの JSONL。
// 起動時に1つ開き、メイン画面から newSession が来たら開き直す。
// ============================================================

let logStream = null;
let sessionId = null;

function startSession() {
  if (logStream) {
    writeLog({ type: "session_end" });
    logStream.end();
  }
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  sessionId =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;

  logStream = fs.createWriteStream(path.join(LOG_DIR, `session-${sessionId}.jsonl`), {
    flags: "a",
  });
  writeLog({ type: "session_start" });
  console.log(`[log] セッション開始: logs/session-${sessionId}.jsonl`);
  return sessionId;
}

function writeLog(event) {
  if (!logStream) return;
  logStream.write(JSON.stringify({ sessionId, ts: Date.now(), ...event }) + "\n");
}

// ============================================================
// 接続の管理
// ------------------------------------------------------------
// role は main / p1 / p2 の3つ。同じ role で後から繋ぐと、
// 古いほうを切る（テスト中に端末を繋ぎ直すことが多いため）。
// ============================================================

/** @type {Map<string, object>} role -> ws */
const peers = new Map();

function sendTo(role, msg) {
  const ws = peers.get(role);
  if (ws) ws.send(JSON.stringify(msg));
}

function sendToControllers(msg) {
  sendTo("p1", msg);
  sendTo("p2", msg);
}

/** メイン画面が持っている情報を、あとから繋いだコントローラへ配る用に覚えておく */
let lastStage = null; // { aspect }
let lastPalette = null; // { cells: [...] }

function broadcastPresence() {
  const presence = {
    t: "presence",
    main: peers.has("main"),
    p1: peers.has("p1"),
    p2: peers.has("p2"),
  };
  sendTo("main", presence);
  sendToControllers(presence);
}

function handleMessage(role, msg) {
  switch (msg.t) {
    // --- コントローラ → メイン画面 ---
    case "ptr":
      // 指／マウスの位置。x, y は 0..1 に正規化された値。
      sendTo("main", {
        t: "ptr",
        player: role,
        x: msg.x,
        y: msg.y,
        down: !!msg.down,
        // 端末側の送信時刻。往路の遅れを見るために残しておく。
        sentAt: msg.sentAt,
      });
      break;

    // --- メイン画面 → コントローラ ---
    case "stage":
      // メイン画面の縦横比。コントローラはこの比のパッドを描く。
      lastStage = { t: "stage", aspect: msg.aspect };
      sendToControllers(lastStage);
      break;

    case "palette":
      // 置き場のセル配置。コントローラに薄いグリッドを出すために使う。
      lastPalette = { t: "palette", cells: msg.cells, rect: msg.rect };
      sendToControllers(lastPalette);
      break;

    case "hold":
      // 「いま掴んでいる／重くて動かない／運べている」を本人の端末へ返す。
      // 手元を見なくても分かるように、コントローラは画面の縁の色を変える。
      sendTo(msg.player, { t: "hold", ...msg });
      break;

    // --- メイン画面 → サーバー（記録） ---
    case "log":
      writeLog(msg.event);
      break;

    case "newSession": {
      const id = startSession();
      sendTo("main", { t: "session", sessionId: id });
      break;
    }

    default:
      break;
  }
}

// ============================================================
// HTTP
// ============================================================

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      // 展示調整中は毎回読み直したいのでキャッシュしない
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/c") pathname = "/controller.html";

  // つながらないときの切り分け用。iPad のブラウザで直接開いて確認できる。
  // 「メイン画面／P1／P2 のうち、サーバーから見て誰が繋がっているか」が分かる。
  if (pathname === "/api/peers") {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(
      JSON.stringify(
        {
          sessionId,
          接続中: {
            main: peers.has("main"),
            p1: peers.has("p1"),
            p2: peers.has("p2"),
          },
          あなた: req.socket.remoteAddress,
          サーバーのIP: localAddresses(),
        },
        null,
        1
      )
    );
    return;
  }

  if (pathname === "/api/info") {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify({ port: PORT, addresses: localAddresses(), sessionId }));
    return;
  }

  // 計測ツール（tools/measure-weights.html）からの保存先。
  // 手元でしか動かさないので認証は持たせていない。
  if (pathname === "/api/weights" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e6) req.destroy(); // 想定外に大きいものは受けない
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed.weights !== "object") {
          throw new Error("weights が入っていない");
        }
        fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
        fs.writeFileSync(
          path.join(ROOT, "data", "weights.json"),
          JSON.stringify(parsed, null, 2)
        );
        console.log(`[weights] data/weights.json を更新（書体: ${parsed.font}）`);
        res.writeHead(200, { "Content-Type": MIME[".json"] });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(String(e.message));
      }
    });
    return;
  }

  // data/ と tools/ はプロジェクト直下にあるのでそのまま辿る。
  // それ以外は public/ の中だけを見る。
  const base = /^\/(data|tools)\//.test(pathname) ? ROOT : PUBLIC_DIR;
  const filePath = path.join(base, pathname);

  // ディレクトリの外に出る指定を弾く
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("403");
    return;
  }
  serveFile(res, filePath);
});

// ============================================================
// WebSocket（RFC 6455 のうち必要な部分だけ）
// ------------------------------------------------------------
// カーソル座標を毎フレーム送るので HTTP では間に合わない。
// かといって依存パッケージは増やしたくないので、
// ハンドシェイクとフレームの読み書きだけを自前で書いてある。
// テキストフレームしか扱わない（送受信するのは JSON だけ）。
// ============================================================

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const role = url.searchParams.get("role");
  if (!["main", "p1", "p2"].includes(role)) {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true); // 座標の中継なので、まとめずに即送る

  const ws = createConnection(socket, role);

  // 同じ役割の古い接続は切る（端末を繋ぎ直したとき用）。
  // 切られた側には理由を伝える。伝えないと向こうが繋ぎ直してきて、
  // 2台で役割を奪い合ったまま、どちらも繋がらなくなる。
  const old = peers.get(role);
  if (old && old !== ws) {
    old.send(JSON.stringify({ t: "replaced" }));
    old.close();
    console.log(`[ws] ${role} は新しい端末に交代した（前の端末は切断）`);
  }
  peers.set(role, ws);

  console.log(`[ws] ${role} 接続`);
  writeLog({ type: "peer_connect", player: role });

  // 後から繋いだ側にも、いまの状況を渡しておく
  if (role === "main") {
    // どのログファイルに記録されているかを画面側でも分かるようにする
    ws.send(JSON.stringify({ t: "session", sessionId }));
  } else {
    if (lastStage) ws.send(JSON.stringify(lastStage));
    if (lastPalette) ws.send(JSON.stringify(lastPalette));
  }
  broadcastPresence();
});

/**
 * ソケット1本を WebSocket 接続として扱うラッパを作る。
 * 受け取ったテキストフレームは JSON として handleMessage へ渡す。
 */
function createConnection(socket, role) {
  let buffer = Buffer.alloc(0);
  let closed = false;
  // 分割送信されたフレームを繋ぎ直すための入れ物
  let fragments = [];
  let fragmentOpcode = 0;
  let alive = true;

  const ws = {
    role,
    send(text) {
      if (closed) return;
      try {
        socket.write(encodeFrame(0x1, Buffer.from(text, "utf8")));
      } catch {
        cleanup();
      }
    },
    close() {
      if (closed) return;
      try {
        socket.write(encodeFrame(0x8, Buffer.alloc(0)));
        // destroy ではなく end。直前に送った「交代した」の通知を
        // 捨てずに書き切ってから閉じる。
        socket.end();
      } catch {
        socket.destroy();
      }
      cleanup();
    },
  };

  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    if (peers.get(role) === ws) {
      peers.delete(role);
      console.log(`[ws] ${role} 切断`);
      writeLog({ type: "peer_disconnect", player: role });
      broadcastPresence();
    }
  }

  // 無線の端末が黙って居なくなることがあるので、定期的に生存を確かめる
  const heartbeat = setInterval(() => {
    if (closed) return;
    if (!alive) {
      socket.destroy();
      cleanup();
      return;
    }
    alive = false;
    try {
      socket.write(encodeFrame(0x9, Buffer.alloc(0))); // ping
    } catch {
      cleanup();
    }
  }, 15000);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    // 1回の data に複数フレームが入っていることも、
    // 1フレームが複数の data に割れていることもある。
    for (;;) {
      const frame = decodeFrame(buffer);
      if (!frame) break; // まだ足りない
      buffer = buffer.subarray(frame.size);

      const { opcode, payload, fin } = frame;

      if (opcode === 0x8) {
        // close
        ws.close();
        return;
      }
      if (opcode === 0x9) {
        // ping → pong を返す
        try {
          socket.write(encodeFrame(0xa, payload));
        } catch {
          cleanup();
        }
        continue;
      }
      if (opcode === 0xa) {
        alive = true; // pong
        continue;
      }

      // テキスト以外は捨てる（このアプリは JSON しか送らない）
      if (opcode === 0x0) {
        // 継続フレーム
        fragments.push(payload);
      } else if (opcode === 0x1) {
        fragments = [payload];
        fragmentOpcode = opcode;
      } else {
        fragments = [];
        continue;
      }

      if (!fin) continue;
      if (fragmentOpcode !== 0x1) {
        fragments = [];
        continue;
      }

      const text = Buffer.concat(fragments).toString("utf8");
      fragments = [];
      alive = true;

      try {
        handleMessage(role, JSON.parse(text));
      } catch (e) {
        console.warn(`[ws] ${role} からの不正なメッセージ:`, e.message);
      }
    }
  });

  socket.on("error", cleanup);
  socket.on("close", cleanup);

  return ws;
}

/**
 * 受信バッファの先頭から1フレーム読む。
 * まだ全部届いていなければ null を返す（次の data を待つ）。
 */
function decodeFrame(buf) {
  if (buf.length < 2) return null;

  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    const big = buf.readBigUInt64BE(offset);
    // このアプリで 4GB のフレームが来ることはない。来たら壊れた接続とみなす。
    if (big > 0x7fffffffn) return null;
    len = Number(big);
    offset += 8;
  }

  let maskKey = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + len) return null;

  const payload = Buffer.from(buf.subarray(offset, offset + len));
  if (maskKey) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
  }

  return { fin, opcode, payload, size: offset + len };
}

/** サーバー→クライアントのフレームを組み立てる（マスクなし・分割なし） */
function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode

  return Buffer.concat([header, payload]);
}

// ============================================================
// 起動
// ============================================================

startSession();

server.listen(PORT, () => {
  const addrs = localAddresses();
  const host = addrs[0] || "localhost";
  console.log("");
  console.log("  文字運び ─ 共同運搬型かな文字入力");
  console.log("  ────────────────────────────────────────");
  console.log(`  メイン画面   http://localhost:${PORT}/`);
  console.log(`  P1           http://${host}:${PORT}/c?p=1`);
  console.log(`  P2           http://${host}:${PORT}/c?p=2`);
  console.log(`  重さ計測     http://localhost:${PORT}/tools/measure-weights.html`);
  if (addrs.length > 1) console.log(`  （他のIP: ${addrs.slice(1).join(", ")}）`);
  console.log("");
  console.log("  コントローラはメイン画面と同じ Wi-Fi につないでから開く。");
  console.log("");
});

process.on("SIGINT", () => {
  writeLog({ type: "session_end" });
  if (logStream) logStream.end();
  process.exit(0);
});
