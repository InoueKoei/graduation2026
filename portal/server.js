// ============================================================
// 制作ポータル ─ ローカル・ランチャー
// ------------------------------------------------------------
// works/ の作品を1か所から開くための入口。
//
//   カタログ          http://localhost:8080/
//   静的作品          http://localhost:8080/w/<slug>/      ← このサーバが直接配信
//   vite / node 作品  子プロセスを起動し、その作品自身のポートへリダイレクト
//
// 作品側のコードには一切触らない。だから壊れても作品は無傷。
//   - 静的5件は参照がすべて相対パスなので、サブパス配信でそのまま動く
//   - vite 3件は node_modules/.bin/vite を直接叩き、--port を外から与える
//     （npm script 経由だと moji-korogashi と EasyReta が 5174 で衝突する）
//   - node 2件は PORT 環境変数を渡す
//
// 中継（プロキシ）はしない。MojiHakobi は手書きの WebSocket、nfc-reader は SSE、
// vite は HMR の WebSocket を使う。リダイレクトなら各作品が自分のオリジンで動き、
// localhost なのでカメラ・WebSerial の secure context も満たす。
//
// 依存パッケージなし。`node server.js` だけで起動する。
// ============================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { WORKS, TAGS, findWork } from './works.js';

const PORT = Number(process.env.PORT) || 8080;
const PORTAL_DIR = import.meta.dirname;
const PUBLIC_DIR = path.join(PORTAL_DIR, 'public');
const ROOT = path.resolve(PORTAL_DIR, '..');   // = SourceCode/

/** 起動中の子プロセス。slug → { child, port, log[], startedAt } */
const running = new Map();
/** 子プロセスの標準出力を溜める上限（行）。LAN の URL が読めれば十分 */
const LOG_LINES = 300;

// ── 静的配信 ────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
};

function sendFile(res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'text/plain; charset=utf-8', 'not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',   // 制作中のファイルを配るので常に読み直す
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const sendJson = (res, status, obj) =>
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));

/** baseDir の外に出ないように解決する。出ようとしたら null */
function safeJoin(baseDir, relative) {
  const target = path.resolve(baseDir, '.' + path.posix.normalize('/' + relative));
  const base = path.resolve(baseDir);
  return target === base || target.startsWith(base + path.sep) ? target : null;
}

// ── 子プロセスの起動と停止 ──────────────────────────────────
// 疎通の確認先は 127.0.0.1 ではなく localhost にする。
// vite は既定で [::1]（IPv6）にしか bind しないため、127.0.0.1 では ECONNREFUSED になる。
// localhost なら Node が IPv4 / IPv6 の両方を試すので、どちらの作品も正しく判定できる。
const PROBE_HOST = 'localhost';

/** ポートが LISTEN 状態になるまで待つ（起動完了の判定） */
function waitForPort(port, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host: PROBE_HOST });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`ポート ${port} が開きませんでした`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

/** ポートが既に誰かに使われているか（別で起動済みの作品を二重起動しないため） */
function isPortBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: PROBE_HOST });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}

function spawnWork(work) {
  const cwd = path.join(ROOT, work.dir);

  if (work.kind === 'vite') {
    const vite = path.join(cwd, 'node_modules', '.bin', 'vite');
    if (!fs.existsSync(vite)) {
      throw new Error(`vite が見つかりません。${work.dir} で npm install してください`);
    }
    // npm script を経由しない：script 側の --port と vite.config の port が
    // 作品どうしで衝突するため、ここで与えるポートだけを正とする
    return spawn(vite, ['--port', String(work.port), '--strictPort'], { cwd });
  }

  return spawn(process.execPath, [work.entry], {
    cwd,
    env: { ...process.env, PORT: String(work.port) },
  });
}

