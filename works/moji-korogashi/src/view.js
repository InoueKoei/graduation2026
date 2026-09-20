// 盤面の見え方。キャンバスを M5Stack の画面と同じ 1 枚の板とみなして、傾けたぶんだけ倒す。
//
// ★ なぜ要るか
//   玉だけが動いて盤が固定だと、「なぜ転がっているのか」が画面から読めない。
//   板ごと傾けば、玉が転がるのは坂を下っているからだと一目で分かる。
//
// ★ 物理には触らない
//   玉は板の上（2D の盤面座標）を転がったままで、計算は今までどおり。
//   重力は加速度ベクトルを板の面に射影したもの＝そのまま (ax, ay) なので、
//   見た目の傾きと玉にかかる力が同じ数から出ることになり、勝手に一致する。
//
// ★ 静止時も倒しておく
//   傾き 0 のときに板を正面から見た絵にすると、板ではなく壁に見える。
//   実際には板は地面に置かれていて、それを斜め上から眺めている。
//   そこで「カメラの俯角」を常にかけておき、そこからの差分として傾きが乗るようにする。
//
// ★ 全部ホモグラフィ 1 枚に畳む
//   板は平面なので、傾き → 俯角 → 透視 → 玉に寄る、を全部かけても
//   結局 (x, y, 1) についての 3x3 で書ける。逆行列を取れば画面 → 板にぴったり戻せるので、
//   倒して寄せた状態でも、ドラッグと「字の中をクリックして玉を置く」が正しく当たる。

/**
 * @param {object} o
 * @param {number} o.w キャンバスの幅(px)
 * @param {number} o.h キャンバスの高さ(px)
 * @param {{x:number,y:number}} o.tilt 傾き(g)。符号は config の invert 系を通したあとの値
 * @param {object} o.cfg CONFIG.view
 * @param {{x:number,y:number,zoom:number}|null} o.focus 寄る先（盤面座標）と倍率。null なら寄らない
 */
export function makeView({ w, h, tilt, cfg, focus }) {
  const cx = w / 2;
  const cy = h / 2;
  if (!cfg.tilt3d) return identityView();

  const tx = tilt?.x ?? 0;
  const ty = tilt?.y ?? 0;
  const mag = Math.hypot(tx, ty);

  // --- 1. 板そのものの傾き ---
  // ★ X 軸まわり・Y 軸まわりの 2 回転を合成すると、捻れが混ざって
  //   「板が倒れた」ではなく「板がねじれた」ように見える（回転は可換でないため）。
  //   板の傾きは本来 1 回の回転で表せる。下り方向 t に対して垂直な軸
  //   a = (-ty, tx)/|t| まわりに θ = asin(|t|) だけ回す。これなら捻れが出ない。
  let xx = 1; let xy = 0;
  let yx = 0; let yy = 1;
  let zx = 0; let zy = 0;

  if (mag >= 1e-4) {
    const theta = Math.min(Math.asin(Math.min(mag, 1)), cfg.maxAngle);
    const ax = -ty / mag;
    const ay = tx / mag;
    const co = Math.cos(theta);
    const si = Math.sin(theta);
    const k = 1 - co;
    xx = co + ax * ax * k;
    xy = ax * ay * k;
    yx = ax * ay * k;
    yy = co + ay * ay * k;
    zx = -ay * si;
    zy = ax * si;
  }

  // --- 2. カメラの俯角 ---
  // 板は地面に置かれていて、それを斜め上から見ている。X 軸まわりに固定で回す。
  const cf = Math.cos(cfg.baseAngle);
  const sf = Math.sin(cfg.baseAngle);
  const f = cfg.focal;

  // 傾き → 俯角 → 透視 を畳んだもの（キャンバス中心を原点とした座標で）
  let m = [
    f * xx, f * xy, 0,
    f * (yx * cf - zx * sf), f * (yy * cf - zy * sf), 0,
    -(yx * sf + zx * cf), -(yy * sf + zy * cf), f,
  ];

  // --- 3. はみ出しを抑える ---
  // 倒すと板が画面から出る。四隅を見て収まるぶんだけ一様に縮める。
  const fit = fitScale(m, w, h);
  if (fit < 1) m = [m[0] * fit, m[1] * fit, m[2] * fit, m[3] * fit, m[4] * fit, m[5] * fit, m[6], m[7], m[8]];

  // 原点をキャンバス中心に戻して、盤面座標 → 画面座標の 1 枚にする
  let H = mul(translate(cx, cy), mul(m, translate(-cx, -cy)));

  // --- 4. 玉に寄る ---
  // 寄せは画面側のアフィン変換。ホモグラフィの左から掛けるだけなので、
  // 透視の分母（3 行目）は変わらず、逆行列もそのまま取れる。
  const zoom = focus?.zoom ?? 1;
  if (focus && Math.abs(zoom - 1) > 1e-4) {
    const [fxs, fys] = apply(H, focus.x, focus.y);
    H = mul(mul(translate(cx, cy), scale(zoom)), mul(translate(-fxs, -fys), H));
  }

  const inv = invert3(H);

  return {
    active: true,
    zoom,
    project(x, y) { return apply(H, x, y); },
    unproject(sx, sy) { return inv ? apply(inv, sx, sy) : [sx, sy]; },
    /**
     * その場所での見かけの伸び。玉の半径に掛ける。
     * 俯角・はみ出し補正・寄せが全部掛かったあとの値が要るので、
     * 式で書き下さずに 1px 動かして測る（合成を間違えても影響しない）。
     */
    scaleAt(x, y) {
      const p0 = apply(H, x, y);
      const px = apply(H, x + 1, y);
      const py = apply(H, x, y + 1);
      const sx = Math.hypot(px[0] - p0[0], px[1] - p0[1]);
      const sy = Math.hypot(py[0] - p0[0], py[1] - p0[1]);
      return (sx + sy) / 2;
    },
  };
}

function identityView() {
  return {
    active: false,
    zoom: 1,
    project: (x, y) => [x, y],
    unproject: (x, y) => [x, y],
    scaleAt: () => 1,
  };
}

// --- 3x3 のこまごま -------------------------------------------------------

function apply(m, x, y) {
  const u = m[0] * x + m[1] * y + m[2];
  const v = m[3] * x + m[4] * y + m[5];
  const w = m[6] * x + m[7] * y + m[8];
  const iw = w === 0 ? 0 : 1 / w;
  return [u * iw, v * iw];
}

function mul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

function translate(tx, ty) { return [1, 0, tx, 0, 1, ty, 0, 0, 1]; }
function scale(s) { return [s, 0, 0, 0, s, 0, 0, 0, 1]; }

/** 板の四隅を射影して、画面に収まる倍率を返す（1 以下）。中心原点の m に対して使う。 */
function fitScale(m, w, h) {
  const hw = w / 2;
  const hh = h / 2;
  let need = 1;
  for (const [px, py] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
    const wq = m[6] * px + m[7] * py + m[8];
    if (wq === 0) continue;
    const u = (m[0] * px + m[1] * py + m[2]) / wq;
    const v = (m[3] * px + m[4] * py + m[5]) / wq;
    need = Math.max(need, Math.abs(u) / hw, Math.abs(v) / hh);
  }
  return need > 1 ? 1 / need : 1;
}

/** 3x3 の逆行列（行優先）。特異なら null。 */
function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const id = 1 / det;
  return [
    A * id, (c * h - b * i) * id, (b * f - c * e) * id,
    B * id, (a * i - c * g) * id, (c * d - a * f) * id,
    C * id, (b * g - a * h) * id, (a * e - b * d) * id,
  ];
}
