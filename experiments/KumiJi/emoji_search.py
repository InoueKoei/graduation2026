#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# KumiJi — OS の絵文字を日本語で検索する
#   手書きの辞書を持たない。macOS が絵文字ピッカーの検索に使っている索引を
#   そのまま読む。だから語彙は OS が持っているものそのままで、こちらが
#   選んだ語ではない。
#
#   出どころ:
#     /System/Library/PrivateFrameworks/CoreEmoji.framework/.../ja.lproj/
#       term_index.plist      日本語の検索語 22,625件 → 文書ID
#       document_index.plist  文書ID → その絵文字に結び付く語の集合
#       AppleName.strings     絵文字 → 日本語名
#       Voiceover.strings     絵文字 → 読み上げ用の名前
#       TextToSpeech.stringsdict
#
#   文書ID から絵文字への直接の表は私有バイナリ（emoji.dat）にあり、
#   フォーマットが不明。代わりに **名前の突き合わせ**で解決している
#   （文書の語の中に、どれかの絵文字の名前が現れることを利用する）。
#   実測 1,399 / 1,878 の文書に絵文字が付き、2字のかなの検索語は 92% が解決した。
#
#   検索は 完全一致 → 前方一致 → 部分一致 の順に落とす。
#
# 使い方:
#   import emoji_search
#   emoji_search.search("うし")      # → ['🐮', '🐂', '🐄']
#
#   索引は初回に組んで JSON に保存する（数秒）。次回からは読み込むだけ。
# -----------------------------------------------------------------------------
import os
import re
import json
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "_emoji_index.json")

CORE = ("/System/Library/PrivateFrameworks/CoreEmoji.framework"
        "/Versions/A/Resources")

_index = None          # {"terms": {語: [絵文字...]}, "names": {絵文字: 名前}}


def _plist(path):
    """plist を JSON として読む。plutil は macOS に必ず入っている。"""
    if not os.path.exists(path):
        return None
    try:
        out = subprocess.run(["plutil", "-convert", "json", "-o", "-", path],
                             capture_output=True, timeout=60)
        if out.returncode != 0:
            return None
        return json.loads(out.stdout)
    except Exception:
        return None


def build_index(lang="ja"):
    """CoreEmoji の索引から「語 → 絵文字」を組み立てる。"""
    base = os.path.join(CORE, f"{lang}.lproj")
    term = _plist(os.path.join(base, "term_index.plist"))
    doc = _plist(os.path.join(base, "document_index.plist"))
    if not term or not doc:
        return {"terms": {}, "names": {}}

    # 名前の出どころを複数集める。多い方が文書との突き合わせが当たる。
    # ただし TTS などには `UnicodeHex.e52e` のような絵文字でないキーが混ざる。
    emoji_ch = re.compile(
        "[\U0001F000-\U0001FAFF\u2190-\u2BFF\u2600-\u27BF"
        "\u3030\u303D\u3297\u3299\uFE0F\u24C2\u00A9\u00AE]")
    def is_emoji(k):
        return bool(k) and len(k) <= 12 and bool(emoji_ch.search(k))

    byname, names = {}, {}
    for fn in ("AppleName.strings", "Voiceover.strings",
               "TextToSpeech.stringsdict"):
        d = _plist(os.path.join(base, fn))
        if not isinstance(d, dict):
            continue
        for emoji, label in d.items():
            if not isinstance(label, str) or not label or not is_emoji(emoji):
                continue
            names.setdefault(emoji, label)
            # 「下弦の月（顔付き）」のような括弧書きを落とした形も引けるように
            for cand in {label, re.sub(r"（.*?）", "", label).strip()}:
                if cand:
                    byname.setdefault(cand, emoji)

    # 文書ID → 絵文字。文書の語に名前が現れるものを拾う。
    id2emoji = {}
    for did, terms in doc.items():
        for t in terms:
            e = byname.get(t)
            if e:
                id2emoji[did] = e
                break

    # 語 → 絵文字（順番は索引の重み順をそのまま活かす）
    terms = {}
    for word, ids in term.items():
        got = []
        for i in ids:
            e = id2emoji.get(str(i))
            if e and e not in got:
                got.append(e)
        if got:
            terms[word] = got

    return {"terms": terms, "names": names}


def load(rebuild=False):
    """索引を読む。無ければ組んで保存する。"""
    global _index
    if _index is not None and not rebuild:
        return _index
    if not rebuild and os.path.exists(CACHE):
        try:
            with open(CACHE, encoding="utf-8") as f:
                _index = json.load(f)
            return _index
        except Exception:
            pass
    _index = build_index()
    try:
        with open(CACHE, "w", encoding="utf-8") as f:
            json.dump(_index, f, ensure_ascii=False)
    except Exception:
        pass
    return _index


def search(query, limit=12):
    """日本語で絵文字を引く。完全一致 → 前方一致 → 部分一致 の順。

    OS が持っている語彙で引くので、こちらが選んだ語ではない。
    ヒットが複数あるのが普通で、それをそのまま返す。
    """
    q = (query or "").strip()
    if not q:
        return []
    idx = load()
    terms = idx.get("terms", {})

    def dedupe(lst):
        out = []
        for e in lst:
            if e not in out:
                out.append(e)
        return out[:limit]

    # 段階を跨がない。完全一致が1つでもあれば、それだけを返す。
    # 跨ぐと「うし」に「うしろ」由来の絵文字が混ざって薄まる。
    exact = terms.get(q, [])
    if exact:
        return dedupe(exact)

    pref = []
    for t, es in terms.items():
        if t.startswith(q):
            pref += es
            if len(set(pref)) >= limit:
                break
    if pref:
        return dedupe(pref)

    part = []
    for t, es in terms.items():
        if q in t:
            part += es
            if len(set(part)) >= limit:
                break
    return dedupe(part)


def name_of(emoji):
    """絵文字の日本語名。無ければ空。"""
    return load().get("names", {}).get(emoji, "")


if __name__ == "__main__":
    import sys
    idx = load(rebuild="--rebuild" in sys.argv)
    print(f"検索語 {len(idx['terms'])}件 / 名前 {len(idx['names'])}件")
    for q in sys.argv[1:]:
        if q.startswith("--"):
            continue
        r = search(q)
        print(f"  {q} → {''.join(r) or '（なし）'}")
