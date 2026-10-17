#!/bin/bash
# ============================================================
#  build.sh — USB 版を組み立てる（Mac 側で1回やる作業）
#
#  ※ このフォルダ（usb-builder/）自体は USB に入れない。
#    ここにあるのは材料と手順書で、app も Python も MediaPipe も無い。
#    USB に入れるのは、下で組み立てられる出力フォルダのほう。
#
#    ./build.sh                      → ~/Downloads/KanaDance-USB へ
#    ./build.sh /Volumes/USB名/Kana  → 直接 USB へ
#    ./build.sh --refresh-poses      → 登録済みポーズを取り直して上書き
#    ./build.sh --no-python          → Python を同梱しない（PC 側に入っている場合）
#    ./build.sh --full               → 削らずに丸ごと入れる（約 45MB）
#
#  やること:
#    1. KanaDance 一式を app/ へコピー
#    2. runtime-config.js をローカル版に差し替え
#    3. MediaPipe を vendor/ へダウンロード（ここだけネットが要る）
#    4. Supabase の登録済みポーズを data/poses.json へ書き出し
#    5. 埋め込み版 Python を同梱（インストーラではなく ZIP を展開するだけ）
#    6. server.py と起動用 .bat を置く
#  出来上がったフォルダごと USB に入れれば、Windows 側は何も要らない。
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(dirname "$HERE")"                       # KanaDance 本体

REFRESH_POSES=0
WITH_PYTHON=1
SLIM=1
OUT=""
for arg in "$@"; do
  case "$arg" in
    --refresh-poses) REFRESH_POSES=1 ;;
    --no-python)     WITH_PYTHON=0 ;;
    --with-python)   WITH_PYTHON=1 ;;
    --full)          SLIM=0 ;;
    --slim)          SLIM=1 ;;
    *) OUT="$arg" ;;
  esac
done
OUT="${OUT:-$HOME/Downloads/KanaDance-USB}"

VISION_VER="0.10.3"
# 64bit Windows 向け。32bit の PC なら amd64 を win32 に変える
PY_EMBED_VER="3.12.7"
CDN="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VER}"
MODEL_URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"

echo "組み立て先: $OUT"
mkdir -p "$OUT/app/vendor/tasks-vision/wasm" "$OUT/app/vendor/models" "$OUT/data"

# ── 1. 本体をコピー（開発用のものは持っていかない）──────────
echo "[1/6] KanaDance をコピー"
for f in index.html style.css sumi-tokens.css config.js pose-matcher.js pose-history.js \
         renderer.js ui.js script.js pose-store.js store-local.js; do
  cp "$SRC/$f" "$OUT/app/$f"
done
# store-supabase.js は入れない。ローカル版では読まれないうえ、
# 置いておくと「ネットに出る経路が残っている」と誤解のもとになる

# ── 2. 環境設定をローカル版に差し替え ──────────────────────
echo "[2/6] runtime-config.js をローカル版に"
cp "$HERE/runtime-config.local.js" "$OUT/app/runtime-config.js"

# ── 3. MediaPipe を同梱（ここだけネットが要る）──────────────
echo "[3/6] MediaPipe をダウンロード（約 23MB）"
# url dest — 途中で切れたファイルを掴まないよう、.part に落としてから置き換える。
# 一度でも中途半端なものが残ると、次回「済」と判断されて壊れたまま出荷されてしまう。
fetch() {
  local url="$1" dest="$2" name
  name="$(basename "$dest")"

  # 前回の圧縮済み（.gz）があるなら、それで足りているので取りに行かない
  if [ -s "$dest.gz" ] && [ "$SLIM" = "1" ]; then
    echo "      済: $name（圧縮済み）"
    return 0
  fi

  if [ -s "$dest" ]; then
    # 完成品として置いてあるものは、相手のサイズが分かる場合だけ突き合わせる
    local remote local_size
    remote=$(curl -fsSLI -m 60 "$url" 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}' | tail -1)
    local_size=$(wc -c < "$dest" | tr -d ' ')
    if [ -z "$remote" ] || [ "$remote" = "$local_size" ]; then
      echo "      済: $name"
      return 0
    fi
    echo "      取り直し: $name（$local_size / $remote バイト）"
    rm -f "$dest"
  fi

  echo "      取得: $name"
  # 細い回線でも落ちないよう、再試行と再開を効かせる
  if ! curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors -C - \
        --connect-timeout 30 -m 900 -o "$dest.part" "$url"; then
    rm -f "$dest.part"
    echo "      ✗ $name を取得できませんでした"
    return 1
  fi
  mv "$dest.part" "$dest"
}
fetch "$CDN/vision_bundle.mjs"                 "$OUT/app/vendor/tasks-vision/vision_bundle.mjs"
fetch "$CDN/wasm/vision_wasm_internal.js"      "$OUT/app/vendor/tasks-vision/wasm/vision_wasm_internal.js"
fetch "$CDN/wasm/vision_wasm_internal.wasm"    "$OUT/app/vendor/tasks-vision/wasm/vision_wasm_internal.wasm"
# SIMD の無い環境向けの控え（8.4MB）。WASM SIMD は 2021年以降の Chrome / Edge なら
# どれでも使えるので既定では入れない。古い環境用に残すなら --full。
if [ "$SLIM" = "0" ]; then
  fetch "$CDN/wasm/vision_wasm_nosimd_internal.js"   "$OUT/app/vendor/tasks-vision/wasm/vision_wasm_nosimd_internal.js"
  fetch "$CDN/wasm/vision_wasm_nosimd_internal.wasm" "$OUT/app/vendor/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm"
