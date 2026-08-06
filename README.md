# 卒業制作 ソースコード

文字入力と身体をめぐる制作群。`works/` が本題、`experiments/` が技術検証。

## works — 本題

| プロジェクト | 内容 |
|---|---|
| [活字パズル](works/活字パズル/) | 反転した活字ブロック裏面の ArUco マーカーをカメラで読み、並べた順に文字として認識する物的な文字入力インターフェース |
| [KanaDance](works/KanaDance/) | 身体のポーズをかな文字の字形として登録・判別する、身体的な文字入力の試み |
| [Sessan](works/Sessan/) | 手のジェスチャと表情だけでかなを入力する空中タイピング。MediaPipe Holistic で手・顔を同時追跡 |
| [moji-stack](works/moji-stack/) | 入力した1文字が落下し、皿の上に重力で積もっていくインタラクティブコンテンツ |
| [nfc-reader-mvp](works/nfc-reader-mvp/) | 全部「な」の一文字で書体だけが違う NFC 札から、お題の書体を探すタイムアタック |
| [EasyReta](works/EasyReta/) | 11 エレメントでつくるひらがなフォント |
| [GabunHeizon](works/GabunHeizon/) | からだと組版 |

## experiments — 技術検証

| プロジェクト | 内容 |
|---|---|
| [GlassType](experiments/GlassType/) | 呼気の窓 |
| [ThermoType](experiments/ThermoType/) | 気候で変わる活字 |
| [SensorDeck](experiments/SensorDeck/) | ESP32 計器盤 |
| [MotionStudy](experiments/MotionStudy/) | 動きの四態 |
| [Kei](experiments/Kei/) | 渓 — 傾けて下る |
| [Sumi](experiments/Sumi/) | 墨 — こぼさず運ぶ |
| [Kingyo](experiments/Kingyo/) | 金魚すくい |
| [PoeMagic](experiments/PoeMagic/) / [air-text-painting](experiments/air-text-painting/) | 空中文字ペインティング（両者は同一内容。どちらかに寄せる予定） |
| [TypeResidue](experiments/TypeResidue/) | vinext ベースの習作 |
| [cores3_typography_demo](experiments/cores3_typography_demo/) | moji-stack を M5Stack CoreS3 に移植したデモ |
| [cores3_sessan_cam](experiments/cores3_sessan_cam/) | CoreS3 を MJPEG カメラにして Sessan の判定に使う構成 |
| [cores3_cam_effects](experiments/cores3_cam_effects/) | CoreS3 カメラのエフェクト |
| [cores3_fluid](experiments/cores3_fluid/) / [cores3_ink_brush](experiments/cores3_ink_brush/) / [cores3_voice_bloom](experiments/cores3_voice_bloom/) | CoreS3 の表現習作 |

## 動かし方

大半は素の HTML / CSS / JS なので、フォルダ内で静的サーバーを立てれば動く。

```bash
npx --yes http-server works/Sessan -p 8941 -c-1
```

ビルドが要るのは `works/moji-stack`（Vite）、`works/EasyReta`（Vite）、`experiments/TypeResidue`（vinext）の 3 つ。

```bash
npm --prefix works/moji-stack install && npm --prefix works/moji-stack run dev
```

`experiments/cores3_*` は Arduino IDE から M5Stack CoreS3 に書き込む。

## 注意

- `works/moji-stack` と `works/EasyReta` の `index.html` は `/src/...` の絶対パスで書かれている。GitHub Pages などサブパス配信では解決できないため、配信するならビルド成果物（`dist/`）を使う。
- `node_modules` とビルド成果物は `.gitignore` で除外している。
