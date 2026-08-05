// 調整はぜんぶここで。単位は秒・px・湿度%。
export const CONFIG = {
  // データ取得先（上から順に試して、失敗したら次へ）
  endpoints: [
    "http://sht41.local/data",
    "http://192.168.0.131/data",
  ],
  pollMs: 250,          // センサーを読みに行く間隔(ms)。ESP32はキャッシュ即答なので詰めてOK

  // --- 曇りのロジック ---
  baselineTau: 45,      // 「ふだんの湿度」に追従する時定数(秒)。大きいほど鈍い
  deltaFull: 8,         // ふだん+この%で曇りMAX（大きいほど鈍感＝マイルド）
  fogGamma: 1.2,        // 曇りカーブ。1より大きいと弱い息では薄くしか曇らない
  condenseSpeed: 0.9,   // 曇りが増える速さ
  evaporateSpeed: 0.12, // 曇りが晴れる速さ（ゆっくり蒸発）
  refogRate: 0.35,      // 拭いた跡が「新しい息」で埋め戻る速さ
  fogMaxAlpha: 0.85,    // 曇りMAX時の不透明度（1=完全に白塗り）

  // --- 背景 ---
  background: 'bokeh',          // 初期値: 'minimal' | 'bokeh' | 'image'
  backgroundImage: 'assets/bg.jpg', // 'image'モードで読む画像（無ければbokehに退避）

  // --- 描画 ---
  brushRadius: 34,      // 指先の太さ(px)。css の #cursor サイズと連動
};
