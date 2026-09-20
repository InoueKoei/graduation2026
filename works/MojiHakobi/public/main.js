// ============================================================
// 文字運び ─ メイン画面
// ------------------------------------------------------------
// 二人が別々のカーソルを動かし、同じ文字を同時に掴んで運ぶ。
// 重い文字は一人では動かない。二人で掴んではじめて動く。
//
// このファイルが持っているもの:
//   ・置き場（五十音図）と入力エリアの配置
//   ・文字オブジェクトの掴み／運び／落としの判定
//   ・一人で重い文字を掴んだときの微かな反応
//   ・濁点・半濁点のスナップ
//   ・研究ログの送信
//
// 座標はすべて「論理座標」で持つ。高さ900の箱を基準にして、
// 画面の横幅に合わせて幅だけ伸ばす。描画のときだけ実画面に拡大する。
// こうしておくと、コントローラ側は 0..1 の割合だけ送ればよくなる。
// ============================================================

import { CONFIG } from "/config.js";
import {
  GOJUON_GRID,
  EXTRA_COLUMN,
  ALL_CHARS,
  canTakeMark,
  compose,
  isMark,
} from "/kana.js";
import { connect } from "/net.js";

// ============================================================
// 状態
// ============================================================

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");

/** 論理座標の大きさ。高さは固定、幅は画面の縦横比から決める。 */
const stage = { w: 1600, h: CONFIG.stage.height };

let threshold = CONFIG.threshold;
let weights = null;
let glyphOffset = {}; // 文字ごとの「描画原点から墨の中心までのズレ」

/** 置き場のセル */
let cells = [];
let paletteBottom = 0;

/** 場に出ている文字 */
let letters = [];
let nextId = 1;

// 文字の通し番号につける、この読み込み固有の印。
// 展示中にメイン画面を再読み込みしても、ログの中で番号がぶつからないようにする。
const RUN = Math.random().toString(36).slice(2, 8);

const players = {
  p1: makePlayer("p1"),
  p2: makePlayer("p2"),
};

function makePlayer(id) {
  return {
    id,
    label: CONFIG.players[id].label,
    color: CONFIG.players[id].color,
    x: stage.w * (id === "p1" ? 0.4 : 0.6),
    y: stage.h * 0.5,
    down: false,
    connected: false,
    holding: null,
    lastHoldState: "",
  };
}

/** 開発用。展示では使わない。d キーの情報表示に状態が出る。 */
const dev = { mouseP1: false, keyP2: false };

let showDebug = false;
let sessionId = null;

// ============================================================
// 通信
// ============================================================

const net = connect("main", {
  onMessage: (msg) => {
    if (msg.t === "ptr") {
      setPointer(msg.player, msg.x * stage.w, msg.y * stage.h, msg.down);
    } else if (msg.t === "presence") {
      setConnected("p1", msg.p1);
      setConnected("p2", msg.p2);
      updateSetupPanel();
    } else if (msg.t === "session") {
      sessionId = msg.sessionId;
    }
  },
  onStatus: (connected) => {
    // 起動直後の publishStage() は、まだ繋がっていなくて捨てられていることがある。
    // 繋がった時点で送り直さないと、コントローラに置き場が出ないままになる。
    if (connected) publishStage();
    updateSetupPanel();
  },
});

function log(event) {
  if (!CONFIG.log.enabled) return;
  net.send({ t: "log", event });
}

/**
 * 端末が繋がった／切れたときの後始末。
 *
 * 掴んだまま端末が落ちる（Wi-Fiが切れる、iPadがスリープする）ことがある。
 * そのとき手を離させないと、その文字は誰も掴んでいないのに
 * 掴まれたままになり、二度と運べなくなる。
 * 重い文字なら、幽霊の持ち手のせいで残り一人でも動かせてしまう。
 */
function setConnected(pid, connected) {
  const p = players[pid];
  if (p.connected === connected) return;
  p.connected = connected;

  if (!connected && p.down) {
    log({ type: "lost_connection_release", player: pid });
    setPointer(pid, p.x, p.y, false);
  }
}

