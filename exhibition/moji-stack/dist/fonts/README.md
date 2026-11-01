# フォントの置き場所

このフォルダに `.ttf` / `.otf` を置き、`src/fonts.js` の `FONTS` に
`{ label, url }` を追加すると、書体セレクタに出てきます。

> ⚠️ `woff2` はブラウザ内で展開（brotli 解凍）できないため使えません。
> 必ず **.ttf または .otf** を置いてください。

## 推奨（無料・日本語対応）

[Google Fonts](https://fonts.google.com/) から ZIP をダウンロードすると `.ttf` が入っています。
`src/fonts.js` の初期設定は以下のファイル名を想定しています：

| 書体 | 置くファイル名 | Google Fonts |
|---|---|---|
| Zen Maru Gothic | `ZenMaruGothic-Regular.ttf` | https://fonts.google.com/specimen/Zen+Maru+Gothic |
| Shippori Mincho | `ShipporiMincho-Regular.ttf` | https://fonts.google.com/specimen/Shippori+Mincho |
| Yuji Syuku | `YujiSyuku-Regular.ttf` | https://fonts.google.com/specimen/Yuji+Syuku |
| Dela Gothic One | `DelaGothicOne-Regular.ttf` | https://fonts.google.com/specimen/Dela+Gothic+One |

ダウンロードしたファイル名が違う場合は、リネームするか `src/fonts.js` の `url` を合わせてください。
1 つでも置けば動きます（足りない書体はセレクタで選んだ時にエラー表示されます）。
