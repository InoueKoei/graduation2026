#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# KumiJi — 認識部
#   組み上がったマスクを受け取り (文字, スコア) を返す。ここが唯一の認識の入口。
#
#   実装は2つ用意して config.py の1行で切り替える。どちらが正しいかは議論ではなく
#   測定で決めるため、差し替えが1行で済む形にしてある。
#
#     recognize_vision()  macOS 純正の日本語OCR（Vision framework）
#     recognize_iou()     参照字形との IoU（未実装。OCRが駄目なときの差し替え先）
#
#   IoU 版を持つ理由は保険だけではない。OCR は「ラベル」しか返さないが、IoU は
#   「規格からどれだけ遠いか」という距離を返す。考察を書く段でこの数値が効く。
#
# 使い方:
#   pip3 install --user pyobjc-framework-Vision
# -----------------------------------------------------------------------------
import os
import tempfile

import cv2
import numpy as np


# --- マスク → OCR に渡せる清書画像 -------------------------------------------
def render_for_ocr(mask, out_w=1024, out_h=384, margin_ratio=0.08):
    """部品のマスクを「白地に黒」の清書画像に描き直す。

    カメラの歪み・照明ムラ・画面のざらつきを OCR に持ち込まないための工程。

    キャンバスを **横長** にしているのは実測の結果。Vision は「テキスト行」を
    探す設計なので、正方形の中に1文字だけ置くと検出条件に合わず読まれない。
    同じ字で比べて 正方512 = 1/6 に対し 横長1024x384 = 4/6 まで上がった。
    """
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None

    crop = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = crop.shape

    s = min(out_w * (1 - margin_ratio * 2) / w,
            out_h * (1 - margin_ratio * 2) / h)
    rw, rh = max(1, int(w * s)), max(1, int(h * s))
    resized = cv2.resize(crop, (rw, rh), interpolation=cv2.INTER_AREA)

    canvas = np.full((out_h, out_w), 255, np.uint8)   # 白地
    y0, x0 = (out_h - rh) // 2, (out_w - rw) // 2
    # マスクは部品が白なので、反転して黒い字として貼る
    canvas[y0:y0 + rh, x0:x0 + rw] = 255 - resized
    return canvas


# --- macOS 純正 OCR ----------------------------------------------------------
_vision_ready = None


def _load_vision():
    global _vision_ready
    if _vision_ready is not None:
        return _vision_ready
    try:
        import Vision
        from Foundation import NSURL
        _vision_ready = (Vision, NSURL)
    except ImportError:
        _vision_ready = False
    return _vision_ready


def vision_languages():
    """この機体の Vision が対応している言語を返す。ja-JP があるかの確認用。"""
    v = _load_vision()
    if not v:
        return []
    Vision, _ = v
    req = Vision.VNRecognizeTextRequest.alloc().init()
    langs, _err = req.supportedRecognitionLanguagesAndReturnError_(None)
    return list(langs) if langs else []


def ocr_image(path, languages=("ja-JP",), correction=False):
    """画像ファイルを Vision に渡し、[(文字列, 信頼度)] を返す。"""
    v = _load_vision()
    if not v:
        raise RuntimeError(
            "pyobjc が入っていない。`pip3 install --user pyobjc-framework-Vision`")
    Vision, NSURL = v

    url = NSURL.fileURLWithPath_(path)
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, None)

    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLanguages_(list(languages))
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    # 単字なので言語モデルによる補正は切る。付けると勝手に別の語に直される。
    req.setUsesLanguageCorrection_(correction)

    ok, err = handler.performRequests_error_([req], None)
    if not ok:
        return []

    out = []
    for obs in (req.results() or []):
        # topCandidates_(n) に候補数より大きい n を渡すと、Swift 側で
        #   Swift/SwiftNativeNSArray.swift:78: Fatal error: Array index out of range
        # というプロセス丸ごとの異常終了になる。Python の try では捕まえられない。
        # 必ず 1 で取り、長さも確かめる。
        try:
            cands = obs.topCandidates_(1)
        except Exception:
            continue
        if cands is None or len(cands) == 0:
            continue
        c = cands[0]
        out.append((c.string(), float(c.confidence())))
    return out