function publishStage() {
  net.send({ t: "stage", aspect: stage.w / stage.h });
  net.send({
    t: "palette",
    // コントローラは 0..1 の割合で受け取る
    cells: cells.map((c) => ({
      ch: c.ch,
      x: c.x / stage.w,
      y: c.y / stage.h,
    })),
    rect: { y0: 0, y1: paletteBottom / stage.h },
  });
}

// ============================================================
// 配置
// ============================================================

const COL_PITCH = 80; // 五十音図の列の間隔
const ROW_PITCH = 62; // 段の間隔
const EXTRA_GAP = 44; // 五十音図と「ん ゛ ゜」のあいだ
const CELL_HIT = 68; // 置き場のセルの当たり判定（正方形の一辺）

/** 画面が狭いときに置き場を縮める率。1 なら等倍。 */
let paletteFit = 1;

function layout() {
  // 論理座標の横幅は、必ず実画面の縦横比そのままにする。
  // ここで幅を制限すると、描画は高さ基準で拡大されるため、
  // はみ出した分（＝置き場の右端の「わ ん ゛ ゜」）が画面の外に出て、
  // 見えないうえに掴めなくなる。コントローラ側の座標ともずれる。
  const aspect = window.innerWidth / window.innerHeight;
  stage.w = Math.round(stage.h * aspect);

  paletteBottom = Math.round(stage.h * CONFIG.paletteRatio);

  const cols = GOJUON_GRID[0].length; // 10
  const rows = GOJUON_GRID.length; // 5

  // 幅が足りないときは、切り落とすのではなく置き場ごと縮める。
  // 五十音は全部そこに在ることに意味があるので、欠けさせない。
  const wantW = cols * COL_PITCH + EXTRA_GAP + COL_PITCH;
  paletteFit = Math.min(1, (stage.w - 48) / wantW);

  const colPitch = COL_PITCH * paletteFit;
  const rowPitch = ROW_PITCH * paletteFit;
  const gridW = cols * colPitch;
  const totalW = gridW + EXTRA_GAP * paletteFit + colPitch;
  const startX = (stage.w - totalW) / 2;
  const startY = (paletteBottom - rows * rowPitch) / 2;

  cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = GOJUON_GRID[r][c];
      if (!ch) continue; // や行・わ行の空き
      cells.push({
        ch,
        x: startX + c * colPitch + colPitch / 2,
        y: startY + r * rowPitch + rowPitch / 2,
      });
    }
  }
  // 「ん ゛ ゜」は五十音図の右にひとまとまりで置く
  EXTRA_COLUMN.forEach((ch, i) => {
    cells.push({
      ch,
      x: startX + gridW + EXTRA_GAP * paletteFit + colPitch / 2,
      y: startY + i * rowPitch + rowPitch / 2,
    });
  });

  // カーソルの初期位置は既定の広さで決めているので、
  // 実際の画面がそれより狭いと画面の外に出たまま現れない。
  for (const p of Object.values(players)) {
    p.x = Math.max(0, Math.min(stage.w, p.x));
    p.y = Math.max(0, Math.min(stage.h, p.y));
  }

  resizeCanvas();
  publishStage();
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  // 論理座標 (stage.w x stage.h) を画面いっぱいに引き伸ばす。
  // 幅を縦横比から決めているので、ここでの拡大率は縦横同じになる。
  const scale = canvas.height / stage.h;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

// ============================================================
// 文字の墨の中心を測る
// ------------------------------------------------------------
// 「゛」は仮想ボディの中で偏った位置に描かれる。素直に中央へ描くと
// 見た目の位置が思った所からずれるので、墨の中心を測って補正する。
// 全部の文字に同じ補正をかけると、当たり判定と見た目もそろう。
// ============================================================