else
  rm -f "$OUT/app/vendor/tasks-vision/wasm/vision_wasm_nosimd_internal."*
fi
fetch "$MODEL_URL"                             "$OUT/app/vendor/models/pose_landmarker_lite.task"

# ── 4. 登録済みポーズを持ち込む ────────────────────────────
# 空のまま持っていくと判別モードが使えないので、Supabase の中身を書き出す。
# 既にある poses.json は壊さない（Windows 側で登録したぶんが消えるため）。
POSES="$OUT/data/poses.json"
if [ "$REFRESH_POSES" = "1" ] || [ ! -s "$POSES" ] || [ "$(cat "$POSES")" = "[]" ]; then
  echo "[4/6] 登録済みポーズを書き出し"
  CREDS=$(python3 - "$SRC/runtime-config.js" <<'PYEOF'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
block = s[s.index('supabase:'):]
url = re.search(r"url:\s*'([^']+)'", block).group(1)
key = re.search(r"anonKey:\s*'([^']+)'", block).group(1)
print(url); print(key)
PYEOF
)
  SB_URL=$(echo "$CREDS" | sed -n 1p)
  SB_KEY=$(echo "$CREDS" | sed -n 2p)
  if curl -fsSL -m 60 -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" \
       "$SB_URL/rest/v1/poses?select=letter,points,lines" -o "$POSES.new"; then
    python3 -c "
