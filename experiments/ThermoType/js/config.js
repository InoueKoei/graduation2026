// 調整はぜんぶここで。
export const CONFIG = {
  // データ取得先（上から順に試して、失敗したら次へ）
  endpoints: [
    "http://sht41.local/data",
    "http://192.168.0.131/data",
  ],
  pollMs: 250,        // センサーを読みに行く間隔(ms)。ESP32はキャッシュ即答なので詰めてOK

  // --- 入力レンジ（この範囲を0..1に正規化して使う） ---
  tempRange: [16, 34],   // °C: 下=寒色/細字, 上=暖色/太字
  humRange:  [35, 90],   // %:  下=カリカリ, 上=滲みMAX

  // --- 書体 ---
  // ローカルインストール済みフォントも指定可。先頭が無ければ後ろへフォールバック
  fontFamily: '"Momochidori VF", "M PLUS 1", "Hiragino Sans", sans-serif',

  // --- 温度 → 活字 ---
  weightRange: [250, 850],   // バリアブルフォントのウェイト
  hueRange:    [215, 372],   // 色相: 青(215)→紫→朱(372=12+360)。緑を通らない回り方
  satRange:    [28, 72],     // 彩度%
  lightRange:  [24, 36],     // 明度%

  // --- 湿度 → 滲み（エッジぼかし方式: blur×contrastで縁が溶ける） ---
  bleedGamma: 1.4,    // 1より大きいと低湿度では滲みにくい
  bleedMax: 7,        // 最大ぼかし(px)
  contrastMax: 14,    // 滲み用コントラスト最大値
  lsRange: [0.06, -0.015], // 字間(em): 乾き=広い → 湿り=詰まる

  // --- 動き ---
  easeSpeed: 2.0,     // 実測値へ追従する速さ(大=機敏)
};