def crop_raw(gray, parts, pad=None, roi=None):
    """検出した部品の範囲を、**生のグレースケールのまま**切り出す。

    二値化して白地に描き直すより、生の写真をそのまま渡す方が Vision の成績が
    良かった（実測 4/6 対 3/6）。硬い縁がラテン文字に見えるらしく、
    `つ` が `C` になる。アンチエイリアスの残った自然な絵の方が読まれる。

    つまり **画像として抜いて渡すだけ** が、いちばん簡単でいちばん良い。
    pad は周囲の余白（外接矩形に対する比）。**ここが効く。** Vision は行を
    探すので余白が足りないと拾わない。実測で pad=0.35 は 0/5、1.0 は 5/5。
    既定は config.OCR_PAD。

    roi を渡すとその矩形の外へはみ出さないように切る（画面の外の机や
    ベゼルを巻き込まないため）。
    """
    if not parts:
        return None
    if pad is None:
        import config
        pad = config.OCR_PAD
    xs = [p["bbox"][0] for p in parts]
    ys = [p["bbox"][1] for p in parts]
    xe = [p["bbox"][0] + p["bbox"][2] for p in parts]
    ye = [p["bbox"][1] + p["bbox"][3] for p in parts]
    x0, y0, x1, y1 = min(xs), min(ys), max(xe), max(ye)
    px, py = int((x1 - x0) * pad), int((y1 - y0) * pad)

    H, W = gray.shape[:2]
    lx, ly, hx, hy = 0, 0, W, H
    if roi is not None:
        lx, ly, rw, rh = roi
        hx, hy = lx + rw, ly + rh
        x0, y0, x1, y1 = x0 + lx, y0 + ly, x1 + lx, y1 + ly   # ROI内座標→フレーム座標
    return gray[max(ly, y0 - py):min(hy, y1 + py),
                max(lx, x0 - px):min(hx, x1 + px)]


# =============================================================================
#  読みの規則 —— 「何を受けるか」はここだけで決める
#
#  一度、同じ規則が三箇所に散っていた。目録で絞るのが _read_once、仮名かどうかを
#  見るのが recognize_vision_raw、字数と確信度を見るのが main。順番も見えないし、
#  片方だけ直して食い違う事故が実際に起きた（回した向きの選び方で、別の向きの
#  仮名を捨てていた）。**規則が割れていると、直したつもりが直らない。**
# =============================================================================
def fold_kana(text):
    """カタカナをひらがなへ寄せる。ァ〜ヶ だけ（ー や ・ は触らない）。

    この装置の主題は機械が「いちばん近い規格に丸める」ことなので、
    **リ と り を別物として落とすのは筋が悪い。** 形はほぼ同じで、規格の
    系統が違うだけ。実機で「くり」が「Cリ」と読まれ、丸ごと捨てられていた。
    """
    out = []
    for c in text:
        o = ord(c)
        out.append(chr(o - 0x60) if 0x30A1 <= o <= 0x30F6 else c)
    return "".join(out)


def normalize(text, targets=None):
    """Vision の答えを、この装置の文字に正す。

      1. 空白を落とす
      2. カタカナをひらがなへ寄せる
      3. 目録（既定は46字）にある字だけ残す

    目録の字が一つも無ければ、**元のまま返す**。捨てるかどうかは accept が
    決めることで、ここでは判断しない（誤読をログに残すため）。
    """
    import config
    text = "".join(text.split())
    if getattr(config, "READ_FOLD_KATAKANA", False):
        text = fold_kana(text)
    if targets is None:
        targets = getattr(config, "REFERENCE_CHARS", None)
    if targets:
        kept = "".join(c for c in text if c in targets)
        if kept:
            return kept
    return text


