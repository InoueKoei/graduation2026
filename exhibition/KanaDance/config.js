// ============================================================
//  config.js — KanaDance 設定
//  身体ポーズをかな字形へ翻訳する（kinesics.regular のかな版）。
// ============================================================

export const APP_CONFIG = Object.freeze({
  /**
   * カメラへの「希望」サイズ。ideal として渡すので、この通りに来るとは限らない。
   * 実際に来た解像度に画面のほうを合わせるので、ここは変えても壊れない
   * （内蔵カメラ・外付け・iPad でそれぞれ違うサイズが来る）。
   */
  video: { width: 1280, height: 720 },

  /**
   * カメラ映像の濃さ（0〜1）。1 で通常、0 で映像が消えて墨の線だけが残る。
   * 投影や記録では身体を写したくないことがあるので、UI のスライダーで変えられる。
   * 消しても姿勢推定は動き続ける（映っていないだけで、見えてはいる）。
   */
  videoOpacity: 1,
  /**
   * ポーズ（映像に重ねる関節の点と字の線）の濃さ（0〜1）。展示版は 0.5 から。
   * 調整パネルで変えられる。シャッターで記録する字はこの濃さに関係なく元の線で写る。
   */
  poseOpacity: 0.5,
  /**
   * 記録の札に敷く写真（シャッターを切ったときの映像）の濃さ（0〜1）。0 で字だけ。
   * 調整パネルで変えられ、すでに並んでいる札にもその場で効く。
   */
  recordPhotoOpacity: 0.5,
  /** これ未満の平均正規化誤差なら「一致」とみなす（小さいほど厳しい）。実運用では 1.0 前後が目安 */
  matchThreshold: 1.0,
  /**
   * 線データが無い字を大きく半透明表示するときの大きさ。
   * 映像の高さに対する比（0.7 なら画面の高さの 7 割）。
   * 解像度が変わっても見え方が変わらないよう、px ではなく比で持つ。
   */
  bigCharRatio: 0.7,
  /** 関節点（ポーズを取るときのガイド）の半径[px] */
  jointRadius: 6,

  /**
   * 太さ・大きさの基準になる映像の高さ。
   * jointRadius や blend.width はこの高さのときの px として扱い、
   * 実際の解像度に応じて拡大縮小する。
   * こうしないと 640×480 のカメラでは線が倍の太さに見えてしまう。
   */
  referenceHeight: 720,

  /**
   * ブレンド描画の既定値（Illustrator のブレンドツールのイメージ）。
   * 直近 windowMs を intervalMs ごとに鍵フレームとして取り出し、
   * 隣り合う鍵フレームの間に steps 個の中間形を補間して重ねる。
   * 古い形ほど薄く細くなる（tailOpacity / tailWidth へ向かって減衰）。
   * すべて UI のスライダーで調整できる。
   */
  blend: {
    windowMs: 1000,
    intervalMs: 100,
    steps: 5,
    width: 14,
    tailOpacity: 0.10,
    tailWidth: 0.40,
    /** 線の丸み（0〜1）。1 で端も角も丸く、0 で四角い。renderer.js の #strokeShape */
    roundness: 1,
  },

  /** 重くなりすぎないための保険：履歴バッファの長さと、一度に描く鍵フレーム数の上限 */
  /**
   * holdMs: 一致が切れてから字を出し続ける最短の時間。さかのぼる時間がこれより短い（0 = 尾なし）ときも、
   * 判定の一瞬の途切れで字がちらつかず、シャッターも押した瞬間に間に合うようにする
   */
  limits: { bufferMs: 4000, maxKeyframes: 48, holdMs: 300 },
});

/** 手足以外の部位（MediaPipe Pose のランドマーク番号）。どの組でも同じ */
const BODY_LANDMARKS = {
  head: 0,
  l_shoulder: 11, r_shoulder: 12,
  l_elbow: 13, r_elbow: 14,
  l_knee: 25, r_knee: 26,
};

/**
 * 手と足をどこで取るか。
 *   joint … 手首（15/16）・足首（27/28）。2026-10-31 22:40 JST より前の登録はすべてこれ
 *   tip   … 人差し指（19/20）・つま先（31/32）。線が指先・つま先まで伸びる
 *
 * 登録したときと同じ定義で比べないと、「いまの姿勢は指先、登録は手首」と
 * 比べる位置が食い違ってしまう。なのでポーズの組ごとにどちらで撮ったかを持たせる
 * （POSE_SETS の landmarks）。指先は手首より揺れやすく、つま先は画面の外に出やすい。
 */
export const LANDMARK_SETS = Object.freeze({
  joint: Object.freeze({ ...BODY_LANDMARKS, l_hand: 15, r_hand: 16, l_leg: 27, r_leg: 28 }),
  tip: Object.freeze({ ...BODY_LANDMARKS, l_hand: 19, r_hand: 20, l_leg: 31, r_leg: 32 }),
});

