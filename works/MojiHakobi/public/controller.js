// ============================================================
// 文字運び ─ コントローラ（P1 / P2）
// ------------------------------------------------------------
// 手元の画面はメイン画面の縮小地図。触った場所がそのまま
// メイン画面上のカーソル位置になる（絶対マッピング）。
//
//   指を置く   → その場所を掴もうとする
//   ずらす     → 掴めていれば運ぶ
//   指を離す   → 落とす
//
// 掴むための別ボタンは置かない。「二人が同時に手を伸ばす」
// という動作そのものを「せーの」にしたいため。
//
// 手元の表示は抑えてある。重いかどうかは手元では分からないようにして、
// メイン画面の反応から気づいてもらう（config.js の showStuck）。
// ============================================================

import { CONFIG } from "/config.js";
import { connect } from "/net.js";

// --- どちらのプレイヤーか ---
const param = new URLSearchParams(location.search).get("p") || "1";
const role = param === "2" ? "p2" : "p1";
const style = CONFIG.players[role];

document.documentElement.style.setProperty("--accent", style.color);
document.getElementById("label").textContent = style.label;
document.title = `文字運び ─ ${style.label}`;

const canvas = document.getElementById("pad");
const ctx = canvas.getContext("2d");
const $status = document.getElementById("status");

// ============================================================
// 状態
// ============================================================

/** メイン画面の縦横比。届くまでは 16:9 と仮定しておく。 */
let aspect = 16 / 9;

/** メイン画面の置き場（薄く表示する分） */
let paletteCells = [];
let paletteRect = null;

/** 手元の画面に置いた「メイン画面の枠」 */
let pad = { x: 0, y: 0, w: 0, h: 0 };

/** 最後に触った位置（0..1）。指を離しても残す＝カーソルはそこに留まる。 */
let pos = { x: 0.5, y: 0.5 };
let down = false;
let pointerId = null;

/** メイン画面から返ってくる「掴んでいる状態」 */
let holdState = "none"; // none | carry | stuck

let mainConnected = false;

// ============================================================
// 通信
// ============================================================

const net = connect(role, {
  onMessage: (msg) => {
    if (msg.t === "stage") {
      aspect = msg.aspect || aspect;
      layout();
    } else if (msg.t === "palette") {
      paletteCells = msg.cells || [];
      paletteRect = msg.rect || null;
    } else if (msg.t === "hold") {
      holdState = msg.state;
    } else if (msg.t === "presence") {
      mainConnected = msg.main;
      updateStatus();
    }
  },
  onStatus: (connected) => {
    // 繋がった時点で今の位置を知らせる。
    // 送らないと、最初に指を置くまでメイン画面にカーソルが現れない。
    if (connected) sendNow();
    updateStatus();
  },
  onReplaced: () => updateStatus(),
});

function updateStatus() {
  const bad = !net.connected;
  document.body.classList.toggle("offline", bad);

  if (net.replaced) {
    // 同じ URL を別の端末やブラウザでも開いている状態。
    // 黙って繋ぎ直すと取り合いになるので、ここで止めて理由を出す。
    $status.innerHTML =
      `別の端末が <b>${style.label}</b> になった。<br>` +
      `この画面はもう動かない。ほかの端末を閉じてから、ここを再読み込みする。`;
    $status.classList.remove("ready");
  } else if (!net.connected) {
    $status.innerHTML =
      "サーバーにつながっていない。<br>" +
      "メイン画面と同じ Wi-Fi につながっているか確認する。";
    $status.classList.remove("ready");
  } else if (!mainConnected) {
    $status.textContent = "メイン画面を待っています";
    $status.classList.remove("ready");
  } else {
    $status.textContent = "画面を見ながら、文字に指を置く";
    $status.classList.add("ready");
  }
}

// ============================================================
// 送信
// ------------------------------------------------------------
// 動いているあいだは一定の間隔で送り、
// 指を置いた／離した瞬間だけは取りこぼさないよう即座に送る。
// ============================================================

let lastSent = 0;
let dirty = false;

function sendNow() {
  lastSent = performance.now();
  dirty = false;
  net.send({ t: "ptr", x: pos.x, y: pos.y, down, sentAt: Date.now() });
}

function sendThrottled() {
  dirty = true;
  const now = performance.now();
  if (now - lastSent >= 1000 / CONFIG.controller.sendHz) sendNow();
}

// ============================================================
// 入力
// ============================================================

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * 手元の座標 → メイン画面の 0..1 の位置。
 * 枠の外を触ったときは、いちばん近い枠の縁として扱う。
 */
function toNorm(clientX, clientY) {
  return {
    x: clamp01((clientX - pad.x) / pad.w),
    y: clamp01((clientY - pad.y) / pad.h),
  };
}

