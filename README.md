# 卒業制作 ソースコード

文字入力と身体をめぐる制作群。`works/` が本題、`experiments/` が技術検証。

ブランチ運用・コミット・本番前の確認事項は [DEVELOPMENT.md](DEVELOPMENT.md) にまとめてある。

## works — 本題

| プロジェクト | 内容 |
|---|---|
| [活字パズル](works/活字パズル/) | 反転した活字ブロック裏面の ArUco マーカーをカメラで読み、並べた順に文字として認識する物的な文字入力インターフェース |
| [KanaDance](works/KanaDance/) | 身体のポーズをかな文字の字形として登録・判別する、身体的な文字入力の試み |
| [DanceToggle](works/DanceToggle/) | USB ダンスマットを 180°回して置き、ケータイのトグル入力を足で踏む。「あ」は1回、「お」は5回。1文字に何回踏むかがそのまま運動量になる。マット2台で子音と母音を分担する二人モードつき |
| [Sessan](works/Sessan/) | 手のジェスチャと表情だけでかなを入力する空中タイピング。MediaPipe Holistic で手・顔を同時追跡 |
| [moji-stack](works/moji-stack/) | 入力した1文字が落下し、皿の上に重力で積もっていくインタラクティブコンテンツ |
| [moji-korogashi](works/moji-korogashi/) | 文字ころがし — 入力した文字のアウトラインがコースになり、その中を赤い玉が転がる。文字を寄せて接すると複合パスになりコースがつながる。CoreS3 の加速度センサで操作 |
| [nfc-reader-mvp](works/nfc-reader-mvp/) | 全部「な」の一文字で書体だけが違う NFC 札から、お題の書体を探すタイムアタック |
| [EasyReta](works/EasyReta/) | 11 エレメントでつくるひらがなフォント |
| [GabunHeizon](works/GabunHeizon/) | からだと組版 |
| [MojiHakobi](works/MojiHakobi/) | 文字運び — 字面の黒量を重さにして、重い文字は二人で同時に掴まないと運べない共同運搬型のかな入力 |
| [boin-shiin-mvp](works/boin-shiin-mvp/) | 母音子音 — かな1文字を子音（PCキーボード）と母音（RP2040マクロパッド）に割って二人で入力。ふたつの時間差の分だけ文字がぼやける |

## experiments — 技術検証

| プロジェクト | 内容 |
|---|---|
| [KumiJi](experiments/KumiJi/) | 組み字 — タイポスの12エレメントを3Dプリントした部品を並べて字を組むと、機械が最も近い規格に丸めて隣に出す |
| [TsumamiJi](experiments/TsumamiJi/) | つまみ字 — 文字の辺や丸みをつまむとゴムのように伸び、離すと元の字形にもどる |
| [stamps3_kana_dial](experiments/stamps3_kana_dial/) | つまみ字盤 — つまみを回してかなを選び、押して確定する文字入力機。M5Stamp S3 と 4.2インチ電子ペーパー |
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

ビルドが要るのは `works/moji-stack`（Vite）、`works/moji-korogashi`（Vite）、
`works/EasyReta`（Vite）、`experiments/TsumamiJi`（Vite）、`experiments/TypeResidue`（vinext）の 5 つ。

```bash
npm --prefix works/moji-stack install && npm --prefix works/moji-stack run dev
```

`experiments/cores3_*` は Arduino IDE から M5Stack CoreS3 に、`experiments/stamps3_kana_dial` は同じく Arduino IDE から M5Stamp S3 に書き込む。

## 注意

- `works/moji-stack` と `works/EasyReta` の `index.html` は `/src/...` の絶対パスで書かれている。GitHub Pages などサブパス配信では解決できないため、配信するならビルド成果物（`dist/`）を使う。
- `node_modules` とビルド成果物は `.gitignore` で除外している。
