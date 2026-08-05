// 調整はぜんぶここで。
export const CONFIG = {
  endpoints: [
    "http://192.168.0.131/data",   // IP直を先頭に(安定)
    "http://sht41.local/data",
  ],
  pollMs: 120,          // 動きが主役なので短め

  // --- 動きの解釈 ---
  tiltEase: 9,          // 傾きの追従速さ(/s)
  shakeAttack: 18,      // 揺れの立ち上がり(/s)
  shakeDecay: 1.6,      // 揺れの余韻(/s) 小さいほど長く残る
  invertX: false,
  invertY: true,
  swapXY: false,

  // --- 見た目 ---
  trailLength: 140,     // 「錘」の軌跡の長さ(点数)
  fieldGrid: 9,         // 「場」のストローク格子数(N×N)
};
