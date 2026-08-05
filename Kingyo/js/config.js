// 調整はぜんぶここで。
export const CONFIG = {
  endpoints: [
    "http://192.168.0.131/data",
    "http://sht41.local/data",
  ],
  pollMs: 100,

  // --- 傾き(MPU) ---
  invertX: false,
  invertY: true,
  swapXY: false,
  tiltEase: 6,          // 追従の速さ。下げるとぬるっと動いて狙いやすい
  tiltRange: 0.80,      // この傾き(g)で画面端。大きいほど鈍感=狙いやすい
  tiltDead: 0.045,      // 手ぶれを無視する不感帯(g)

  // --- すくい上げ: 上へ素早く振る(z軸のスパイク) ---
  jerkUp: 0.22,         // この大きさの上向き加速でポイを持ち上げる
  jerkDown: 0.18,       // 下向きに振ると沈める
  liftHold: 2.6,        // 何もしなければこの秒数で自然に沈む
  jerkCooldown: 0.35,   // 連続誤検出を防ぐ間隔(秒)

  // --- 金魚 ---
  fishCount: 14,
  fishSpeed: 40,        // 巡航速度(px/s)
  fishDart: 190,        // 驚いたときの逃走速度(px/s)。息切れするので追える
  fearRadius: 84,       // ポイを警戒する距離(px)
  startleSpeed: 165,    // この速さを超えてポイが近づくと散る(px/s)。ゆっくりなら逃げない
  panicDecay: 1.6,      // 逃走の息切れ(/s)。大きいほどすぐ落ち着く
  wanderTurn: 1.9,      // ふらふら曲がる強さ
  fishLen: 26,          // 体長(px)

  // --- ポイ(紙の器) ---
  poiRadius: 62,
  poiMaxSpeed: 260,     // 水中の器なので速度に上限がある(px/s)。下げるとゆったり
  liftSpeed: 2.6,       // 持ち上げ/沈める速さ(/s)
  // 紙の耐久
  wetRate: 0.055,       // 水中にいる間に濡れる速さ(/s)
  dryRate: 0.05,        // 水から出ている間に乾く速さ(/s)
  // 破れ: 濡れ具合 × (魚の荷重 + 急な動き)
  tearFromLoad: 0.17,   // 魚1匹あたりの負荷係数(引き上げ中のみ効く)
  tearSpeedFree: 430,   // この速さまでは水を切っても破れない(px/s)
  tearFromSpeed: 0.0022,// しきい値を超えた分だけ効く
  tearWetPower: 2.6,    // 濡れの効き方(累乗)。大きいほど「濡れてから急に脆い」
  poiCount: 3,          // ポイの枚数(残機)

  // --- 水面 ---
  waterDrag: 0.9,       // 引き上げ中の水の抵抗
  scoopHeight: 0.55,    // これ以上持ち上げると「水から出た」判定
  bowlX: 0.84,          // 器の位置(画面幅比)
  bowlY: 0.16,
  bowlR: 70,
};
