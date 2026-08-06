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

## 線の記述（一筆書き）

`config.js` の `DEFAULT_KANA_LINES` に既定を持つ。DB 側に `lines` があればそちらを優先。

| 記法 | 意味 |
|---|---|
| `LH-RH` | 左手 → 右手 を結ぶ |
| `[LH_RH]-W` | 左手と右手の**中点** → 腰 |
| `RE-RK-RL` | 右肘 → 右膝 → 右足（連続線） |

略語は `config.js` の `SHORTCUTS`（H=頭, W=腰, L/R + H/E/K/L=手/肘/膝/足）。

## ファイル構成

```
config.js        … 設定（映像サイズ・しきい値・部位番号・線記述・Supabase 接続）
pose-store.js    … Supabase への保存／読み込み
pose-matcher.js  … 正規化・照合・線トークンの座標解決（純粋関数）
script.js        … 本体（カメラ・描画・モード切替）
```

## メモ

- `SUPABASE.anonKey` は「クライアント埋め込み前提」の**公開キー**。
  データ保護は Supabase の Row Level Security(RLS) 側で行うこと。
- `_legacy_backup_2026-07-16/` に旧コードを退避（不要なら削除可）。
