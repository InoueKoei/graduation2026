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
  tiltDead: 0.04,       // 手ぶれの不感帯(g)
  tiltRange: 0.42,      // この傾き(g)で左右いっぱい。小さいほど軽い操作で寄せられる
  steerSpeed: 620,      // 筆先の横移動の最高速度(px/s)
  steerEase: 9,         // 目標へ寄る速さ。上げるとキビキビ

  // --- 流れ ---
  speedStart: 200,      // 初速(px/s)
  speedGain: 4.0,       // 1秒ごとに増える速さ
  speedMax: 620,

  // --- 岩と隙間 ---
  rowGap: 190,          // 岩の列の間隔(px)
  gapStart: 250,        // 隙間の幅(px)。だんだん狭くなる
  gapMin: 130,
  gapShrink: 2.4,       // 1秒あたり狭くなる量
  rockR: 26,            // 岩の基本半径
  // 次の隙間は「届く範囲×この値」までしかずらさない(理不尽死の防止)。
  // 加速の立ち上がりで余裕が食われるので控えめに取る
  reachMargin: 0.56,

  // --- 筆先 ---
  brushY: 0.72,         // 画面のどの高さに筆先を置くか(比)
  brushR: 9,            // 当たり判定の半径
  strokeMax: 900,       // 軌跡として覚える点の数
};
