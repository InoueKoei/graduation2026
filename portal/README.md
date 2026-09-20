# 制作ポータル

`works/` の作品を 1 か所から開くためのローカル・ランチャー。
ゼミや展示で「この作品を出して」と言われたときの入口。

## 起動

依存パッケージなし。Node があれば動く。

```sh
node SourceCode/portal/server.js
# → http://localhost:8080/
```

Ctrl-C で、ポータルから起動した作品もまとめて終了する。

## 作品側には触っていない

このポータルは `works/` のコードを 1 行も変えずに動く。壊れても作品は無傷。

- **静的5件**は参照がすべて相対パスなので、`/w/<slug>/` から配信すればそのまま動く
- **vite 3件**は `node_modules/.bin/vite --port <N>` を直接叩く。
  npm script 経由だと `moji-korogashi` の `dev`（`vite --port 5174`）と
  `EasyReta` の `vite.config.js`（`port: 5174, strictPort: true`）が衝突するため
- **node 2件**は `PORT` 環境変数を渡す（`nfc-reader-mvp` は `server.js` 内で 3000 固定）

## 3つの動かし方

| kind | 作品 | 方式 |
|---|---|---|
| `static` | KanaDance / Sessan / 活字パズル / からだと組版 / 母音子音 | ポータルが `/w/<slug>/` から直接配信 |
| `vite` | 文字を積む / EasyReta / 文字ころがし | vite を子プロセス起動し、そのポートへ |
| `node` | 文字運び / 「な」しかないカルタ | `server.js` を子プロセス起動し、そのポートへ |

### ポート

ポータルが一元管理する。各作品の `package.json` や `vite.config.js` とは無関係。

| ポート | 用途 |
|---|---|
| 8080 | ポータル本体 |
| 5173 / 5174 / 5175 | 文字を積む / EasyReta / 文字ころがし |
| 3100 | 文字運び |
| 3000 | 「な」しかないカルタ（作品側で固定） |

## 中継せず、リダイレクトする

子プロセスの作品へは**リダイレクト**で飛ばす。ポータルは通信を中継しない。

- 文字運びは RFC6455 を手書きした WebSocket、カルタは SSE、vite は HMR の WebSocket を使う。
  これらを依存ゼロのサーバで正しくプロキシするのは重く、壊れやすい
- リダイレクトなら各作品が**自分のオリジン**で動くので、
  カメラ・WebSerial の secure context（localhost）も満たす

代償として、開いた先の URL はポータルから離れる。作品側に戻るリンクは足していない。

## 別端末から繋ぐ作品

文字運び（二人）とカルタ（iPhone）は、同じ Wi-Fi の別端末から開く必要がある。
その URL は**子プロセスの標準出力**に出るので、カードの「ログ」を開いて読む。
ポータル側で IP を計算し直してはいない。

## 停止は SIGINT

`works/MojiHakobi/server.js` は SIGINT を受けて研究ログに `session_end` を書いてから閉じる。
強制終了するとログが壊れるので、停止ボタンもポータル終了時も SIGINT を送る。

## ファイル構成

```
server.js          … HTTP・静的配信・子プロセス管理
works.js           … 作品10件の定義（作品を足す/外すときはここだけ）
public/
  index.html       … カタログ画面
  portal.js        … 一覧・起動/停止・ログ表示
  style.css        … 画面スタイル（sumi トークン参照）
  sumi-tokens.css  … sumi デザイントークン（works/Sessan からの同梱コピー）
```

## メモ

- 収録は `works/` の10件のみ。`experiments/` と Arduino スケッチ（`cores3_*` 等 14 件）は入れていない
- オフライン対応はしていない。KanaDance / Sessan / 活字パズル / からだと組版 は
  MediaPipe・OpenCV・Google Fonts を CDN から読むので、ネットが無いと動かない
- WebSerial（文字ころがし）は Chrome のみ
- ポートが既に使われている作品は起動を断る（別で立ち上げっぱなしのときの二重起動防止）
- vite は `[::1]` にしか bind しないため、起動判定の疎通確認は `127.0.0.1` ではなく `localhost` で行う