function measureGlyphOffsets() {
  const S = 128;
  const side = S * 2;
  const c = document.createElement("canvas");
  c.width = c.height = side;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.font = `${CONFIG.fontWeight} ${S}px ${CONFIG.fontFamily}`;
  g.textAlign = "center";
  g.textBaseline = "middle";

  for (const ch of ALL_CHARS) {
    g.clearRect(0, 0, side, side);
    g.fillStyle = "#000";
    g.fillText(ch, side / 2, side / 2);

    const d = g.getImageData(0, 0, side, side).data;
    let minX = side, minY = side, maxX = -1, maxY = -1;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        if (d[((y * side + x) << 2) + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) {
      glyphOffset[ch] = { x: 0, y: 0, w: 0.5, h: 0.5 };
      continue;
    }
    glyphOffset[ch] = {
      // 文字サイズ1に対する割合で持っておく
      x: ((minX + maxX) / 2 - side / 2) / S,
      y: ((minY + maxY) / 2 - side / 2) / S,
      w: (maxX - minX) / S,
      h: (maxY - minY) / S,
    };
  }
}

// ============================================================
// 文字オブジェクト
// ============================================================

function makeLetter(ch, x, y, fromPalette) {
  const weight = weights[ch] ?? 0;
  return {
    id: `${RUN}-${nextId++}`,
    ch,
    kind: isMark(ch) ? "mark" : "base",
    weight,
    heavy: weight >= threshold,
    x,
    y,
    home: { x, y },
    spawn: { x, y },
    fromPalette,
    // 置き場から持ち上がる感じを出すため、置き場の大きさから始めて実寸へ寄せる
    size: CONFIG.paletteLetterSize,
    targetSize: CONFIG.letterSize,
    holders: new Set(),
    grabOffset: {}, // 掴んだ位置と文字のズレ
    grabRef: {}, // 一人で重い文字を掴んだときの、引っぱりの基準点
    grabAt: {},
    coOffset: null, // 二人の中点からのズレ
    attachedTo: null, // 印 → 基本文字
    mark: null, // 基本文字 → 印
    phase: Math.random() * Math.PI * 2, // 震えの位相
    firstGrabAt: 0,
    firstGrabBy: null,
    releaseCount: 0,
  };
}

const byId = (id) => letters.find((l) => l.id === id);

/** 文字の当たり判定。細い文字でも掴みやすいように下限を設けている。 */
function hitLetter(l, x, y) {
  const half = Math.max(l.size * 0.55, 26);
  return Math.abs(x - l.x) <= half && Math.abs(y - l.y) <= half;
}

/** 重なっているときは後から置いたものを優先する */
function topLetterAt(x, y) {
  for (let i = letters.length - 1; i >= 0; i--) {
    if (hitLetter(letters[i], x, y)) return letters[i];
  }
  return null;
}

function cellAt(x, y) {
  const half = (CELL_HIT * paletteFit) / 2;
  return (
    cells.find(
      (c) => Math.abs(x - c.x) <= half && Math.abs(y - c.y) <= half
    ) || null
  );
}

// ============================================================
// 掴む・運ぶ・落とす
// ============================================================

function setPointer(pid, x, y, down) {
  const p = players[pid];
  if (!p) return;

  p.x = Math.max(0, Math.min(stage.w, x));
  p.y = Math.max(0, Math.min(stage.h, y));

  const was = p.down;
  p.down = down;
  if (down && !was) onPress(p);
  else if (!down && was) onRelease(p);
}

function onPress(p) {
  // 掴んだままの取りこぼしがあれば先に片付ける
  if (p.holding != null) onRelease(p);

  const letter = topLetterAt(p.x, p.y);
  if (letter) {
    grab(p, letter);
    return;
  }
  // 置き場を掴んだら、その場に新しい文字が生まれる。
  // 生まれた文字はセルの真上に重なるので、
  // もう一人が同じセルを掴むと「同じ文字」を掴むことになる。
  const cell = cellAt(p.x, p.y);
  if (cell) grab(p, spawn(cell));
}

function spawn(cell) {
  const l = makeLetter(cell.ch, cell.x, cell.y, true);
  letters.push(l);
  return l;
}

function grab(p, l) {
  if (l.holders.has(p.id)) return;

  // くっついている印を掴んだら、そこで外れる
  if (l.kind === "mark" && l.attachedTo) {
    const base = byId(l.attachedTo);
    if (base) base.mark = null;
    l.attachedTo = null;
    log({ type: "detach", player: p.id, mark: l.ch, base: base?.ch ?? null });
  }

  const now = performance.now();
  p.holding = l.id;
  l.holders.add(p.id);
  l.grabOffset[p.id] = { dx: l.x - p.x, dy: l.y - p.y };
  l.grabRef[p.id] = { x: p.x, y: p.y };
  l.grabAt[p.id] = now;

  if (l.holders.size === 1) {
    l.firstGrabAt = now;
    l.firstGrabBy = p.id;
    l.home = { x: l.x, y: l.y };
  }

  if (l.holders.size === 2) {
    // 二人目が掴んだ瞬間に文字が中点へ飛ばないよう、
    // そのときのズレを覚えておいて、以後ずっと足す。
    // 動かす主体はあくまで二人のカーソルの中点（要件書 7章）。
    const mid = midpoint();
    l.coOffset = { dx: l.x - mid.x, dy: l.y - mid.y };

    // ★ 二人が同じ文字を掴むまでの時間差。いちばん見たい数字（要件書 14章）。
    log({
      type: "co_grab",
      letterId: l.id,
      ch: l.ch,
      weight: l.weight,
      heavy: l.heavy,
      first: l.firstGrabBy,
      second: p.id,
      gapMs: Math.round(now - l.firstGrabAt),
    });
  }

  log({
    type: "grab",
    player: p.id,
    letterId: l.id,
    ch: l.ch,
    weight: l.weight,
    heavy: l.heavy,
    holders: l.holders.size,
    fromPalette: l.fromPalette,
    x: Math.round(l.x),
    y: Math.round(l.y),
  });
}

function onRelease(p) {
  const l = byId(p.holding);
  p.holding = null;
  if (!l) return;

  l.holders.delete(p.id);
  l.releaseCount++;

  log({
    type: "release",
    player: p.id,
    letterId: l.id,
    ch: l.ch,
    heavy: l.heavy,
    heldMs: Math.round(performance.now() - (l.grabAt[p.id] || performance.now())),
    remaining: l.holders.size,
  });

  if (l.holders.size === 1) {
    // 二人で運んでいる途中で片方が離した。
    // 文字はその場で止まり、残った一人だけでは動かせない（要件書 7章）。
    // 軽い文字なら、残った一人がそのまま運び続けられる。
    const other = [...l.holders][0];
    l.home = { x: l.x, y: l.y };
    l.coOffset = null;
    l.grabOffset[other] = {
      dx: l.x - players[other].x,
      dy: l.y - players[other].y,
    };
    l.grabRef[other] = { x: players[other].x, y: players[other].y };
  } else if (l.holders.size === 0) {
    finishDrop(l);
  }
}

function finishDrop(l) {
  l.home = { x: l.x, y: l.y };

  // 置き場から出したものの、ほとんど動かせずに離した場合は片付ける。
  // 重い文字を一人で掴んで諦めたときに、置き場が二重に描かれ続けるのを防ぐ。
  const barelyMoved =
    l.fromPalette && Math.hypot(l.x - l.spawn.x, l.y - l.spawn.y) < 8;

  const onPalette = l.y < paletteBottom;

  if (barelyMoved || (CONFIG.drop.removeOnPalette && onPalette)) {
    removeLetter(l, barelyMoved ? "動かせず戻した" : "置き場に戻した");
    return;
  }

  if (l.kind === "mark") trySnap(l);

  log({
    type: "drop",
    letterId: l.id,
    ch: l.ch,
    weight: l.weight,
    heavy: l.heavy,
    x: Math.round(l.x),
    y: Math.round(l.y),
    carriedMs: Math.round(performance.now() - l.firstGrabAt),
    releaseCount: l.releaseCount,
    attachedTo: l.attachedTo ? byId(l.attachedTo)?.ch ?? null : null,
    text: readText(),
  });
}

/** 濁点・半濁点を、近くの基本文字の右上へスナップさせる（要件書 4章） */
function trySnap(mark) {
  let best = null;
  let bestDist = Infinity;

  for (const b of letters) {
    if (b.kind !== "base" || b.mark) continue;
    if (CONFIG.dakuten.strict && !canTakeMark(b.ch, mark.ch)) continue;

    const a = attachPoint(b);
    const d = Math.hypot(mark.x - a.x, mark.y - a.y);
    if (d < CONFIG.dakuten.snapRadius && d < bestDist) {
      best = b;
      bestDist = d;
    }
  }

  // 付かなかった場合は、落ちた場所にそのまま残る
  if (!best) return;

  mark.attachedTo = best.id;
  best.mark = mark.id;

  log({
    type: "snap",
    base: best.ch,
    mark: mark.ch,
    composed: compose(best.ch, mark.ch),
    distance: Math.round(bestDist),
  });
}

function attachPoint(base) {
  return {
    x: base.x + base.size * CONFIG.dakuten.offsetX,
    y: base.y + base.size * CONFIG.dakuten.offsetY,
  };
}

function removeLetter(l, reason) {
  // 基本文字を消すときは、ついている印も一緒に消す
  if (l.mark) {
    const m = byId(l.mark);
    if (m) letters = letters.filter((x) => x !== m);
  }
  if (l.attachedTo) {
    const b = byId(l.attachedTo);
    if (b) b.mark = null;
  }
  for (const p of Object.values(players)) {
    if (p.holding === l.id) p.holding = null;
  }
  letters = letters.filter((x) => x !== l);

  log({ type: "remove", letterId: l.id, ch: l.ch, reason });
}

function midpoint() {
  // 二人のカーソルの中点（要件書 7章）
  return {
    x: (players.p1.x + players.p2.x) / 2,
    y: (players.p1.y + players.p2.y) / 2,
  };
}

// ============================================================
// 毎フレームの更新
// ============================================================

function update(now) {
  for (const l of letters) {
    l.size += (l.targetSize - l.size) * 0.18;

    if (l.holders.size === 0) continue;

    if (l.holders.size === 2) {
      // 二人がかり。文字は二人のカーソルの中点で動く。
      const mid = midpoint();
      l.x = mid.x + l.coOffset.dx;
      l.y = mid.y + l.coOffset.dy;
    } else {
      const p = players[[...l.holders][0]];

      if (!l.heavy) {
        // 軽い文字は一人で運べる
        l.x = p.x + l.grabOffset[p.id].dx;
        l.y = p.y + l.grabOffset[p.id].dy;
      } else {
        // 重い文字を一人で掴んでいる。動かないが、無反応にはしない。
        // カーソルの方へ数pxだけついてくる（要件書 13章）。
        let vx = p.x - l.grabRef[p.id].x;
        let vy = p.y - l.grabRef[p.id].y;
        const d = Math.hypot(vx, vy);
        if (d > CONFIG.heavy.pullMax) {
          vx = (vx / d) * CONFIG.heavy.pullMax;
          vy = (vy / d) * CONFIG.heavy.pullMax;
        }
        l.x += (l.home.x + vx - l.x) * CONFIG.heavy.pullEase;
        l.y += (l.home.y + vy - l.y) * CONFIG.heavy.pullEase;
      }
    }

    // 画面の外に出て見失わないようにする
    const m = l.size * 0.5;
    l.x = Math.max(m, Math.min(stage.w - m, l.x));
    l.y = Math.max(m, Math.min(stage.h - m, l.y));
  }

  // 位置が決まってから、くっついている印を追従させる
  for (const m of letters) {
    if (m.kind !== "mark" || !m.attachedTo || m.holders.size > 0) continue;
    const b = byId(m.attachedTo);
    if (!b) {
      m.attachedTo = null;
      continue;
    }
    const a = attachPoint(b);
    m.x = a.x;
    m.y = a.y;
  }

  reportHoldState();
  sampleTrace(now);
}

/** 手元の端末に「掴んでいる／重くて動かない／運べている」を返す */
function reportHoldState() {
  for (const p of Object.values(players)) {
    const l = byId(p.holding);
    const state = !l
      ? "none"
      : !l.heavy || l.holders.size >= 2
        ? "carry"
        : "stuck";
    if (state !== p.lastHoldState) {
      p.lastHoldState = state;
      net.send({ t: "hold", player: p.id, state });
    }
  }
}

let lastTrace = 0;
function sampleTrace(now) {
  if (!CONFIG.log.enabled || !CONFIG.log.traceHz) return;
  if (now - lastTrace < 1000 / CONFIG.log.traceHz) return;
  lastTrace = now;

  // 各プレイヤーの移動軌跡（要件書 14章）
  log({
    type: "trace",
    p1: traceOf(players.p1),
    p2: traceOf(players.p2),
  });
}

function traceOf(p) {
  return {
    x: Math.round(p.x),
    y: Math.round(p.y),
    down: p.down,
    holding: p.holding ? byId(p.holding)?.ch ?? null : null,
  };
}

/**
 * いま置かれている文字を、読める順に並べた文字列にする。
 * 落とした場所にそのまま置く方式なので、
 * y が近いものを同じ行とみなし、行の中で x 順に読む。
 * 記録用であって、画面の配置には影響しない。
 */
function readText() {
  const bases = letters.filter((l) => l.kind === "base" && !l.holders.size);
  if (!bases.length) return "";

  const lines = [];
  for (const l of [...bases].sort((a, b) => a.y - b.y)) {
    const line = lines.find(
      (L) => Math.abs(L.y - l.y) < CONFIG.letterSize * 0.8
    );
    if (line) {
      line.items.push(l);
      line.y = line.items.reduce((s, i) => s + i.y, 0) / line.items.length;
    } else {
      lines.push({ y: l.y, items: [l] });
    }
  }

  return lines
    .map((L) =>
      L.items
        .sort((a, b) => a.x - b.x)
        .map((l) => compose(l.ch, l.mark ? byId(l.mark)?.ch : null))
        .join("")
    )
    .join("\n");
}

// ============================================================
// 描画
// ============================================================

function draw(now) {
  ctx.save();
  ctx.fillStyle = "#f4f3f1";
  ctx.fillRect(0, 0, stage.w, stage.h);

  drawPalette();

  // 置き場と入力エリアの境目
  ctx.strokeStyle = "#e0dedb";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, paletteBottom + 0.5);
  ctx.lineTo(stage.w, paletteBottom + 0.5);
  ctx.stroke();

  for (const l of letters) drawLetter(l, now);
  for (const p of Object.values(players)) drawCursor(p);

  ctx.restore();
}

