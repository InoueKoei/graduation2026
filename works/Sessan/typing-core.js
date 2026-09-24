// ============================================================
//  typing-core.js — Sessan の入力判定ロジック（MediaPipe 非依存の純粋関数）
// ============================================================

// ── 指を数える ──────────────────────────────────────────────
//  以前は「指先が第二関節より y 上なら立っている」で数えていた。
//  これは**手をまっすぐ上に向けている前提**で、傾けると崩れる。
//  合成した手で測ると、正面 0〜10° では 100% だが 20° で 50%、90° で 19% まで落ちた。
//  親指を y で見ていたので、回転の向きによって成績が非対称にもなっていた。
//
//  いまは向きに依らない量だけで判定する。
//    人差し〜小指 … 関節での「向きの変化角」。まっすぐなら 0、曲げるほど大きい
//    親指        … 手のひらの横方向へどれだけ開いているか
//  どちらも手を回しても値が変わらないので、同じ測り方で 90° まで 100% になる。
//  ※ これは画面内の回転（面内回転）の話。指をカメラ側へ向けた奥行き方向の傾きは、
//    2D のランドマークでは短く写るだけなので、依然として苦手。
//    そこまで要るなら Tasks API の world landmarks（手基準の3D）へ移るのが筋。

const sub = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
const vlen = (p) => Math.hypot(p.x, p.y) || 1e-9;

