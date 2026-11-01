import { defineConfig } from 'vite';

// Vite は既定で PORT 環境変数を見ないため、明示的に反映する。
// （ポートが埋まっている時に別ポートへ勝手にずれると、プレビューが繋がらないため）
//
// base を './' にしているのは、展示版を GitHub Pages のサブパス
// （/graduation2026/exhibition/moji-stack/dist/）で配るため。
// '/' のままだと /assets/... を見に行ってドメイン直下で 404 になる。
export default defineConfig({
  base: './',
  server: {
    port: Number(process.env.PORT) || 5173,
  },
});
