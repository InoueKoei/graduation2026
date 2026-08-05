// ============================================================
//  config.js — 活字パズル シンプル版（投影用）の表示設定
//  マーカー→かなの対応は ../aruco-core.js に集約。ここは見た目だけ。
// ============================================================

export const DISPLAY_CONFIG = Object.freeze({
  /** 取り込むカメラ解像度 */
  camera: { width: 1280, height: 720 },

  /** 下部の投影スクリーン（2:1）。カメラ映像はこの高さ分だけ下から切り出して表示する */
  screen: { width: 1200, height: 600 },

  /** 投影文字のフォント */
  font: 'bold 160px "Hiragino Mincho ProN", "Hiragino Mincho Pro", serif',

  /** 文字の影（暗い背景から浮かせる） */
  shadow: { color: 'rgba(0,0,0,0.9)', blur: 20 },
});
