# HeadKana — 展示版

`HeadKana-gestures/site-lcd/dist`（2026-11-01 時点の最新 Web 版）をそのまま写したもの。
元のサイトはドメイン直下で配る前提で `/app.js` のような絶対パスだったので、
Pages のサブパスで動くよう `index.html` `output.html` `dial-custom.css` `dial-custom.js` `app.js` のパスを相対に直した。中身は変えていない。

- 入力画面：`index.html` ／ 文字だけの別タブ：`output.html`
- ファームウェア（RP2040-Zero ダイヤル・CoreS3）：`firmware/`。仕様と配線は `firmware/README.md`、BLE は `firmware/BLE_PROTOCOL.md`
