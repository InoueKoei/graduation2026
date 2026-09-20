// データ源。どれも同じ形のイベントを onEvent に流すので、あとから差し替えられる。
//   {t:"step", foot:"L"|"R", ...}  接地
//   {t:"pose", foot, pitch, roll, yaw, state, x, y, hz}  ライブ姿勢
//
// Stage 1（USB シリアル）と Stage 2（SoftAP + WebSocket）の両方に対応させてある。
// 無線ができる前でも Web Serial で検証できるようにしておくため。

// 1行1JSON を組み立てる共通のバッファ
class LineBuffer {
  constructor(onLine) { this.buf = ''; this.onLine = onLine; }
  push(text) {
    this.buf += text;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (line) this.onLine(line);
    }
    if (this.buf.length > 8192) this.buf = '';   // 化けた場合の保険
  }
}

function parseLine(line, onEvent) {
  if (line[0] !== '{') return;
  try { onEvent(JSON.parse(line)); } catch (_) { /* 途中で切れた行は捨てる */ }
}

// --- Web Serial（Chrome / Edge のみ）------------------------------------
// 「左足用」「右足用」とボタンを分けない。足の識別はデータ側が持っている
// （どのイベントにも "foot":"L"/"R" が入っている）ので、押し間違えても表示がずれない。
// ポートを足していくだけの作りにしてある。
class SerialPool {
  constructor(onEvent, onState) {
    this.onEvent = onEvent; this.onState = onState;
    this.ports = [];   // {port, writer, alive}
  }
  static get supported() { return 'serial' in navigator; }

  get count() { return this.ports.filter(p => p.alive).length; }

  async add() {
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      const entry = { port, writer: port.writable.getWriter(), alive: true };
      this.ports.push(entry);
      this.onState('USB', 'connected', `${this.count} 台`);
      this._read(entry);
    } catch (e) {
      // ユーザーがキャンセルした場合もここに来る
      if (e.name !== 'NotFoundError') this.onState('USB', 'failed', e.message);
    }
  }

  // 全ポートへ同じ指示を流す。「構え」を両足に同時に効かせるため。
  async send(obj) {
    const data = new TextEncoder().encode(JSON.stringify(obj) + '\n');
    for (const e of this.ports) {
      if (!e.alive) continue;
      try { await e.writer.write(data); } catch (_) {}
    }
  }

  async closeAll() {
    for (const e of this.ports) {
      e.alive = false;
      try { e.writer.releaseLock(); } catch (_) {}
      try { await e.port.close(); } catch (_) {}
    }
    this.ports = [];
    this.onState('USB', 'closed');
  }

  async _read(entry) {
    const dec = new TextDecoderStream();
    entry.port.readable.pipeTo(dec.writable).catch(() => {});
    const reader = dec.readable.getReader();
    const lb = new LineBuffer(l => parseLine(l, this.onEvent));
    try {
      while (entry.alive) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) lb.push(value);
      }
    } catch (_) {
    } finally {
      try { reader.releaseLock(); } catch (_) {}
      entry.alive = false;
      this.onState('USB', this.count ? 'connected' : 'closed', this.count ? `${this.count} 台` : undefined);
    }
  }
}

// --- WebSocket（Stage 2：CoreS3 の SoftAP に繋いでから）-----------------
class WsSource {
  constructor(onEvent, onState) { this.onEvent = onEvent; this.onState = onState; this.ws = null; }

  connect(url) {
    if (this.ws) { this.disconnect(); return; }
    this.onState('WS', 'connecting');
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.onState('WS', 'failed', e.message); return;
    }
    this.ws.onopen  = () => this.onState('WS', 'connected');
    this.ws.onclose = () => { this.ws = null; this.onState('WS', 'closed'); };
    this.ws.onerror = () => this.onState('WS', 'failed', '繋がりません');
    const lb = new LineBuffer(l => parseLine(l, this.onEvent));
    this.ws.onmessage = e => {
      if (typeof e.data === 'string') {
        // 1メッセージ1JSON でも、改行区切りでまとめて来ても両方いけるように
        e.data.trim().startsWith('{') && !e.data.includes('\n')
          ? parseLine(e.data.trim(), this.onEvent)
          : lb.push(e.data);
      }
    };
  }

  disconnect() { try { this.ws?.close(); } catch (_) {} this.ws = null; }
}

// --- 記録ファイルの再生 -------------------------------------------------
class FileSource {
  constructor(onEvent, onState) { this.onEvent = onEvent; this.onState = onState; this.timer = null; }

