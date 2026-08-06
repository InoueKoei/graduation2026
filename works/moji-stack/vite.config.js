import { defineConfig } from 'vite';

// Vite は既定で PORT 環境変数を見ないため、明示的に反映する。
// （ポートが埋まっている時に別ポートへ勝手にずれると、プレビューが繋がらないため）
export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5173,
  },
});
