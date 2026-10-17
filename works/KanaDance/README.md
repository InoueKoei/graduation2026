# KanaDance

身体のポーズを **かな文字の字形**として登録・判別する、身体的な文字入力の試み。
[kinesics.regular](https://tokyotypedirectorsclub.org/award/2026_tdc_04/)（コレオグラフィ×タイポグラフィ）のかな版。
MediaPipe Pose で姿勢を推定し、Supabase にポーズ座標を保存する。

## 実行方法

カメラと ES モジュールの都合で **ローカルサーバ経由**で開く（`file://` 不可）。

```sh
cd KanaDance
python3 -m http.server 8000
# → http://localhost:8000/
```

## 操作

- **✍️ 登録モード**：ポーズをとり、文字（例:「サ」）を入力して **DB に登録**
- **🔍 判別モード**：最も近い字を推定し、身体の上に一筆書き（または大きな文字）を重ねて表示

右上の ⚙ で調整パネル、◐ で **ライト / ダーク**切替（sumi の2モード。墨の色も反転する）。

## 表示の大きさと縦横比（端をドラッグ）

ステージの端のつまみを引くと、大きさと**縦横比**を変えられる。
縦長のカメラに合わせて縦の箱にもできるし、カメラの比と違う形にもできる。

| つまみ | 効き |
|---|---|
| **右端** | 幅 |
| **下端** | 高さ |
| **右下の角** | 幅と高さの両方 |

- **ダブルクリック**（または Esc）で、カメラの比の既定サイズに戻る
- Tab でつまみに入って**矢印キー**でも変えられる（Shift で大きく動く）
- 変えた大きさと収め方は `localStorage` に覚える。展示で毎回合わせ直さずに済む
- 下限 200px、上限は画面からはみ出さない範囲（高さは 88vh まで）

高さを一度も触っていなければ `--stage-h` を立てないので、**カメラの比に追従**したまま。
下端か角を掴んだ時点でその実寸に固定し、比がカメラから外れる。

### 箱の形がカメラの比と違うとき

⚙ パネルの「箱に収める」で切り替える。

| | 見え方 |
|---|---|
| **はみ出す分を切る**（既定） | 箱いっぱいに埋める。余白は出ないが、画面外に出る部分がある |
| **全体を入れる** | 映像の全体が入る。代わりに上下か左右に余白が出る |

**線が身体からずれることはない。** 映像と canvas は同じ内在比を持ち、同じ `object-fit` が
掛かるので、箱をどんな形にしても二つは完全に同じ変形を受ける
（実測でも位置・サイズが一致することを確認済み）。

canvas の内部解像度は映像のままなので、**線の太さの見え方も変わらない**。

ステージは中央寄せなので、右端は動かした量の半分しか動かない。
つまみが指についてくるよう、**横の差分だけ倍にして幅へ渡している**（縦は上が固定なのでそのまま）。

## 映像の濃さ（カメラを写さない）

⚙ パネルの一番上、**映像の濃さ**を 0 にするとカメラ映像が消え、**墨の線だけが残る**。
投影や記録で身体を写したくないときに使う。

- 消しても**姿勢推定は動き続ける**。映っていないだけで、見えてはいる（線はそのまま出る）
- 途中の値も使える。15% くらいにすると身体がうっすら残り、線がその上に乗る
- 既定値は `config.js` の `videoOpacity`（1 = 通常）

映像を消した状態でも線が読めるよう、墨の色はテーマに追従する
（ライトでは黒、ダークでは白。地はステージの `--color-muted`）。

## 線の記述（一筆書き）

`config.js` の `DEFAULT_KANA_LINES` に既定を持つ。DB 側に `lines` があればそちらを優先。

| 記法 | 意味 |
|---|---|
| `LH-RH` | 左手 → 右手 を結ぶ |
| `[LH_RH]-W` | 左手と右手の**中点** → 腰 |
| `RE-RK-RL` | 右肘 → 右膝 → 右足（連続線） |

略語は `config.js` の `SHORTCUTS`（H=頭, W=腰, L/R + H/E/K/L=手/肘/膝/足）。
`[A_B]` は 2 つに限らず、`_` で並べた部位の重心を指す。

## カメラのサイズ

解像度を決め打ちにしていない。`config.js` の `video` は **希望**（`ideal`）として渡すだけで、
実際に来た解像度に**画面のほうを合わせる**。内蔵カメラ・外付け・iPad で違うサイズが来ても、
切り抜きも余白も歪みも出ない。

- 毎フレーム `video.videoWidth/videoHeight` を見て、変わっていれば
  canvas の実寸と `--cam-ar`（ステージの比）を更新する（`ui.js` の `syncFrameSize`）
- 高さの上限は `style.css` の `--stage-max-h`、幅はそこから比で逆算される
- 解像度が変わったフレームでは**軌跡を捨てる**。前の解像度のピクセル座標が混ざると掃きが飛ぶため
- `getUserMedia` は `ideal` で要求する。`exact` にすると、その解像度を出せないカメラで
  起動そのものが失敗する

太さの類は**基準の高さ（`referenceHeight`、既定 720）に対する値**として扱い、
実解像度に応じて拡大縮小する。こうしないと 640×480 のカメラで線が倍の太さに見えてしまう。
対象は `jointRadius` と `blend.width`、それに巨大文字（`bigCharRatio` は映像の高さに対する比）。

## ブレンド（時間の重ね書き）

線は「いまの姿勢」1 枚ではなく、**時間のブレンド**として描く。
直近 1 秒を 0.1 秒ごとに鍵フレームとして取り出し、隣り合う字形の間に中間形を補間して重ねる
（Illustrator のブレンドツールで 2 つのパスを繋ぐイメージ）。
古い形ほど薄く細くなるので、動きがそのまま掃きになる。

調整パネルのスライダーは「表示 → 判別 → ブレンド」の順に並ぶ。
ブレンドの各スライダーの効きは次のとおり。

| スライダー | 効き |
|---|---|
| さかのぼる時間 | 0.2〜3.0 秒。長いほど尾が伸びる |
| 取得間隔 | 20〜500ms。鍵フレームの粗さ |
| 中間形 | 0〜10 段。0 なら鍵フレームだけの飛び飛びの重ね、増やすほど連続した掃きになる |
| 線の太さ | 最新の形の太さ（古い形は `blend.tailWidth` 比まで細る） |
| 古い形の濃さ | 最も古い形の不透明度。0 で完全に消え、上げるほど全体が均一に濃くなる |

- 鍵フレームは記録フレームの**線形補間**で取るので、カメラの fps に関わらず等間隔になる。
- 描く形の数は `(鍵フレーム数 - 1) × (中間形 + 1) + 1`。パネル下部に実数を出す。
  上限は `limits.maxKeyframes`（48 枚）で、超える設定では窓を保ったまま間引く。
  最も重い設定（3 秒 / 20ms / 10 段 = 518 枚）で 1 フレーム約 3.3ms。
- 動いている最中は一致が外れやすいので、**一致した字はさかのぼる時間ぶん保持**して尾を描き切る。

既定値は `config.js` の `blend`。

## USB 版（Windows・完全ローカル）

ネットにつながらない Windows で、USB から動かすための一式。
**Python ごと同梱するので、PC 側には何も要らない**。インストールも管理者権限も不要。

### どれを USB に入れるのか

`usb-builder/` は**作るための道具**で、USB には入れない（app も Python も MediaPipe もそこには無い）。
USB に入れるのは `build.sh` が組み立てた**出力フォルダのほう**。

```
SourceCode/works/KanaDance/usb-builder/   ← 道具。USB には入れない
        │  build.sh が材料を集めて組み立てる
        ▼
~/Downloads/KanaDance-USB/                ← これをフォルダごと USB へ（約 45MB）
        KanaDance を起動.bat
        python/     app/     data/     server.py
```

### 作り方（Mac 側で1回）

```sh
cd KanaDance/usb-builder
./build.sh                      # → ~/Downloads/KanaDance-USB
./build.sh /Volumes/USB名/Kana  # 直接 USB へ
./build.sh --refresh-poses      # 登録済みポーズを取り直して上書き
./build.sh --no-python          # Python を同梱しない（PC 側に 3.7+ がある場合）
./build.sh --full               # 削らずに丸ごと入れる（約 45MB）
```

MediaPipe、Supabase の登録済みポーズ、埋め込み版 Python を同梱する。
**ここだけネットが要る**。出来上がりは約 20MB（`--full` なら約 45MB）。

### 何を削っているか

既定で、使わないものを落として約 17MB 減らしている。丸ごと欲しいときは `--full`。

| 削るもの | 大きさ | 理由 |
|---|---|---|
| `vision_wasm_nosimd_internal.*` | 8.4MB | SIMD の無い環境向けの控え。WASM SIMD は 2021 年以降の Chrome / Edge ならどれでも使える |
| `libcrypto-3.dll` / `libssl-3.dll` / `_ssl.pyd` / `_hashlib.pyd` | 6.0MB | HTTPS を使わない。`http.client` の `import ssl` は try/except の中なので無くても動く |
| `sqlite3.dll` / `_sqlite3.pyd` | 1.6MB | 一度も読まれない |
| `python.cat` / `pythonw.exe` | 0.6MB | 署名カタログと窓なし版。実行に要らない |
| `_bz2` / `_lzma` / `_decimal` / `pyexpat` / `_elementtree` ほか | 1.0MB | `shutil` が try/except で読むだけ、または未使用 |

さらに、大きいものは **`.gz` で置いて `Content-Encoding: gzip` で返す**。
ブラウザが透過的に展開するので、アプリ側のコードは何も変わらない。

| ファイル | 圧縮後 |
|---|---|
| `vision_wasm_internal.wasm` | 8.29 → **2.53MB**（69%減） |
| `vision_bundle.mjs` | 0.84 → **0.11MB**（87%減） |
| `vision_wasm_internal.js` | 0.20 → **0.05MB**（75%減） |
| `pose_landmarker_lite.task` | 5.51 → **4.73MB**（14%減。float16 の重みなのであまり縮まない） |

gzip を受け付けない相手（まず無い）には、サーバがその場で展開して返す。

これ以上を望むなら、残るのは MediaPipe 約 7.5MB と Python 約 12MB。
Python を外せば 4MB 台になるが、PC 側に Python が要る。モデルは既に `lite`（最小版）。

削除対象をすべて import 不能にした状態で `server.py` を通しで動かし、
起動・配信・`GET`／`POST`・MIME まで問題なく動くことを確認してある。

もし古い PC で「姿勢推定モデルを読み込めません」と出たら、SIMD 無しの可能性がある。
`--full` で作り直せば元に戻る。
出来上がったフォルダごと USB にコピーすれば、Windows 側は何も要らない。

既にある `data/poses.json` は壊さない（Windows で登録したぶんが消えるため）。
取り直したいときだけ `--refresh-poses`。

### 分けてコピーしても動く

置き場所を選ばない。`server.py` は自分のいる場所を基準に `app/` と `data/` を探し
（`os.path.dirname(os.path.abspath(__file__))`）、アプリ側も `./vendor/...` の相対パスだけ。
ドライブレターもフォルダ名も問わないので、USB から PC のローカルへ移しても、
フォルダ単位で何回かに分けてコピーしても構わない。次の5つが横並びに揃っていればよい。

```
好きな名前のフォルダ/
  KanaDance を起動.bat   server.py   python/   app/   data/
```

**分割 ZIP（`.z01` / `.zip.001`）は避ける。** Windows 標準の展開機能で開けず、
解凍ソフトのインストールが要る＝「インストールなし」の前提が崩れる。

分けて運ぶと1つ抜けたり途中で切れたりしやすいので、`manifest.json`（全ファイルとサイズ）を
同梱し、**`server.py` が起動時に突き合わせて名指しで知らせる**。
実際、ビルド中に wasm が 8,516,982 / 8,689,767 バイトで切れたまま
「ファイルがあるので済」と判定されかけたことがあり、その対策でもある。

PC 側で動かすと、登録したポーズは**そのPCの `data/poses.json`** に貯まる。
USB へ戻したいときはそのファイルだけコピーする。

### 使い方（Windows 側）

`KanaDance を起動.bat` をダブルクリックするだけ。ブラウザが自動で開く。
登録したポーズは USB 上の `data/poses.json` に貯まるので、別の PC に差してもそのまま使える。

### 差し替えているのは1ファイルだけ

環境依存は `runtime-config.js` に集約してある。USB 版はこれを
`usb-builder/runtime-config.local.js` に差し替えるだけで、本体のコードは同じものを使う。

| | Mac（通常） | USB（ローカル） |
|---|---|---|
| ポーズの保存 | Supabase | 同梱 Python サーバ → `data/poses.json` |
| MediaPipe | CDN | 同梱 `app/vendor/` |
| 保存の実装 | `store-supabase.js` | `store-local.js` |

`pose-store.js` が `backend` を見て**使うほうだけを動的 import する**ので、
ローカル版では Supabase クライアントを CDN に取りに行かない
（静的 import にすると、ネットの無い環境で読み込みが止まる）。

### Python を同梱している理由

現場の PC に Python が入っていないことがある（IronPython 2.7 のような
**Python 2 系の別実装**しか無い、という場合も）。

python.org の **embeddable package** は「インストーラ」ではなく**ただの ZIP** で、
展開して `python.exe` を直接叩けば動く。レジストリも PATH も触らず、管理者権限も要らない。
VC++ ランタイム（`vcruntime140.dll`）も中に入っているので別途インストールも不要。

`.bat` は次の順に Python を探す。

1. 同梱の `python\python.exe`（PATH も Microsoft Store も関係ないので一番確実）
2. PATH の `py` / `python` / `python3`
3. `%LOCALAPPDATA%\Programs\Python` などのよくある場所

どの候補も `sys.version_info >= (3,7)` を満たすか実際に実行して確かめる。
これで、**Python 未導入の PC にある Microsoft Store のダミー `python.exe`** も、
**IronPython 2.7** も自動的に弾かれる。

### Windows で踏みやすい点

- **`python -m http.server` は使わない。** Windows の Python は MIME をレジストリから
  引くため、`.js` が `text/plain` で返って ES モジュールの実行が拒否されることがある。
  同梱の `server.py` は拡張子→MIME を自前で固定してこれを防いでいる
- コンソールの既定が cp932 だと日本語の print で落ちるので、
  `.bat` で `PYTHONIOENCODING=utf-8`、`server.py` 側でも `errors="replace"` にしてある
- `py` / `python` / `python3` のどれで通るかは環境次第なので、`.bat` が順に試す
- 待ち受けは `127.0.0.1` のみ。同じ LAN の他の端末からは見えない
- カメラは `http://localhost` なら使える（secure context 扱い）

## ファイル構成

```
sumi-tokens.css … sumi デザイントークン（同梱コピー・light/dark）
style.css       … 画面スタイル（sumi トークン参照。sumi-tokens.css の後に読み込む）
config.js       … 作品の調整値（映像サイズ・映像の濃さ・しきい値・部位番号・線記述・ブレンド既定値）
runtime-config.js … 実行環境の設定（保存先・MediaPipe の取得元・Supabase 接続）※USB 版はここだけ差し替え
pose-store.js   … 保存先を選ぶだけの層（backend を見て下の2つに振り分ける）
store-supabase.js … Supabase への保存／読み込み
store-local.js  … 同梱 Python サーバへの保存／読み込み
usb-builder/    … USB 版を作るための道具（build.sh・server.py・起動 .bat）※USB には入れない
pose-matcher.js … 正規化・照合・線トークンの解決（純粋関数）
pose-history.js … 直近数秒のポーズを溜め、等間隔の鍵フレームを補間して取り出す
renderer.js     … canvas 描画（ブレンドの重ね書き・関節点・巨大文字・墨色のテーマ追従）
ui.js           … DOM の取り回し（sumi UI：状態表示・モード・スライダー・テーマ切替）
script.js       … 本体（初期化と描画ループ。上の 5 つを繋ぐだけ）
```

## UI（sumi デザインシステム）

見た目は `sumi` デザインシステム（`CLdev/sumi-ui`）の墨基調トークンに準拠。
`sumi-tokens.css`（`CLdev/sumi-ui/src/styles/tokens.css` の同梱コピー）を読み込み、
色はすべて `--color-*` セマンティックトークン参照。書体は ZEN Interface（未読込時は system-ui）。
canvas の墨色も `--color-accent-strong` から取るので、テーマ切替で線が反転する。
※ sumi 側を更新したら `sumi-tokens.css` を再コピーして同期すること。

## メモ

- `SUPABASE.anonKey` は「クライアント埋め込み前提」の**公開キー**。
  データ保護は Supabase の Row Level Security(RLS) 側で行うこと。
- `_legacy_backup_2026-07-16/` に旧コードを退避（不要なら削除可）。