/** 2つのベクトルのなす角[rad]。0〜π */
function angleBetween(p, q) {
  const c = (p.x * q.x + p.y * q.y) / (vlen(p) * vlen(q));
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

/** 人差し〜小指の [付け根, 第二関節, 先端] */
const FINGER_JOINTS = Object.freeze([[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]]);

/**
 * 親指が開いているか。
 * 手のひらの「横」向き（人差し指の付け根→小指の付け根）を基準に、
 * 親指の付け根→先端がその**逆向き**へどれだけ出ているかで見る。
 * 手を回せば基準の向きも一緒に回るので、面内回転では値が変わらない。
 * 左右の手・鏡像では基準も親指も一緒に反転するため、符号の関係はそのまま保たれる。
 */
function isThumbOut(lm, config) {
  const palm = vlen(sub(lm[0], lm[9]));      // 手首→中指の付け根＝手の大きさ
  const side = sub(lm[5], lm[17]);           // 人差し指の付け根→小指の付け根
  const s = { x: side.x / vlen(side), y: side.y / vlen(side) };
  const t = sub(lm[2], lm[4]);               // 親指の付け根→先端
  const across = (t.x * s.x + t.y * s.y) / palm;
  return -across > config.thumbOut;
}

/**
 * 立てている指の本数を数える。
 * @param {Array<{x:number,y:number}>} landmarks 片手の21点
 * @param {{bendDeg:number, thumbOut:number}} config config.js の FINGERS
 * @returns {number} 0〜5
 */
export function countFingers(landmarks, config) {
  const bendRad = (config.bendDeg * Math.PI) / 180;
  let count = 0;
  for (const [mcp, pip, tip] of FINGER_JOINTS) {
    // 付け根→第二関節 と 第二関節→先端 の向きの差
    if (angleBetween(sub(landmarks[mcp], landmarks[pip]), sub(landmarks[pip], landmarks[tip])) < bendRad) {
      count++;
    }
  }
  if (isThumbOut(landmarks, config)) count++;
  return count;
}

/**
 * 直近数フレームの多数決で読みを決める。
 *
 * **確定を壊すのは正答率より「読みが変わる回数」**。
 * 本数が1フレームでも変われば script.js 側で選択字が変わり、
 * 22フレームの保持が振り出しに戻る。1秒に何度も変わると永久に確定しない。
 *
 * 合成した手に追跡のぶれ（σ＝手の大きさの2%）を入れて 10 秒流したとき、
 * 以前の実装は 17.5 回、新しい判定は 0 回、これを噛ませるとぶれ 5% でも 0.1 回だった。
 *
 * 同数のときは今の値を保つ（きっかけの無い入れ替わりを作らない）。
 */
export class FingerVote {
  #buf = [];
  #size;
  #value = 0;

  constructor(size) { this.#size = Math.max(1, size | 0); }

  get value() { return this.#value; }

  /** @returns {number} ならしたあとの本数 */
  push(n) {
    this.#buf.push(n);
    if (this.#buf.length > this.#size) this.#buf.shift();

    const tally = new Map();
    for (const v of this.#buf) tally.set(v, (tally.get(v) ?? 0) + 1);

    let best = this.#value;
    let bestN = tally.get(this.#value) ?? 0;
    for (const [v, n2] of tally) if (n2 > bestN) { best = v; bestN = n2; }
    return (this.#value = best);
  }

  reset() { this.#buf.length = 0; }
}

/**
 * MediaPipe FaceMesh の内唇リング（口腔の輪郭）。
 * この多角形の面積が「口をどれだけ開けているか」＝口腔の面積になる。
 * 先行研究（MouthType CHI2004 / Saitoh 2007 / KUCHIMOJI 2026）が
 * 母音判別に有効としているのは、この面積と縦横比の組み合わせ。
 */
export const INNER_LIP_RING = Object.freeze([
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
  308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
]);

/** 多角形の面積（シューレース公式）。点の並び順が時計回りでも符号を吸収する */
export function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * 顔ランドマークから口形・目の特徴量を求める。
 *
 * area   … 口腔（内唇リング）の面積 / 顔サイズ²
 * aspect … 口の縦幅 / 横幅
 *
 * どちらも顔サイズで無次元化してあるので、カメラとの距離が変わっても値は変わらない
 * （近づいた・遠ざかったで母音の判定が変わってしまわないように）。
 * 顔サイズそのものは proximity として返す。近さを使いたい側はこれを見る。
 *
 * @param {Array<{x:number,y:number}>} face FaceMesh の点群
 * @returns {{area:number, aspect:number, eye:number, proximity:number}}
 */
export function analyzeFace(face) {
  // 顔サイズ＝左右の目尻の間隔。表情でほとんど変わらないので基準に向く
  const faceSize = Math.hypot(face[33].x - face[263].x, face[33].y - face[263].y) || 1e-6;

  const ring = INNER_LIP_RING.map((i) => face[i]);
  const area = polygonArea(ring) / (faceSize * faceSize);

  const vMouth = Math.hypot(face[13].x - face[14].x, face[13].y - face[14].y);
  const hMouth = Math.hypot(face[61].x - face[291].x, face[61].y - face[291].y) || 1e-6;

  const vEye = Math.hypot(face[159].x - face[145].x, face[159].y - face[145].y);
  const hEye = Math.hypot(face[33].x - face[133].x, face[33].y - face[133].y) || 1e-6;

  return { area, aspect: vMouth / hMouth, eye: vEye / hEye, proximity: faceSize };
}

/**
 * 口形に最も近い母音キーを返す（閉唇 'close' を含む）。
 * 'close' は KUCHIMOJI の N クラス（閉じた唇）にあたる。
 *
 * area と aspect は桁が違う（面積は小さく、縦横比は 0〜1 前後）ので、
 * そのまま距離を取ると面積の差が埋もれる。各軸をターゲット値の幅で割ってから比べる。
 * ＝単位を揃えているだけで、較正ではない。
 *
 * @returns {string} 'close' | 'あ' | 'い' | 'う' | 'え' | 'お'
 */
export function classifyVowel(metrics, vowelTargets) {
  const entries = Object.entries(vowelTargets);
  const spread = (key) => {
    const values = entries.map(([, t]) => t[key]);
    return Math.max(...values) - Math.min(...values) || 1;
  };
  const areaSpread = spread('area');
  const aspectSpread = spread('aspect');

  let best = 'close';
  let min = Infinity;
  for (const [key, t] of entries) {
    const d = Math.hypot(
      (metrics.area - t.area) / areaSpread,
      (metrics.aspect - t.aspect) / aspectSpread,
    );
    if (d < min) { min = d; best = key; }
  }
  return best;
}

/** 目が閉じているか（close/open のどちらに近いか） */
export function isEyeClosed(metrics, eyeTargets) {
  return Math.abs(metrics.eye - eyeTargets.close) < Math.abs(metrics.eye - eyeTargets.open);
}

/**
 * 末尾の1字に濁点／半濁点を付けた新しいテキストを返す。
 * 付けられない字ならテキストをそのまま返す。
 * @param {string} text
 * @param {'d'|'h'} kind 'd'=濁点, 'h'=半濁点
 */
export function withModifier(text, kind, dakuten, handakuten) {
  if (text.length === 0) return text;
  const last = text.slice(-1);
  const next = kind === 'd' ? dakuten[last] : handakuten[last];
  return next ? text.slice(0, -1) + next : text;
}

/**
 * 「一定フレーム保持で1度だけ確定する」ゲート。
 * ジェスチャ入力のチャタリングを抑える。
 *   tick()  … 成立フレームで呼ぶ。しきい値到達で1度だけ true（同時にロック）
 *   ロック中は再度しきい値に達しても false（誤連射を防止）
 *   unlock()/reset() で解除する
 */
export class HoldGate {
  #required;
  #frames = 0;
  #locked = false;

  constructor(requiredFrames) {
    this.#required = requiredFrames;
  }

  get locked() { return this.#locked; }

  /** @returns {boolean} 確定した瞬間だけ true */
  tick() {
    if (this.#locked) return false;
    this.#frames++;
    if (this.#frames >= this.#required) {
      this.#frames = 0;
      this.#locked = true;
      return true;
    }
    return false;
  }

  /** 0〜1 の進捗（ロック中は 1） */
  progress() {
    return this.#locked ? 1 : this.#frames / this.#required;
  }

  resetCounter() { this.#frames = 0; }
  unlock() { this.#locked = false; }
  reset() { this.#frames = 0; this.#locked = false; }
}
