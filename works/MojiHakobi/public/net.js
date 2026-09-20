// ============================================================
// WebSocket の接続まわり
// ------------------------------------------------------------
// メイン画面とコントローラの両方から使う。
// 展示中は iPad がスリープしたり Wi-Fi が一瞬切れたりするので、
// 切れたら黙って繋ぎ直す。
//
// 繋ぎ直しで気をつけていること:
//
//   ・同じ役割で2本繋がない。
//     再接続待ちと画面復帰が重なると二重に繋いでしまい、
//     サーバーが古いほうを切る → それが繋ぎ直す → また切られる、
//     という取り合いが延々続いて、いつまでも繋がらなくなる。
//
//   ・古いソケットの後始末で、新しいソケットを巻き込まない。
//     イベントは登録したソケット自身と照合してから処理する。
//
//   ・別の端末に役割を奪われたら、繋ぎ直さずに諦める。
//     ここで繋ぎ直すと、2台で役割の取り合いになる。
// ============================================================

/**
 * @param {'main'|'p1'|'p2'} role
 * @param {{
 *   onMessage?: (msg:object)=>void,
 *   onStatus?: (connected:boolean)=>void,
 *   onReplaced?: ()=>void,
 * }} handlers
 */
export function connect(role, { onMessage, onStatus, onReplaced } = {}) {
  /** いま有効なソケット。これ以外から来たイベントは無視する。 */
  let ws = null;
  let connected = false;
  let retryDelay = 400;
  let retryTimer = null;
  let disposed = false;
  let replaced = false;

  function scheduleRetry() {
    if (disposed || retryTimer) return; // 二重に予約しない
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, retryDelay);
    // 繋がらないまま待ち続けるときは、間隔を少しずつ伸ばす
    retryDelay = Math.min(retryDelay * 1.6, 4000);
  }

  function open() {
    if (disposed) return;

    // すでに繋ぎに行っている、または繋がっているなら何もしない。
    // 二重接続を防いでいるのはここ。
    if (
      ws &&
      (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const sock = new WebSocket(`${proto}//${location.host}/ws?role=${role}`);
    ws = sock;

    sock.addEventListener("open", () => {
      if (sock !== ws) return;
      connected = true;
      retryDelay = 400;
      onStatus?.(true);
    });

    sock.addEventListener("message", (ev) => {
      if (sock !== ws) return;

      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return; // 壊れたメッセージは捨てる
      }

      // 同じ役割で別の端末が繋いだ。取り合いになるので、こちらは引き下がる。
      if (msg.t === "replaced") {
        replaced = true;
        disposed = true;
        connected = false;
        onReplaced?.();
        onStatus?.(false);
        return;
      }

      onMessage?.(msg);
    });

    sock.addEventListener("close", () => {
      // 古いソケットの close が、新しいソケットの参照を消さないようにする
      if (sock !== ws) return;
      ws = null;
      if (connected) {
        connected = false;
        onStatus?.(false);
      }
      scheduleRetry();
    });

    sock.addEventListener("error", () => {
      if (sock !== ws) return;
      sock.close(); // 後始末は close 側でまとめてやる
    });
  }

  open();

  // iPad などは画面を消すと接続が黙って切れる。戻ってきたら繋ぎ直す。
  // open() 自身が二重接続を防ぐので、ここでは素直に呼んでよい。
  const wakeUp = () => {
    if (document.visibilityState !== "visible") return;
    retryDelay = 400;
    open();
  };

  document.addEventListener("visibilitychange", wakeUp);
  // iOS は戻ってきたページを復元することがあり、そのとき接続は死んでいる
  window.addEventListener("pageshow", wakeUp);
  window.addEventListener("online", () => {
    retryDelay = 400;
    open();
  });

  return {
    get connected() {
      return connected;
    },
    /** 別の端末に役割を奪われたか */
    get replaced() {
      return replaced;
    },
    send(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    },
    dispose() {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    },
  };
}
