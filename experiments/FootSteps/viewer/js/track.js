// 接地イベントを溜めて、線と書き出しを作る。
//
// 「線」は左右の接地点の中点を繋いだポリライン。
// 片足しか繋がっていないときは、その足の接地点をそのまま繋ぐ（USB 1本での検証用）。

// 構えたときの左右の開き（片側）m。
// 装置はどちらも原点を (0,0) に打つので、そのまま描くと左右が同じ点に重なる。
// ヨー原点を揃えた直後は進行方向が +x なので、左が +y 側になる。
const FOOT_OFFSET = 0.10;
const offsetFor = foot => (foot === 'L' ? FOOT_OFFSET : -FOOT_OFFSET);

class Track {
  constructor() { this.clear(); }

  clear() {
    this.contacts = [];              // {foot,t,x,y,yaw,stance_ms,swing_ms,peak_a,peak_w,pitch_hs,seq}
    this.pose = { L: null, R: null };
    this.recording = false;
    this.recorded = [];              // 記録中に受けた生イベント
    this._lineCache = null;
  }

  addStep(ev) {
    this.contacts.push({
      foot: ev.foot, t: ev.t_us / 1e6,
      x: ev.x, y: ev.y + offsetFor(ev.foot), yaw: ev.yaw,
      dx: ev.dx, dy: ev.dy,
      stance_ms: ev.stance_ms, swing_ms: ev.swing_ms,
      peak_a: ev.peak_a, peak_w: ev.peak_w, pitch_hs: ev.pitch_hs,
      seq: ev.seq,
    });
    this._lineCache = null;
    if (this.recording) this.recorded.push(ev);
  }

  addPose(ev) {
    this.pose[ev.foot] = { ...ev, y: ev.y + offsetFor(ev.foot) };
    if (this.recording) this.recorded.push(ev);
  }

  // 原点リセット。以降の座標は装置側でも 0 に戻るので、こちらも溜めた分を捨てる。
  // foot を渡すとその足だけ（本体のボタンが片方だけ押された場合）。
  resetOrigin(foot) {
    this.contacts = foot ? this.contacts.filter(c => c.foot !== foot) : [];
    if (!foot) this.pose = { L: null, R: null };
    this._lineCache = null;
  }

  get feetPresent() {
    const s = new Set(this.contacts.map(c => c.foot));
    return [...s];
  }

  // --- 線 ---------------------------------------------------------------
  line() {
    if (this._lineCache) return this._lineCache;
    const cs = this.contacts;
    const pts = [];

    if (this.feetPresent.length >= 2) {
      // 両足あり：接地するたび、反対の足の直近の接地点との中点を打つ
      const last = {};
      for (const c of cs) {
        const other = c.foot === 'L' ? 'R' : 'L';
        const o = last[other];
        if (o) pts.push({ x: (c.x + o.x) / 2, y: (c.y + o.y) / 2, t: c.t });
        last[c.foot] = c;
      }
    } else {
      for (const c of cs) pts.push({ x: c.x, y: c.y, t: c.t });
    }
    this._lineCache = pts;
    return pts;
  }

  lineLength() {
    const p = this.line();
    let d = 0;
    for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i-1].x, p[i].y - p[i-1].y);
    return d;
  }

  bounds() {
    const all = [...this.contacts, ...this.line()];
    if (!all.length) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of all) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { x0, x1, y0, y1 };
  }

  // --- 書き出し ---------------------------------------------------------
  toJSON() {
    return JSON.stringify({
      exported_at: new Date().toISOString(),
      contacts: this.contacts,
      line: this.line(),
      events: this.recorded,
    }, null, 1);
  }

  toCSV() {
    const cols = ['foot','seq','t','x','y','dx','dy','yaw','pitch_hs','stance_ms','swing_ms','peak_a','peak_w'];
    const rows = [cols.join(',')];
    for (const c of this.contacts) {
      rows.push(cols.map(k => (c[k] === undefined ? '' : c[k])).join(','));
    }
    return rows.join('\n');
  }

  // 線だけを SVG にする。単位はミリメートル（1m = 1000）。
  // opentype.js 側のパイプラインにそのまま渡せるように、path 一本だけを吐く。
  toSVG() {
    const p = this.line();
    if (p.length < 2) return null;
    const M = 20;   // 余白 mm
    const b = this.bounds();
    const x0 = b.x0 * 1000 - M, y0 = -b.y1 * 1000 - M;
    const w  = (b.x1 - b.x0) * 1000 + M * 2;
    const h  = (b.y1 - b.y0) * 1000 + M * 2;
    const d = p.map((q, i) =>
      `${i ? 'L' : 'M'}${(q.x * 1000).toFixed(2)},${(-q.y * 1000).toFixed(2)}`).join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(1)}mm" height="${h.toFixed(1)}mm" viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}">
  <title>FootSteps — 歩いた軌跡</title>
  <path d="${d}" fill="none" stroke="#2b2a33" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
  }
}