def accept(text, conf):
    """この読みを受けるか。受けないなら理由も返す。

    戻り値: (受けるか, 理由の文)。**理由は必ず言う。**
    黙って落とすと、実機で「なぜ読まないのか」を探る時間が丸ごと無駄になる。
    """
    import config
    if not text:
        return (False, "")
    if not in_charset(text):
        return (False, f"「{text}」は仮名でないので捨てる"
                       f"（READ_CHARSET={config.READ_CHARSET!r}）"
                       "— 部品ではなく周りのものを見ている可能性が高い")
    if len(text) < config.READ_MIN_CHARS:
        return (False, f"「{text}」は{len(text)}字なので捨てる"
                       f"（READ_MIN_CHARS={config.READ_MIN_CHARS}）")
    if conf < config.READ_MIN_CONF:
        return (False, f"「{text}」は確信度 {conf:.2f} で切り捨て"
                       f"（READ_MIN_CONF={config.READ_MIN_CONF}）")
    return (True, "")


def _ask_vision(crop):
    """1枚の画像を Vision に渡す。生のまま。読めなければ ("", 0.0)。"""
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        tmp = f.name
    try:
        cv2.imwrite(tmp, crop)
        results = ocr_image(tmp)
    finally:
        os.unlink(tmp)
    if not results:
        return ("", 0.0)
    return (results[0][0], results[0][1])


class Reading:
    """読んだ結果。読めなかったことも結果なので、同じ形で返す。

      char … 読めた字。読めなければ ""
      conf … 確信度（かたちで寄せたときは重なりの割合）
      how  … "読み"（Vision）/ "かたち"（IoU）/ ""（読めず）
      note … 人に見せる1行。捨てた理由もここに入る
      crop … OCR に渡した画像（詰まったときに見るため）
    """

    def __init__(self, char="", conf=0.0, how="", note="", crop=None):
        self.char, self.conf, self.how = char, conf, how
        self.note, self.crop = note, crop

    def __bool__(self):
        return bool(self.char)


