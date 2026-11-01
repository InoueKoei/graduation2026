// ============================================================
//  runtime-config.js — 実行環境ごとの設定
//  「どこからライブラリを取るか」「ポーズをどこに保存するか」だけを持つ。
//  作品としての調整値（しきい値・ブレンド等）は config.js のほう。
//
//  USB 版（Windows・完全ローカル）は、このファイルだけを差し替える。
//  差分は usb/runtime-config.local.js を参照。
// ============================================================

export const RUNTIME = Object.freeze({
  /**
   * 参照ポーズの保存先。
   *   'supabase' … クラウド（ネットが要る）
   *   'local'    … 同梱の Python サーバ（USB 上の data/poses.json）
   */
  backend: 'supabase',

  /** ローカルバックエンドのエンドポイント（backend: 'local' のときだけ使う） */
  localApi: './api/poses',

  /**
   * MediaPipe の取得元。
   * バージョンを変えるとモデルとの相性が変わるので、まとめてここで固定する。
   */
  assets: {
    visionBundle: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs',
    wasmRoot: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm',
    poseModel:
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },

  /** Supabase 接続情報（backend: 'supabase' のときだけ使う） */
  supabase: {
    url: 'https://aawkwvxyylioorbeyydx.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhd2t3dnh5eWxpb29yYmV5eWR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0MzEzMTYsImV4cCI6MjA5NTAwNzMxNn0.WWdP8PD0fGA-kqidf4kLGilYAfGBTGVdnKc9w5oQ9gA',
  },

  /** Supabase クライアント（ESM）の取得元 */
  supabaseClient: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
});