import json, sys
rows = json.load(open(sys.argv[1], encoding='utf-8'))
json.dump(rows, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('      %d 件（%s）' % (len(rows), ''.join(sorted({r['letter'] for r in rows}))))
" "$POSES.new" "$POSES"
    rm -f "$POSES.new"
  else
    echo "      取得できませんでした（ネットに出られない環境？）。空のまま進めます"
    rm -f "$POSES.new"
    [ -s "$POSES" ] || echo "[]" > "$POSES"
  fi
else
  echo "[4/6] poses.json は既にあるので触りません（取り直すなら --refresh-poses）"
fi

# ── 5. Python を同梱 ───────────────────────────────────────
# python.org の「embeddable package」は**インストーラではなく ZIP**。
# 展開して python.exe を直接叩くだけで動き、管理者権限もレジストリも要らない。
# VC++ ランタイム（vcruntime140.dll）も中に入っているので別途インストール不要。
if [ "$WITH_PYTHON" = "1" ]; then
  if [ -f "$OUT/python/python.exe" ]; then
    echo "[5/6] Python は同梱済み"
  else
    echo "[5/6] 埋め込み版 Python を同梱（約 11MB）"
    PY_ZIP="$OUT/.python-embed.zip"
    # 本体と同じく、再試行・再開つきで取る（細い回線だと 11MB でも落ちる）
    if fetch "https://www.python.org/ftp/python/${PY_EMBED_VER}/python-${PY_EMBED_VER}-embed-amd64.zip" "$PY_ZIP"; then
      mkdir -p "$OUT/python"
      unzip -oq "$PY_ZIP" -d "$OUT/python"
      echo "      展開しました（python/python.exe）"
    else
      echo "      取得できませんでした。PC 側の Python を使う前提で進めます"
    fi
    rm -f "$PY_ZIP"
  fi

  # server.py が使わないものを落とす。
  #   ssl   … http.client が try/except で読むだけ。HTTPS は使わない
  #   bz2/lzma … shutil が try/except で読むだけ
  #   sqlite3 / decimal / expat / zoneinfo 等 … 一度も読まれない
  # どれも「無ければ無いで動く」形で書かれていることを確認済み。
  if [ "$SLIM" = "1" ] && [ -d "$OUT/python" ]; then
    BEFORE=$(du -sk "$OUT/python" | cut -f1)
    for f in \
      libcrypto-3.dll libssl-3.dll _ssl.pyd _hashlib.pyd \
      sqlite3.dll _sqlite3.pyd \
      _bz2.pyd _lzma.pyd \
      _decimal.pyd pyexpat.pyd _elementtree.pyd \
      _msi.pyd _wmi.pyd winsound.pyd _zoneinfo.pyd \
      python.cat pythonw.exe ; do
      rm -f "$OUT/python/$f"
    done
    AFTER=$(du -sk "$OUT/python" | cut -f1)
    echo "      使わない物を削除（$(( (BEFORE - AFTER) / 1024 ))MB 減）"
  fi
else
  echo "[5/6] Python は同梱しません（--no-python）"
fi

# ── 5.5 大きいものを圧縮して置く ────────────────────────────
# サーバが Content-Encoding: gzip を付けて返すので、ブラウザ側は何も変わらない。
# wasm は 8.3MB → 2.5MB、bundle は 0.84MB → 0.11MB になる。
if [ "$SLIM" = "1" ]; then
  PACKED=0
  for f in \
    "$OUT/app/vendor/tasks-vision/wasm/vision_wasm_internal.wasm" \
    "$OUT/app/vendor/tasks-vision/wasm/vision_wasm_internal.js" \
    "$OUT/app/vendor/tasks-vision/vision_bundle.mjs" \
    "$OUT/app/vendor/models/pose_landmarker_lite.task" ; do
    if [ -f "$f" ]; then
      gzip -9 -c "$f" > "$f.gz" && rm -f "$f"
      PACKED=$((PACKED + 1))
    fi
  done
  [ "$PACKED" -gt 0 ] && echo "      $PACKED 個を圧縮して置いた（配信時に展開される）"
else
  # --full のときは圧縮を戻す（素のファイルで置く）
  for f in "$OUT/app/vendor"/*/*.gz "$OUT/app/vendor"/*/*/*.gz; do
    [ -f "$f" ] && gzip -d "$f"
  done
fi

# ── 6. 起動まわり ──────────────────────────────────────────
echo "[6/6] サーバと起動ファイル"
cp "$HERE/server.py" "$OUT/server.py"
cp "$HERE/KanaDance を起動.bat" "$OUT/KanaDance を起動.bat"
cp "$HERE/README_USB.txt" "$OUT/はじめにお読みください.txt"

# ── 7. コピー漏れを見つけるための一覧 ──────────────────────
# フォルダを分けてコピーすると1つ抜けたり途中で切れたりしやすい。
# server.py が起動時にこの一覧と突き合わせて、名指しで知らせる。
python3 - "$OUT" <<'PYEOF'
import json, os, sys
root = sys.argv[1]
manifest = {}
for base, dirs, files in os.walk(root):
    dirs[:] = [d for d in dirs if d not in ('data', '__pycache__')]
    for name in files:
        if name in ('manifest.json',) or name.startswith('.'):
            continue
        full = os.path.join(base, name)
        rel = os.path.relpath(full, root).replace(os.sep, '/')
        manifest[rel] = os.path.getsize(full)
with open(os.path.join(root, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1, sort_keys=True)
print('      一覧を作成（%d ファイル）' % len(manifest))
PYEOF


SIZE=$(du -sh "$OUT" | cut -f1)
echo
echo "────────────────────────────────────────────────"
echo "  できました（$SIZE）"
echo "    $OUT"
echo
echo "  USB に入れるのは、いま出来た↑このフォルダです。"
echo "  中身だけでなく、フォルダごとコピーしてください。"
echo "  （usb-builder/ のほうは道具なので USB には入れません）"
echo
echo "  Windows では中の「KanaDance を起動.bat」をダブルクリック。"
echo "────────────────────────────────────────────────"