function setFont(size) {
  ctx.font = `${CONFIG.fontWeight} ${size}px ${CONFIG.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
}

/** 墨の中心が (x, y) に来るように描く */
function drawGlyph(ch, x, y, size) {
  const o = glyphOffset[ch] || { x: 0, y: 0 };
  ctx.fillText(ch, x - o.x * size, y - o.y * size);
}

function drawPalette() {
  const size = CONFIG.paletteLetterSize * paletteFit;
  setFont(size);
  ctx.fillStyle = "#2c2a28";
  for (const c of cells) {
    drawGlyph(c.ch, c.x, c.y, size);
  }
}

function drawLetter(l, now) {
  let x = l.x;
  let y = l.y;

  // 一人で重い文字を掴んでいるあいだ、わずかに震える。
  // 「掴めてはいるが動かせない」と分かる程度に留める（要件書 13章）。
  if (l.heavy && l.holders.size === 1) {
    const t = (now / 1000) * CONFIG.heavy.tremorHz * Math.PI * 2;
    x += Math.sin(t + l.phase) * CONFIG.heavy.tremorAmp;
    y += Math.cos(t * 1.3 + l.phase) * CONFIG.heavy.tremorAmp * 0.7;
  }

  setFont(l.size);
  ctx.fillStyle = "#141210";
  drawGlyph(l.ch, x, y, l.size);
}

function drawCursor(p) {
  const r = p.down ? 10 : 13;

  ctx.strokeStyle = p.color;
  ctx.lineWidth = p.down ? 3 : 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();

  if (p.down) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = p.color;
  ctx.font = `600 12px "Hiragino Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(p.label, p.x, p.y - r - 7);
}

