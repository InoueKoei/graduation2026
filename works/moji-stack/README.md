# 文字を積む / moji-stack

入力した 1 文字がオブジェクトとして上から落下し、皿の上に重力で積もっていく
インタラクティブコンテンツ。文字は引っかかったり、崩れて落ちたりする。

## セットアップ

```bash
cd moji-stack
npm install          # 依存をダウンロード（matter-js / opentype.js / poly-decomp / vite）
# フォントを public/fonts/ に置く（public/fonts/README.md 参照）
npm run dev          # 開発サーバ起動 → 表示された http://localhost:5173 を開く
```

ビルドする場合: `npm run build` → `npm run preview`

> ⚠️ **必ず Vite 開発サーバ（`npm run dev` の URL）で開くこと。**
> `index.html` を直接開いたり、VS Code の Live Preview など素の静的配信で開くと、
> `import 'matter-js'` などの**裸の import が解決できず `main.js` が動かない**
> （書体セレクタが空になる）。バンドラ経由が必須。

## 操作

- **書体セレクタ**: ファミリーを選ぶ（バンドル＋追加したデスクトップ書体）
- **ウェイトセレクタ**: 選んだファミリーのウェイト／スタイルを切替
- **デスクトップ書体**: クリックすると、インストール済みの書体を書体セレクタに
  「デスクトップ書体」グループとして追加する。
  ※ Local Font Access API を使うため **Chrome / Edge 限定**で、初回は**許可ダイアログ**が出る
  （Safari / Firefox は非対応。`.ttc` などコレクション形式は読めない場合がある）。
- **サイズ**: これから落とす文字の大きさ（既に積まれた文字はそのまま）
- **入力欄**: 一文字入れて **Enter** で確定 → 上から落下
- **リセット**: 積まれた文字を全消去

## 技術スタックと考え方

| 役割 | ライブラリ | 補足 |
|---|---|---|
| 物理演算（重力・衝突・積み重なり） | [matter-js](https://brm.io/matter-js/) | 2D 剛体。`Bodies.fromVertices` で任意形状を生成 |
| 凹形状の凸分割 | [poly-decomp](https://github.com/schteppe/poly-decomp.js) | 「あ」「く」等の凹みを衝突判定可能な形に分解（matter が内部利用） |
| 字形のベクター化 | [opentype.js](https://opentype.js.org/) | フォントファイルから 1 文字の輪郭(アウトライン)を取得 |
| バンドラ / 開発サーバ | [Vite](https://vitejs.dev/) | ES Modules + npm 依存 |

### レンダリング設計（フォントの将来拡張を見据えて）

文字は **その場でベクター（アウトライン）を生成** している。

1. `opentype.js` でフォントファイルを読み、`charToGlyph(char).getPath()` で字形パスを取得
2. ベジェ曲線を折れ線に近似し、輪郭(contour)の点列にする（`src/glyph.js`）
3. その点列を `matter-js` の `Bodies.fromVertices` に渡して物理ボディ化
4. 描画は物理ボディの凸分割形ではなく、**本物のグリフ輪郭**を `Path2D` で塗る
   （`evenodd` で「あ」などの穴も正しく抜ける）

この経路は **フォントファイルさえあれば成立**するため、Web フォント非依存。
将来「デスクトップから書体を選ぶ」機能は、選んだファイルを `ArrayBuffer` として読み、
`loadFont(arrayBuffer)` に渡すだけで同じパイプラインに乗る（`src/glyph.js` 参照）。

### 「か」が分離しない仕組み

1 グリフが複数のストローク（複数 contour）に分かれていても、それらを **まとめて 1 つの
`fromVertices` 呼び出し** に渡すことで 1 つの複合ボディ(compound body)になる。
各 contour は内部で凸分割されるが、剛体としては一体で動くため、点と本体が
バラバラに落ちることはない。

## ファイル構成

```
moji-stack/
├─ index.html          UI のマークアップ
├─ src/
│  ├─ main.js          エントリ。UI とシーンの接続
│  ├─ scene.js         物理シーン + キャンバス描画
│  ├─ glyph.js         書体読み込み・文字→ベクター→頂点変換
│  ├─ fonts.js         書体マニフェスト
│  └─ style.css        スタイル（Sumi モノクロ基調）
└─ public/fonts/       フォントファイル（.ttf / .otf）を置く
```