  async play(file) {
    this.stop();
    const text = await file.text();
    let events = [];
    try {
      const j = JSON.parse(text);
      events = j.events?.length ? j.events
             : (j.contacts || []).map(c => ({ ...c, t: 'step', t_us: c.t * 1e6 }));
    } catch (_) {
      // JSON Lines（シリアルのログをそのまま貼った場合）
      for (const line of text.split('\n')) {
        const s = line.trim();
        if (s.startsWith('{')) { try { events.push(JSON.parse(s)); } catch (_) {} }
      }
    }
    if (!events.length) { this.onState('FILE', 'failed', 'イベントが見つかりません'); return; }

    this.onState('FILE', 'connected', `${events.length} 件`);
    const t0 = events[0].t_us ?? 0;
    let i = 0;
    const start = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      while (i < events.length && ((events[i].t_us ?? 0) - t0) / 1e6 <= elapsed) {
        this.onEvent(events[i++]);
      }
      if (i < events.length) this.timer = requestAnimationFrame(tick);
      else this.onState('FILE', 'closed');
    };
    this.timer = requestAnimationFrame(tick);
  }

  stop() { if (this.timer) cancelAnimationFrame(this.timer); this.timer = null; }
}

// --- デモ（実機なしで見た目を確かめる用）-------------------------------
// 四角と丸を歩いたことにして接地イベントを作る。MVP の合否がこの2つの形なので、
// ビューア側だけ先に確かめられるようにしてある。
class DemoSource {
  constructor(onEvent, onState) { this.onEvent = onEvent; this.onState = onState; this.timer = null; }

  start(shape = 'square') {
    this.stop();
    this.onState('DEMO', 'connected', shape === 'square' ? '四角' : '丸');

    const STEP = 0.62;       // 歩幅 m
    const HALF_W = 0.11;     // 左右の開き（片側）m
    const path = shape === 'square' ? this._square(3.0) : this._circle(1.6);

    let dist = 0, n = 0, foot = 'L';
    const t0 = performance.now();
    // 実機は各足が「自分の原点 (0,0)」から推測航法するので、左右の物理的な間隔も、
    // 踏み出しの前後差も出力には出てこない（ビューアが構えの仮定として補う）。
    // デモもそれに合わせて、足ごとに最初の位置を引いて 0 から始める。
    const origin = {};

    const emit = () => {
      const total = path.length_;
      dist += STEP;
      if (dist > total) { this.stop(); return; }
      const { x, y, heading } = path.at(dist);
      // 進行方向に対して直角へ、左右に振り分ける
      const s = foot === 'L' ? 1 : -1;
      const px = x + Math.cos(heading + Math.PI / 2) * HALF_W * s;
      const py = y + Math.sin(heading + Math.PI / 2) * HALF_W * s;
      const t_us = (performance.now() - t0) * 1000;

      if (!origin[foot]) origin[foot] = { x: px, y: py };
      const ex = px - origin[foot].x, ey = py - origin[foot].y;

      this.onEvent({
        t: 'step', foot, seq: ++n, t_us,
        dx: STEP, dy: 0, dz: 0, x: ex, y: ey,
        yaw: heading, pitch_hs: -0.2,
        stance_ms: 600 + Math.round(Math.random() * 60),
        swing_ms: 380 + Math.round(Math.random() * 40),
        peak_a: 3.4 + Math.random(), peak_w: 480 + Math.random() * 80,
      });
      this.onEvent({
        t: 'pose', foot, t_us, pitch: -0.2, roll: 0, yaw: heading,
        state: 'stance', x: ex, y: ey, hz: 200,
      });
      foot = foot === 'L' ? 'R' : 'L';
    };

    this.timer = setInterval(emit, 420);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.onState('DEMO', 'closed'); }

  _square(side) {
    const per = side * 4;
    return {
      length_: per,
      at(d) {
        const s = d % per, leg = Math.floor(s / side), u = s % side;
        const corners = [[0,0],[side,0],[side,side],[0,side]];
        const dirs = [0, Math.PI/2, Math.PI, -Math.PI/2];
        const [cx, cy] = corners[leg], h = dirs[leg];
        return { x: cx + Math.cos(h) * u, y: cy + Math.sin(h) * u, heading: h };
      },
    };
  }

  _circle(r) {
    const per = 2 * Math.PI * r;
    return {
      length_: per,
      at(d) {
        const a = (d % per) / r;
        return { x: r * Math.cos(a - Math.PI/2), y: r + r * Math.sin(a - Math.PI/2), heading: a };
      },
    };
  }
}
