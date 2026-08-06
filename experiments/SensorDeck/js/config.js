// 調整はぜんぶここで。
export const CONFIG = {
  endpoints: [
    "http://sht41.local/data",
    "http://192.168.0.131/data",
  ],
  pollMs: 150,        // 取得間隔(ms)
  windowSec: 120,     // チャートの時間窓(秒)
  accRange: [-1.6, 1.6], // 加速度チャートの固定レンジ(g)。自動だと揺れで暴れるので固定
};
