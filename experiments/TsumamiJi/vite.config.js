import { defineConfig } from 'vite';

// base: './' で生成物を相対パスにする。
// moji-stack は index.html が /src/... の絶対パスで書かれていて
// サブパス配信（GitHub Pages 等）で解決できない、と README に注意書きがある。
// ここでは最初から相対にしておき、同じ轍を踏まない。
//
// Vite は既定で PORT 環境変数を見ないため、明示的に反映する。
export default defineConfig({
  base: './',
  server: {
    port: Number(process.env.PORT) || 5173,
  },
});