async function startWork(work) {
  if (running.has(work.slug)) return running.get(work.slug);

  if (await isPortBusy(work.port)) {
    throw new Error(`ポート ${work.port} は既に使われています（別で起動済み？）`);
  }

  const child = spawnWork(work);
  const entry = { child, port: work.port, log: [], startedAt: Date.now() };
  running.set(work.slug, entry);

  const collect = (chunk) => {
    for (const line of String(chunk).split('\n')) entry.log.push(line);
    if (entry.log.length > LOG_LINES) entry.log.splice(0, entry.log.length - LOG_LINES);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  child.on('exit', (code, signal) => {
    running.delete(work.slug);
    console.log(`  [${work.slug}] 終了 (code=${code} signal=${signal})`);
  });
  child.on('error', (err) => {
    entry.log.push(`起動に失敗: ${err.message}`);
  });

  try {
    await waitForPort(work.port);
  } catch (err) {
    stopWork(work.slug);
    // 子プロセスが理由を出しているはずなので、それも返す
    throw new Error(`${err.message}\n${entry.log.slice(-8).join('\n')}`);
  }
  console.log(`  [${work.slug}] 起動 → http://localhost:${work.port}/`);
  return entry;
}

/** SIGINT で止める。MojiHakobi は SIGINT で研究ログを閉じるので、強制終了しない */
function stopWork(slug) {
  const entry = running.get(slug);
  if (!entry) return false;
  entry.child.kill('SIGINT');
  return true;
}

// ── ルーティング ────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  // --- API ---
  if (pathname === '/api/works') {
    return sendJson(res, 200, {
      tags: TAGS,
      works: WORKS.map((w) => ({
        slug: w.slug, name: w.name, kind: w.kind, dir: w.dir,
        tags: w.tags, blurb: w.blurb, hint: w.hint ?? null,
        port: w.port ?? null,
        running: running.has(w.slug),
        url: w.kind === 'static' ? `/w/${w.slug}/` : `http://localhost:${w.port}/`,
      })),
    });
  }

  const apiMatch = pathname.match(/^\/api\/(start|stop|log|readme)\/(.+)$/);
  if (apiMatch) {
    const [, action, slug] = apiMatch;
    const work = findWork(slug);
    if (!work) return sendJson(res, 404, { error: `未知の作品: ${slug}` });

    if (action === 'start') {
      if (work.kind === 'static') return sendJson(res, 200, { url: `/w/${work.slug}/` });
      try {
        await startWork(work);
        return sendJson(res, 200, { url: `http://localhost:${work.port}/` });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (action === 'stop') {
      return sendJson(res, 200, { stopped: stopWork(slug) });
    }

    if (action === 'log') {
      const entry = running.get(slug);
      return sendJson(res, 200, {
        running: Boolean(entry),
        log: entry ? entry.log.join('\n') : '',
      });
    }

    // readme
    const file = path.join(ROOT, work.dir, 'README.md');
    return fs.promises.readFile(file, 'utf8')
      .then((text) => sendJson(res, 200, { text }))
      .catch(() => sendJson(res, 404, { error: 'README.md がありません' }));
  }

  // --- 静的作品の配信 /w/<slug>/... ---
  if (pathname.startsWith('/w/')) {
    const rest = pathname.slice(3);
    const slash = rest.indexOf('/');
    const slug = slash === -1 ? rest : rest.slice(0, slash);
    const work = findWork(slug);
    if (!work) return send(res, 404, 'text/plain; charset=utf-8', `未知の作品: ${slug}`);
    if (work.kind !== 'static') {
      return send(res, 404, 'text/plain; charset=utf-8',
        `${work.name} は子プロセスで動く作品です（ポータルから起動してください）`);
    }
    // 末尾スラッシュが無いと作品内の相対パスが1階層ずれるので揃える
    if (slash === -1) {
      res.writeHead(302, { Location: `/w/${slug}/` });
      return res.end();
    }

    const workDir = path.join(ROOT, work.dir);
    let target = safeJoin(workDir, rest.slice(slash));
    if (!target) return send(res, 403, 'text/plain; charset=utf-8', 'forbidden');
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      target = path.join(target, 'index.html');
    }
    return sendFile(res, target);
  }

  // --- ポータル自身の画面 ---
  const target = safeJoin(PUBLIC_DIR, pathname === '/' ? '/index.html' : pathname);
  if (!target) return send(res, 403, 'text/plain; charset=utf-8', 'forbidden');
  return sendFile(res, target);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  制作ポータル');
  console.log('  ────────────────────────────────────────');
  console.log(`  http://localhost:${PORT}/`);
  console.log(`  作品 ${WORKS.length} 件（静的 ${WORKS.filter((w) => w.kind === 'static').length} / vite ${WORKS.filter((w) => w.kind === 'vite').length} / node ${WORKS.filter((w) => w.kind === 'node').length}）`);
  console.log('');
  console.log('  Ctrl-C で、起動中の作品もまとめて終了する。');
  console.log('');
});

// ポータルを閉じたら子プロセスも閉じる（孤児を残さない）
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const slugs = [...running.keys()];
  if (slugs.length) console.log(`\n  起動中の作品を終了します: ${slugs.join(', ')}`);
  for (const slug of slugs) stopWork(slug);
  server.close();
  // 子プロセスが SIGINT を処理する猶予を置いてから抜ける
  setTimeout(() => process.exit(0), slugs.length ? 700 : 0).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
