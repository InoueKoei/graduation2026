// 調整はぜんぶここで。
export const CONFIG = {
  endpoints: [
    "http://192.168.0.131/data",
    "http://sht41.local/data",
  ],
  pollMs: 100,

  // --- 傾きの向き合わせ ---
  invertX: false,
  invertY: true,
  swapXY: false,
  tiltEase: 12,        // 傾きの追従(/s)。上げると機敏・下げるとぬるい

  // --- 墨の物理 ---
  gravity: 1900,       // 傾き1gあたりの加速(px/s^2)
  friction: 1.1,       // 皿の上での減速(/s)
  dishRadius: 0.34,    // 皿の半径(画面短辺比)

  // --- こぼれ ---
  spillTilt: 0.62,     // この傾き(g)を超えると縁からこぼれ始める
  waveGain: 3.2,       // 揺れ→波の立ちやすさ
  waveDecay: 0.9,      // 波が鎮まる速さ(/s) 小さいほど長く残る
  spillRate: 34,       // こぼれる速さ(%/s)
  refillOnGoal: 26,    // ゴール到達で戻る墨(%)

  // --- コース ---
  goalRadius: 46,      // ゴール判定の半径(px)
  goalHold: 0.7,       // ゴール上に留まる必要のある時間(秒)
  startInk: 100,
};
