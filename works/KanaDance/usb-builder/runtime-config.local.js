// ============================================================
//  runtime-config.js — 実行環境ごとの設定（USB・完全ローカル版）
//  ビルド時に app/runtime-config.js としてコピーされる。
//  CDN も Supabase も見に行かない。ネットが無くても動く。
// ============================================================

export const RUNTIME = Object.freeze({
  /** 同梱の Python サーバ（data/poses.json）に保存する */
  backend: 'local',
  localApi: './api/poses',

  /** 同梱した MediaPipe。相対パスなのでドライブレターが変わっても動く */
  assets: {
    visionBundle: './vendor/tasks-vision/vision_bundle.mjs',
    wasmRoot: './vendor/tasks-vision/wasm',
    poseModel: './vendor/models/pose_landmarker_lite.task',
  },

  // 以下はローカル版では使わない。backend が 'local' の間、
  // store-supabase.js はそもそも読み込まれない。
  supabase: { url: '', anonKey: '' },
  supabaseClient: '',
});
