// 輪郭の点を質点にしたばね網。これが「ゴム」の中身。
//
// 節点ごとに rest（元の位置）/ pos（いまの位置）/ vel を持ち、毎ステップ 3 つの力を足す。
//
//   1. 形状記憶  kShape * (rest - pos)
//        離したときに元の字形へもどる主因。これが無いと戻らない。
//   2. 隣接ばね  輪郭に沿った隣どうし。自然長は元の間隔。
//        引きが周囲へ滑らかに伝わり、輪郭が破れたり食い込んだりしにくくなる。
//   3. 減衰      もどりの揺れを収める。弱いといつまでも揺れる。
//
// ★ つまみの影響範囲は「輪郭に沿った距離（弧長）」で決める。
//   画面上の 2D 距離で決めると、たとえば「あ」の縦画をつまんだときに、
//   すぐ隣を通っている横棒まで巻き込まれ、字の一部がごっそり動いてしまう。
//   ＝「つまむ」ではなく「ひきずる」感触になる。
//   輪郭に沿って測れば、つまんだ線だけが伸び、隣の線は動かない。
//
//   ただし弧長だけだとストロークの「片側」しか動かず、輪郭が自己交差して破れる。
//   そこで掴んだ点の【向かい側（同じ線の反対の縁）】も種として加え、
//   両側をまとめて動かす。こうして線そのものが伸びる＝ゴムになる。
//
// つまんでいる間、重みは【掴んだ瞬間に rest 基準で確定して固定する】。
// 毎フレーム計算し直すと掴む集合が指について移動してしまい、引きがぬるっと滑る。