canvas.addEventListener("pointerdown", (e) => {
  // 二本目以降の指は無視する。カーソルは一人につき一つ。
  if (pointerId !== null) return;
  pointerId = e.pointerId;
  // 枠の外まで指がはみ出しても追い続けられるようにする。
  // 取れなくても操作自体は続けられるので、失敗は無視してよい。
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* 掴み続けられなくなるだけ */
  }

  pos = toNorm(e.clientX, e.clientY);
  down = true;
  sendNow();
  e.preventDefault();
});

canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== pointerId) {
    // マウスで操作している場合は、押していなくてもカーソルを動かせるようにする
    if (pointerId === null && e.pointerType === "mouse") {
      pos = toNorm(e.clientX, e.clientY);
      sendThrottled();
    }
    return;
  }
  pos = toNorm(e.clientX, e.clientY);
  sendThrottled();
  e.preventDefault();
});

function endPointer(e) {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  down = false;
  holdState = "none";
  sendNow();
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

// 端末が裏に回ったら、掴みっぱなしにならないよう手を離す
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" && down) {
    pointerId = null;
    down = false;
    holdState = "none";
    sendNow();
  }
});

// 送りこぼしを拾う
setInterval(() => {
  if (dirty) sendNow();
}, 1000 / CONFIG.controller.sendHz);

// ============================================================
// 描画
// ============================================================

function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // メイン画面と同じ縦横比の枠を、手元の画面いっぱいに収める。
  // 縦横比をそろえておかないと、指の動きとカーソルの動きがゆがむ。
  const margin = 14;
  const availW = w - margin * 2;
  const availH = h - margin * 2;
  let pw = availW;
  let ph = pw / aspect;
  if (ph > availH) {
    ph = availH;
    pw = ph * aspect;
  }
  pad = { x: (w - pw) / 2, y: (h - ph) / 2, w: pw, h: ph };
}

function draw() {
  // ctx は dpr 倍に拡大してあるので、消すのも CSS ピクセルで指定する
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // --- 枠 ---
  // 指を置いているあいだだけ濃くする。
  // 「掴めているが動かない」までは既定では出さない（config.js の showStuck）。
  const active =
    down && (CONFIG.controller.showStuck ? holdState !== "none" : true);

  ctx.strokeStyle = active ? style.color : "#d8d5d1";
  ctx.lineWidth = active ? 2.5 : 1;
  ctx.strokeRect(pad.x, pad.y, pad.w, pad.h);

  // --- 置き場と入力エリアの境目 ---
  if (paletteRect) {
    ctx.strokeStyle = "#e6e3e0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const y = pad.y + pad.h * paletteRect.y1;
    ctx.moveTo(pad.x, y);
    ctx.lineTo(pad.x + pad.w, y);
    ctx.stroke();
  }

  // --- 置き場の文字（薄く） ---
  // どこに何があるかの見当をつけるためだけのもの。
  // 手元をじっと見なくて済むよう、読めるぎりぎりまで薄くしてある。
  if (CONFIG.controller.showPalette && paletteCells.length) {
    const size = Math.max(pad.w * 0.026, 9);
    ctx.font = `${CONFIG.fontWeight} ${size}px ${CONFIG.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.26)";
    for (const c of paletteCells) {
      ctx.fillText(c.ch, pad.x + pad.w * c.x, pad.y + pad.h * c.y);
    }
  }

  // --- 自分のカーソル ---
  const cx = pad.x + pad.w * pos.x;
  const cy = pad.y + pad.h * pos.y;

  ctx.strokeStyle = style.color;
  ctx.lineWidth = down ? 3 : 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, down ? 13 : 16, 0, Math.PI * 2);
  ctx.stroke();

  if (down) {
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(draw);
}

// ============================================================
// 調整用の窓口（メイン画面と同じ趣旨）
// ============================================================

window.mojiHakobi = {
  role,
  get pad() {
    return pad;
  },
  get cells() {
    return paletteCells;
  },
  /** 手元の画面上で、その文字がどこにあるか */
  cellAt(ch) {
    const c = paletteCells.find((k) => k.ch === ch);
    return c && { x: pad.x + pad.w * c.x, y: pad.y + pad.h * c.y };
  },
};

// ============================================================
// 起動
// ============================================================

window.addEventListener("resize", layout);
window.addEventListener("orientationchange", () => setTimeout(layout, 120));

(async function boot() {
  try {
    await document.fonts.ready;
  } catch {
    /* 気にしない */
  }
  layout();
  updateStatus();
  requestAnimationFrame(draw);
  sendNow();
})();