// ============================================================
// ループ
// ============================================================

function frame(now) {
  stepDevKeys();
  update(now);
  draw(now);
  if (showDebug) renderDebug();
  requestAnimationFrame(frame);
}

// ============================================================
// 画面まわりの表示
// ============================================================

const $setup = document.getElementById("setup");
const $debug = document.getElementById("debug");

function updateSetupPanel() {
  const rows = $setup.querySelector(".rows");
  const host = location.host;

  rows.innerHTML = ["p1", "p2"]
    .map((id) => {
      const p = players[id];
      const on = p.connected;
      return (
        `<div class="who"><span class="dot ${on ? "on" : ""}"></span>` +
        `<span style="color:${p.color}">${p.label}</span></div>` +
        `<div class="url ${on ? "on" : ""}">http://${host}/c?p=${id.slice(1)}</div>`
      );
    })
    .join("");

  $setup.classList.toggle(
    "done",
    players.p1.connected && players.p2.connected
  );
}

function renderDebug() {
  const held = letters.filter((l) => l.holders.size > 0);
  const text = readText().replace(/\n/g, " / ") || "（まだ何もない）";
  const heavyCount = Object.values(weights).filter((w) => w >= threshold).length;

  $debug.innerHTML =
    `<b>threshold</b> ${threshold.toFixed(2)}  ` +
    `(二人がかり ${heavyCount}/${Object.keys(weights).length}文字)   [ ] で増減\n` +
    `<b>書体</b> ${CONFIG.fontFamily.split(",")[0]} / weight ${CONFIG.fontWeight}\n` +
    `<b>session</b> ${sessionId ?? "-"}   n=新しいセッション  c=入力を消す\n` +
    `<b>接続</b> P1 ${players.p1.connected ? "○" : "×"}  P2 ${players.p2.connected ? "○" : "×"}` +
    `   server ${net.connected ? "○" : "×"}\n` +
    `<b>開発</b> 1=マウスでP1 ${dev.mouseP1 ? "ON" : "off"}` +
    `  2=矢印キーでP2 ${dev.keyP2 ? "ON" : "off"}\n` +
    `<b>置いた文字</b> ${letters.length}個  掴み中 ${held.length}個\n` +
    `<b>読み</b> ${text}`;
}