export function createRubber(config) {
  let n = 0; // 節点の総数
  let restX, restY, posX, posY, velX, velY, fx, fy, weight, restLen, nodeRing;
  let ringStart = [];
  let ringCount = [];
  let ringSpacing = []; // リングごとの節点間隔（弧長の換算に使う）
  let strokeWidth = 0; // 字の平均的な線幅。向かい側を探す距離の基準

  // 掴みの状態
  let grabbing = false;
  let originX = 0; // 掴んだ瞬間のポインタ位置
  let originY = 0;
  let stretchX = 0; // 頭打ちを通したあとの引き量
  let stretchY = 0;

  // config の「字面に対する比」を px に直したもの。setScale() で更新する。
  const px = { grabArc: 0, grabTolerance: 0, maxStretch: 0 };

  /** 字面の大きさが決まったら呼ぶ。距離まわりの設定を px に直す。 */
  function setScale(glyphSize) {
    px.grabArc = config.grabArcEm * glyphSize;
    px.grabTolerance = config.grabToleranceEm * glyphSize;
    px.maxStretch = config.maxStretchEm * glyphSize;
  }

  /** 輪郭リング群を受け取って質点を組み直す。文字を差し替えるたびに呼ぶ。 */
  function setRings(rings) {
    n = rings.reduce((s, r) => s + r.length, 0);
    restX = new Float64Array(n);
    restY = new Float64Array(n);
    posX = new Float64Array(n);
    posY = new Float64Array(n);
    velX = new Float64Array(n);
    velY = new Float64Array(n);
    fx = new Float64Array(n);
    fy = new Float64Array(n);
    weight = new Float64Array(n);
    restLen = new Float64Array(n);
    nodeRing = new Int32Array(n);
    ringStart = [];
    ringCount = [];
    ringSpacing = [];

    let k = 0;
    for (let r = 0; r < rings.length; r++) {
      ringStart.push(k);
      ringCount.push(rings[r].length);
      for (const p of rings[r]) {
        restX[k] = posX[k] = p.x;
        restY[k] = posY[k] = p.y;
        nodeRing[k] = r;
        k++;
      }
    }

    // 隣（リング内で閉じた輪）との自然長と、リングごとの平均間隔
    let totalPerimeter = 0;
    let totalArea = 0;
    for (let r = 0; r < ringStart.length; r++) {
      const s = ringStart[r];
      const c = ringCount[r];
      let sum = 0;
      for (let i = 0; i < c; i++) {
        const a = s + i;
        const b = s + ((i + 1) % c);
        restLen[a] = Math.hypot(restX[b] - restX[a], restY[b] - restY[a]);
        sum += restLen[a];
      }
      ringSpacing.push(sum / c);
      totalPerimeter += sum;
      totalArea += signedArea(s, c);
    }

    // 平均的な線幅の見積り。
    // 幅 w・長さ L の線なら 面積 ≒ wL、周長 ≒ 2L なので 2*面積/周長 ≒ w。
    // 穴は逆回りなので符号付き面積の和が正味の面積になる。
    strokeWidth = totalPerimeter > 0 ? (2 * Math.abs(totalArea)) / totalPerimeter : 0;

    grabbing = false;
  }

  function signedArea(start, count) {
    let a = 0;
    for (let i = 0; i < count; i++) {
      const p = start + i;
      const q = start + ((i + 1) % count);
      a += restX[p] * restY[q] - restX[q] * restY[p];
    }
    return a / 2;
  }

  /** 同じリング内の 2 点の、輪郭に沿った距離 */
  function arcDist(i, j) {
    const r = nodeRing[i];
    const c = ringCount[r];
    const steps = Math.abs(i - j);
    return Math.min(steps, c - steps) * ringSpacing[r];
  }

  /**
   * いちばん近い節点を、画面に見えている位置（pos）で探す。
   * @returns {{index:number, dist:number}} 節点が無ければ index = -1
   */
  function nearest(x, y) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (posX[i] - x) ** 2 + (posY[i] - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { index: best, dist: best < 0 ? Infinity : Math.sqrt(bestD) };
  }

  /** そこを掴めるか（カーソルの出し分け用） */
  function canGrab(x, y) {
    return n > 0 && nearest(x, y).dist <= px.grabTolerance;
  }

  /**
   * 掴んだ点の「向かい側」＝同じ線の反対の縁を探す。
   * 輪郭に沿っては十分離れているのに、画面上では線幅ぶんしか離れていない点。
   * 線の丸い先端を向かい側と誤認しないよう、弧長で近すぎるものは除く。
   * @returns {number} 見つからなければ -1
   */
  function findOpposite(seed) {
    if (strokeWidth <= 0) return -1;
    const minArc = 1.2 * strokeWidth; // これより輪郭沿いに近ければ「同じ側」
    const maxCross = config.crossReach * strokeWidth; // 2D でこれ以上離れていれば別の線

    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (i === seed) continue;
      if (nodeRing[i] === nodeRing[seed] && arcDist(i, seed) < minArc) continue;
      const d = Math.hypot(restX[i] - restX[seed], restY[i] - restY[seed]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return bestD <= maxCross ? best : -1;
  }

  /**
   * 種の節点から輪郭に沿って重みを配る。
   * 落ち方は (1 - t^2)^grabFalloff。t=0 と t=1 の両端で傾きが 0 になり滑らか。
   */
  function spreadWeight(seed) {
    const r = nodeRing[seed];
    const s = ringStart[r];
    const c = ringCount[r];
    const sp = ringSpacing[r];
    if (sp <= 0) return;

    // リングの一部だけを動かす。小さなリング（カウンター＝字の穴）では
    // 同じ弧長でもリング全体を覆ってしまい、穴ごと引きずり出されて破れる。
    // そこでリング周長に対する割合でも頭打ちにする。
    //
    // ★ 打ち切った距離を、そのまま落ち方の分母にすること。
    //   分母を px.grabArc のままにすると、打ち切った端で重みが 0 に達しておらず
    //   段差が残る。そこが折れ目になって輪郭が交差する。
    const arcLimit = Math.min(px.grabArc, c * config.grabArcMaxRingFraction * sp);
    const maxSteps = Math.floor(arcLimit / sp);
    if (maxSteps < 1) return;

    for (let k = -maxSteps; k <= maxSteps; k++) {
      const i = s + ((((seed - s + k) % c) + c) % c);
      const t = Math.min(1, (Math.abs(k) * sp) / arcLimit);
      const w = (1 - t * t) ** config.grabFalloff;
      if (w > weight[i]) weight[i] = w;
    }
  }

  /**
   * 掴む。輪郭の近くでなければ何も掴まない。
   * @returns {boolean} 掴めたか
   */
  function grab(x, y) {
    if (n === 0) return false;

    const { index: seed, dist } = nearest(x, y);
    if (seed < 0 || dist > px.grabTolerance) return false;

    weight.fill(0);
    spreadWeight(seed);
    // 同じ線の向かい側も一緒に動かす。これが無いと片側だけ伸びて輪郭が破れる。
    const opposite = findOpposite(seed);
    if (opposite >= 0) spreadWeight(opposite);

    grabbing = true;
    originX = x;
    originY = y;
    stretchX = 0;
    stretchY = 0;
    return true;
  }

  /** 指を動かす。引き量は tanh で頭打ちにする（引くほど重く、無限には伸びない）。 */
  function drag(x, y) {
    if (!grabbing) return;
    const dx = x - originX;
    const dy = y - originY;
    const raw = Math.hypot(dx, dy);
    if (raw < 1e-6) {
      stretchX = 0;
      stretchY = 0;
      return;
    }
    const limited = px.maxStretch * Math.tanh(raw / px.maxStretch);
    stretchX = (dx / raw) * limited;
    stretchY = (dy / raw) * limited;
  }

  /** 離す。目標の上書きをやめるだけ。あとは形状記憶と減衰が戻す。 */
  function release() {
    grabbing = false;
  }

  function substep(h) {
    fx.fill(0);
    fy.fill(0);

    // 1. 形状記憶
    const kShape = config.kShape;
    for (let i = 0; i < n; i++) {
      fx[i] += kShape * (restX[i] - posX[i]);
      fy[i] += kShape * (restY[i] - posY[i]);
    }

    // 2. 隣接ばね（各辺を 1 回ずつ、作用・反作用で両端に加える）
    const kEdge = config.kEdge;
    for (let r = 0; r < ringStart.length; r++) {
      const s = ringStart[r];
      const c = ringCount[r];
      for (let i = 0; i < c; i++) {
        const a = s + i;
        const b = s + ((i + 1) % c);
        const dx = posX[b] - posX[a];
        const dy = posY[b] - posY[a];
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) continue;
        const f = (kEdge * (len - restLen[a])) / len;
        fx[a] += f * dx;
        fy[a] += f * dy;
        fx[b] -= f * dx;
        fy[b] -= f * dy;
      }
    }

    // 3. 掴み（重み付きの、減衰つきばね）
    if (grabbing) {
      const kGrab = config.kGrab;
      const cGrab = config.cGrab;
      for (let i = 0; i < n; i++) {
        const w = weight[i];
        if (w <= 0) continue;
        const gx = restX[i] + stretchX * w;
        const gy = restY[i] + stretchY * w;
        fx[i] += kGrab * w * (gx - posX[i]) - cGrab * w * velX[i];
        fy[i] += kGrab * w * (gy - posY[i]) - cGrab * w * velY[i];
      }
    }

    // 4. 積分（セミインプリシット・オイラー）。減衰は指数なのでコマ落ちに強い。
    const d = Math.exp(-config.damping * h);
    for (let i = 0; i < n; i++) {
      velX[i] = (velX[i] + fx[i] * h) * d;
      velY[i] = (velY[i] + fy[i] * h) * d;
      posX[i] += velX[i] * h;
      posY[i] += velY[i] * h;
    }
  }

  function step(dt) {
    if (n === 0) return;
    // タブを離れて戻ったときなどに一気に飛ばさない
    const clamped = Math.min(dt, 1 / 30);
    const h = clamped / config.substeps;
    for (let s = 0; s < config.substeps; s++) substep(h);
  }

  /** 掴んでおらず、動きも歪みも十分小さいか（計算を休められるか） */
  function isSettled() {
    if (grabbing || n === 0) return false;
    const eps = config.restEpsilon;
    for (let i = 0; i < n; i++) {
      if (Math.abs(velX[i]) > eps || Math.abs(velY[i]) > eps) return false;
      if (Math.abs(posX[i] - restX[i]) > eps || Math.abs(posY[i] - restY[i]) > eps) {
        return false;
      }
    }
    return true;
  }

  /** ぴたりと元の字形に戻す（歪みを捨てる） */
  function snapToRest() {
    for (let i = 0; i < n; i++) {
      posX[i] = restX[i];
      posY[i] = restY[i];
      velX[i] = 0;
      velY[i] = 0;
    }
  }

  return {
    setScale,
    setRings,
    canGrab,
    grab,
    drag,
    release,
    step,
    isSettled,
    snapToRest,
    get grabbing() {
      return grabbing;
    },
    get count() {
      return n;
    },
    // 描画用。毎フレーム配列を作り直さずに済むよう、生データをそのまま渡す。
    forEachRing(fn) {
      for (let r = 0; r < ringStart.length; r++) {
        fn(ringStart[r], ringCount[r], posX, posY);
      }
    },
  };
}
