# 展示版 — exhibition

卒業制作展（搬入 2026-11-26〜）で動かす5作品の**本番用コピー**。
開発は今までどおり `works/` で続け、展示に出す状態になったらここへ写す。
`main` に入ると GitHub Pages にそのまま出る。

| 作品 | 開く URL | 元 | 備考 |
|---|---|---|---|
| [StepToggle](StepToggle/) | [/exhibition/StepToggle/](https://inouekoei.github.io/graduation2026/exhibition/StepToggle/) | `works/DanceToggle` | モード選択→チュートリアル→入力。Figma「ステップ」の画面に合わせて組み直した |
| [KanaDance](KanaDance/) | [/exhibition/KanaDance/](https://inouekoei.github.io/graduation2026/exhibition/KanaDance/) | `works/KanaDance` | カメラ使用。USB 版は `usb-builder/` |
| [Yomare](Yomare/) | [/exhibition/Yomare/web/control.html](https://inouekoei.github.io/graduation2026/exhibition/Yomare/web/control.html) | `works/Yomare` | OCR は Mac 上の `ocr_server.swift` が要る。本番は `run.sh` でローカル起動 |
| [moji-stack](moji-stack/) | [/exhibition/moji-stack/dist/](https://inouekoei.github.io/graduation2026/exhibition/moji-stack/dist/) | `works/moji-stack` | Vite。配信するのはビルド済みの `dist/`（下記） |
| [HeadKana](HeadKana/) | [/exhibition/HeadKana/](https://inouekoei.github.io/graduation2026/exhibition/HeadKana/) | `HeadKana-gestures/site-lcd/dist` | Web 版。ファームウェアのソースは `HeadKana/firmware/` |

## 写すときの決まり

- **コピーであって移動ではない。** `works/` は開発版として残す。展示版だけを直した箇所は各 README に書く。
- **パスは相対で書く。** Pages は `/graduation2026/exhibition/<作品>/` のサブパスで配るので、
  `/app.js` のような絶対パスはドメイン直下を見に行って 404 になる。
  HeadKana と moji-stack はこのために `/` 始まりのパスを相対に直してある。
- **moji-stack はビルドしてから入れる。**

  ```bash
  npm --prefix exhibition/moji-stack ci
  npm --prefix exhibition/moji-stack run build
  ```

  `vite.config.js` の `base: './'` が相対パスで書き出す。`dist/` は普段 `.gitignore` で除外しているが、
  ここだけは配信物なので `!exhibition/moji-stack/dist/` で戻してある。
- **HeadKana のファームウェア**は `firmware/` にソースだけ置いた。`build/` と `toolchain/`（合わせて約 1GB）は入れていない。
  ビルド手順は `firmware/README.md`。

## 動かし方（手元）

```bash
npx --yes http-server exhibition -p 8991 -c-1
# → http://localhost:8991/StepToggle/ など
```

Gamepad・Web Serial・BLE・カメラはセキュアコンテキスト（HTTPS か localhost）でしか動かない。

## ラズパイで動かす

[raspi/README.md](raspi/README.md)。`git clone` して `raspi/setup.sh` を流すと、電源を入れるだけで全画面で立ち上がる。
LAN の `http://192.168.x.x` では動かないので、展示機では localhost か Pages の URL で開く。