// ============================================================
// キー操作（操作者用）
// ============================================================

window.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "[":
      setThreshold(threshold - 0.05);
      break;
    case "]":
      setThreshold(threshold + 0.05);
      break;
    case "d":
      showDebug = !showDebug;
      $debug.hidden = !showDebug;
      break;
    case "c":
      clearInput();
      break;
    case "n":
      net.send({ t: "newSession" });
      letters = [];
      break;
    case "1":
      dev.mouseP1 = !dev.mouseP1;
      break;
    case "2":
      dev.keyP2 = !dev.keyP2;
      break;
  }
});

function setThreshold(v) {
  threshold = Math.max(0, Math.min(1, Number(v.toFixed(2))));
  // すでに場に出ている文字にも即座に反映する
  for (const l of letters) l.heavy = l.weight >= threshold;
  log({ type: "threshold_change", value: threshold });
}

function clearInput() {
  const text = readText();
  letters = [];
  for (const p of Object.values(players)) p.holding = null;
  log({ type: "clear", text });
}

// ============================================================
// 開発モード
// ------------------------------------------------------------
// 一人で動きを確かめるための仮の入力。展示では使わない。
// 1 キーでマウスが P1 に、2 キーで矢印キーが P2 になる。
// ============================================================

const devKeys = new Set();