def read(gray, parts, mask=None, roi=None, pad=None, rotations=None):
    """組み上がったものを読む。**この関数が読みの入口。**

    順番はこう。
      1. 切り出す（加工は切り出しだけ）
      2. Vision に 0/90/180/270 で読ませる —— 字が回っていると読まないので
      3. それぞれの答えを normalize で正し、accept で受けるか決める
      4. 受けたものの中でいちばん確信度の高いものを採る
      5. 一つも無ければ、かたちで寄せる（IoU）
      6. それも寄らなければ読めず。**何もしない。**

    向きの選び方に注意。確信度だけで選ぶと壊れる。回した向きのどれかで
    Vision がラテン文字を高い確信度で返すことがあり（実機で「+5」「9Y」が
    続出した）、同じ切り出しの別の向きに仮名の読みがあってもそちらが捨て
    られる。**受けられるかで先に選び、確信度はその中での順位づけに使う。**
    """
    import config
    crop = crop_raw(gray, parts, pad, roi)
    if crop is None or crop.size == 0:
        return Reading(note="切り出せない")
    if rotations is None:
        rotations = getattr(config, "READ_ROTATIONS", (0,))

    best, rejected = None, None
    for deg in (rotations or (0,)):
        img = crop if deg == 0 else np.rot90(crop, (deg // 90) % 4).copy()
        text, conf = _ask_vision(img)
        if not text:
            continue
        text = normalize(text)
        ok, why = accept(text, conf)
        if ok:
            if best is None or conf > best[1]:
                best = (text, conf)
            if conf >= 1.0:
                break                   # これ以上良くならない
        elif rejected is None and why:
            rejected = why              # 最初に落ちた理由だけ覚えておく
    if best:
        return Reading(best[0], best[1], "読み", "", crop)

    ch, score, note = _by_shape(mask)
    if ch:
        return Reading(ch, score, "かたち", note, crop)
    return Reading(note=note or rejected or "", crop=crop)


def _by_shape(mask):
    """かたちで寄せる。戻り値は (字, 重なり, 1行)。寄らなければ字は ""。

    Vision が仮名を返さなかったときだけ通る。実機で円と縦棒を組んだ形を
    Vision は「6」と読んだ——形としては正しく、機械がいちばん近い規格に
    丸めた結果だが、丸めた先が数字だった。同じ形を46字に対して測れば
    「の」に寄る。学習ではなく、形の重なりを測っているだけ。

    **IoU は必ず最近傍を返す。** そのままでは何を置いても何かが定着して
    しまい「読めなければ何もしない」が壊れるので、点数と2位との差で切る。
    かたまりは点数が高くても差がほぼ無い（実測 0.004）のが見分けになる。
    """
    import config
    if mask is None or not getattr(config, "READ_FALLBACK_IOU", False):
        return ("", 0.0, "")
    ranked = iou_scores(mask, targets=config.REFERENCE_CHARS)
    if not ranked:
        return ("", 0.0, "")
    ch, score = ranked[0]
    ch2, score2 = ranked[1] if len(ranked) > 1 else ("", 0.0)
    margin = score - score2
    if score >= config.IOU_MIN_SCORE and margin >= config.IOU_MIN_MARGIN:
        return (ch, score,
                f"かたちで寄せた: {ch} {score:.2f}"
                f"（次点 {ch2} {score2:.2f}、差 {margin:.2f}）")
    # 寄らなかったときも数値を出す。実物の部品で IOU_MIN_* を決め直せるように。
    return ("", 0.0,
            f"かたちでも寄らない（1位 {ch} {score:.2f}、次点との差 {margin:.2f}）")


def recognize_vision(mask, targets=None):
    """組み上がったマスクを Vision に読ませ、(文字, 信頼度) を返す。

    targets を渡すと、候補のうち対象の字に一致したものを優先して拾う。
    Vision は候補が開いている（漢字も返る）ので、ここで閉じる。
    """
    img = render_for_ocr(mask)
    if img is None:
        return ("", 0.0)

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        tmp = f.name
    try:
        cv2.imwrite(tmp, img)
        results = ocr_image(tmp)
    finally:
        os.unlink(tmp)

    if not results:
        return ("", 0.0)

    if targets:
        for text, conf in results:
            for ch in text:
                if ch in targets:
                    return (ch, conf)

    text, conf = results[0]
    return (text.strip(), conf)


# --- IoU テンプレート照合 -----------------------------------------------------
#   OCR は読めないと黙る。この装置が言いたいのは「いちばん近い規格に丸める」こと
#   なので、崩れたときに何も返らないのは失敗の仕方が逆を向いている。
#   IoU は必ず最近傍を返し、崩れ具合がそのままスコアの低さとして出る。
N = 128
REF_FONTS = [
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]
_refs_cache = {}


def _norm(mask, n=N, fill=0.92):
    """bbox で切り出し、縦横比を保ったまま n×n の中央へ。位置と大きさを吸収する。"""
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    crop = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = crop.shape
    s = (n * fill) / max(h, w)
    rw, rh = max(1, int(w * s)), max(1, int(h * s))
    r = cv2.resize(crop, (rw, rh), interpolation=cv2.INTER_AREA)
    c = np.zeros((n, n), np.uint8)
    y0, x0 = (n - rh) // 2, (n - rw) // 2
    c[y0:y0 + rh, x0:x0 + rw] = r
    return (c > 127).astype(np.uint8)


def _rotate(mask, deg):
    """中心まわりに回す。はみ出さないよう対角長の正方形に入れてから回す。"""
    if deg == 0:
        return mask
    h, w = mask.shape
    d = int(np.hypot(h, w)) + 2
    pad = np.zeros((d, d), np.uint8)
    y0, x0 = (d - h) // 2, (d - w) // 2
    pad[y0:y0 + h, x0:x0 + w] = mask
    M = cv2.getRotationMatrix2D((d / 2, d / 2), deg, 1.0)
    return cv2.warpAffine(pad, M, (d, d), flags=cv2.INTER_NEAREST)


def build_refs(chars, font_path=None):
    """参照字形＝「規格」。フォントから描いて正規化しておく。

    参照にフォントを使うのは意図的で、比べる相手は本人の過去の組み方ではなく
    **規格化された字形**でなければ「規格に丸められた」と言えないため。
    """
    if font_path is None:
        font_path = next((p for p in REF_FONTS if os.path.exists(p)), None)
    if font_path is None:
        raise RuntimeError("参照用の日本語フォントが見つからない")

    from PIL import Image, ImageDraw, ImageFont
    size = 420
    font = ImageFont.truetype(font_path, int(size * 0.8))
    refs = {}
    for ch in chars:
        img = Image.new("L", (size, size), 0)
        d = ImageDraw.Draw(img)
        bb = d.textbbox((0, 0), ch, font=font)
        d.text(((size - (bb[2] - bb[0])) // 2 - bb[0],
                (size - (bb[3] - bb[1])) // 2 - bb[1]), ch, fill=255, font=font)
        refs[ch] = _norm(np.array(img))
    return refs


def iou_scores(mask, targets=None, rot=18, step=6):
    """規格の目録すべてとの近さを、高い順に [(字, IoU), ...] で返す。

    比べる相手は**フォントから描いた字形**であって、こちらが用意した見本の
    組み方ではない。「規格」は外にあるものでなければ、規格に丸められたと
    言えないため。

    rot: 探す回転の範囲（度）。手で置くと少し傾くので ±18度だけ許す。
    """
    if targets is None:
        import config
        targets = config.REFERENCE_CHARS
    key = tuple(targets)
    if key not in _refs_cache:
        _refs_cache[key] = build_refs(targets)
    refs = _refs_cache[key]

    best = {}
    for deg in range(-rot, rot + 1, step):
        q = _norm(_rotate(mask, deg))
        if q is None:
            continue
        for ch, ref in refs.items():
            union = np.count_nonzero(q | ref)
            s = np.count_nonzero(q & ref) / union if union else 0.0
            if s > best.get(ch, 0.0):
                best[ch] = s
    return sorted(best.items(), key=lambda kv: -kv[1])


def recognize_iou(mask, targets=None, rot=18, step=6):
    """最も近い規格の字と、その近さ（IoU 0〜1）を返す。

    必ず何かの字を返す。崩れているほどスコアが下がるだけで、黙らない。
    そのスコアが「規格からどれだけ遠いか」の数値そのものになる。
    """
    ranked = iou_scores(mask, targets, rot, step)
    return ranked[0] if ranked else ("", 0.0)


def in_charset(text, kind=None):
    """読みが受け付ける文字の範囲に収まっているか。

    OCR は何も置いていないところにも文字を見つける。実機では部屋の暗いものを
    部品として拾って「IAT8」「PAT8」を返し、それが定着してしまった。
    仮名を組む装置なので、仮名でない答えは「置いたものを見ていない」と読める。
    """
    if kind is None:
        import config          # このモジュールは config に依らせない流儀なので局所で
        kind = config.READ_CHARSET
    if kind == "any" or not text:
        return True
    for c in text:
        o = ord(c)
        # ー（U+30FC）は入れない。46字の目録に無く、ひらがなでもない。
        # 実機で「ー 0.30」を読みとして受けてしまった。仮名を組む装置なので、
        # **目録の外の記号を受けるのは筋が通らない。**
        kana = 0x3041 <= o <= 0x3096 or 0x309D <= o <= 0x309F
        if kind == "kana":
            if not kana:
                return False
        else:   # "jp"
            kata = 0x30A1 <= o <= 0x30FF
            kanji = 0x4E00 <= o <= 0x9FFF
            if not (kana or kata or kanji):
                return False
    return True