/** 腰＝左右の腰の中点、スケール基準＝両肩間の距離 */
export const POSE_REF = Object.freeze({ hipL: 23, hipR: 24, shoulderL: 11, shoulderR: 12 });

/**
 * MediaPipe Pose に無い部位を、2点の中点として作る。
 *   waist … 左右の腰（23, 24）。正規化の原点でもある
 *   neck  … 左右の肩（11, 12）。Pose には首の点が無いので肩の中点で代える
 *           （OpenPose の Neck も同じ作り方）
 */
export const DERIVED_POINTS = Object.freeze({
  waist: [23, 24],
  neck: [11, 12],
});

/** 線記述で使う略語 → 部位名 */
export const SHORTCUTS = Object.freeze({
  H: 'head', W: 'waist', N: 'neck',
  LS: 'l_shoulder', RS: 'r_shoulder',
  LH: 'l_hand', RH: 'r_hand',
  LE: 'l_elbow', RE: 'r_elbow',
  LK: 'l_knee', RK: 'r_knee',
  LL: 'l_leg', RL: 'r_leg',
});

/**
 * 既定の一筆書き。DB に lines が無い字はこれを使う。
 *   "LH-RH"      … 左手→右手を結ぶ
 *   "[LH_RH]-W"  … 左手と右手の中点→腰
 *   "RE-RK-RL"   … 右肘→右膝→右足（連続線）
 */
export const DEFAULT_KANA_LINES = Object.freeze({
  ア: ['LH-RH', 'H-W', 'W-LL'],
  イ: ['H-W', 'RE-W', 'W-RL'],
  サ: ['LH-RH', '[LH_RH]-W', 'RE-RK-RL'],
});

/**
 * ポーズの組。同じ Supabase の poses テーブルに複数の時期の登録が混在しているので、
 * 登録時刻で切り分けて、どの組で判定するかを選べるようにする。
 * 2026-10-31 22:40 JST より前の登録（旧ポーズ、手首足首で撮った新ポーズ 26字）は使わない。
 * 手首足首の26字は pose-sets/archive/wrist-ankle_20261031.json に控えてある。
 *
 *   since / until … この時刻の範囲に登録された行だけを判定に使う（ISO 8601）
 *   linkage       … 字と線の結び方（strokes）の一覧。あれば行の lines より優先し、
 *                   判定に使う字もこの一覧に載っている字に限る
 *   prefer        … linkage に同じ字が複数ある（未決の）とき、どちらの source を採るか
 *   landmarks     … 手足をどこで取ったか（LANDMARK_SETS のキー）。判定も描画もこれで取る
 *
 * until が決まっている組は締め切り済み。そこへ登録すると、時刻は次の組に入るのに
 * 部位の取り方は前の組のまま、という食い違った行ができるので、登録は受け付けない。
 */
export const POSE_SETS = Object.freeze({
  tip: {
    label: '新ポーズ（指先・つま先、10/31 22:40〜）',
    since: '2026-10-31T22:40:00+09:00',
    until: null,
    landmarks: 'tip',
    linkage: './pose-sets/linkage_20261031.json',
    prefer: { ト: 'sketch', ヨ: 'sketch' },
  },
});

/** 起動時に使う組 */
export const DEFAULT_POSE_SET = 'tip';

/**
 * 体型合わせ（体験の最初に、正面を向いてイのポーズで静止してもらう）。
 * その人の体節の長さを、登録したイの長さと比べて倍率を出し、
 * 登録ポーズをその人の体型に組み直してから判定する（子どもでも外れにくくする）。
 *
 *   letter      … 較正に使う字。この字が登録済みでないと較正できない
 *   readyMs     … ポーズを作る時間（この間は測らない）
 *   holdMs      … 静止して測る時間。揺れを抑えるため、この間の中央値を使う
 *   stillTol    … 静止とみなす揺れの幅（肩幅＝1）。超えたら測り直し
 *   minVisibility … 手先・足先まで映っているとみなす MediaPipe の visibility
 *   facingTol   … 正面とみなす体のひねり（左右の肩の奥行き差 / 肩幅）。0.5 でおよそ 27°。
 *                 null にすると確かめない
 */
export const BODY_CALIBRATION = Object.freeze({
  letter: 'イ',
  readyMs: 1200,
  holdMs: 1500,
  stillTol: 0.25,
  minVisibility: 0.5,
  facingTol: 0.5,
});

/**
 * シャッターで記録する字の札（recorder.js）。大きさは Figma のフレーム pose の下の帯から。
 * 帯は 1920px に 256px の札がちょうど 7 枚入るので、7 枚で満杯にして左端から消す。
 */
export const RECORDS = Object.freeze({
  max: 7,
  cardW: 256,
  cardH: 192,
  /** 字の周りの余白。Figma の見本は縦長の字が上下 14px で収まっている */
  inset: Object.freeze({ x: 24, y: 14 }),
  /** 札の canvas の解像度（縮めて見せても線がにじまないよう 2 倍で描く） */
  pixelRatio: 2,
});