window.addEventListener("keydown", (e) => {
  if (dev.keyP2 && e.key.startsWith("Arrow")) e.preventDefault();
  devKeys.add(e.key);
});
window.addEventListener("keyup", (e) => devKeys.delete(e.key));

function stepDevKeys() {
  if (!dev.keyP2) return;
  const p = players.p2;
  const speed = devKeys.has("Shift") ? 14 : 7;
  let dx = 0;
  let dy = 0;
  if (devKeys.has("ArrowLeft")) dx -= speed;
  if (devKeys.has("ArrowRight")) dx += speed;
  if (devKeys.has("ArrowUp")) dy -= speed;
  if (devKeys.has("ArrowDown")) dy += speed;
  const down = devKeys.has("Enter");
  if (dx || dy || down !== p.down) setPointer("p2", p.x + dx, p.y + dy, down);
}

canvas.addEventListener("pointermove", (e) => {
  if (!dev.mouseP1) return;
  const s = stage.h / window.innerHeight;
  setPointer("p1", e.clientX * s, e.clientY * s, players.p1.down);
});
canvas.addEventListener("pointerdown", (e) => {
  if (!dev.mouseP1) return;
  const s = stage.h / window.innerHeight;
  setPointer("p1", e.clientX * s, e.clientY * s, true);
});
window.addEventListener("pointerup", () => {
  if (!dev.mouseP1) return;
  setPointer("p1", players.p1.x, players.p1.y, false);
});

// ============================================================
// 調整用の窓口
// ------------------------------------------------------------
// ブラウザのコンソールから中身を覗いたり、値をいじったりするため。
// テスト中に threshold の当たりをつけたいときなどに使う。
//   mojiHakobi.threshold = 0.35
//   mojiHakobi.readText()
// ============================================================

window.mojiHakobi = {
  get letters() {
    return letters;
  },
  get cells() {
    return cells;
  },
  get stage() {
    return stage;
  },
  get weights() {
    return weights;
  },
  players,
  readText,
  clearInput,
  /**
   * カーソルを直接動かす。コントローラから届く座標と同じ入り口。
   * 決まった手順を繰り返し試したいとき（動作確認や記録用の再現）に使う。
   *   mojiHakobi.setPointer('p1', 458, 189, true)
   */
  setPointer,
  /**
   * 端末が落ちた状況を作る。
   *   mojiHakobi.setConnected('p2', false)
   * 掴んだままの切断で文字が取り残されないかを確かめるのに使う。
   */
  setConnected,
  get threshold() {
    return threshold;
  },
  set threshold(v) {
    setThreshold(v);
  },
};

// ============================================================
// 起動
// ============================================================

window.addEventListener("resize", layout);

(async function boot() {
  // 書体が使えるようになってから墨の量・位置を測る
  try {
    await document.fonts.load(
      `${CONFIG.fontWeight} ${CONFIG.letterSize}px ${CONFIG.fontFamily}`,
      ALL_CHARS.join("")
    );
    await document.fonts.ready;
  } catch {
    /* 読み込みに失敗しても描画自体はできる */
  }

  const res = await fetch("/data/weights.json");
  if (!res.ok) {
    document.body.innerHTML =
      '<p style="padding:40px;font:14px/1.8 sans-serif">' +
      "data/weights.json がない。<br>" +
      '<a href="/tools/measure-weights.html">tools/measure-weights.html</a>' +
      " で重さを計測して保存してから開き直すこと。</p>";
    return;
  }
  const data = await res.json();
  weights = data.weights;

  if (data.font !== CONFIG.fontFamily) {
    console.warn(
      `[文字運び] weights.json は ${data.font} で計測されている。` +
        `いまの表示書体 ${CONFIG.fontFamily} と違うので、` +
        `tools/measure-weights.html で計測しなおすこと。`
    );
  }

  measureGlyphOffsets();
  layout();
  updateSetupPanel();
  requestAnimationFrame(frame);
})();
