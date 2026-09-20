#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# KumiJi / 本体 — 定着
#   寝かせたモニタの上に部品を並べる。手を止めていると痕跡が広がって濃くなり、
#   濃くなりきると**別の場所へ移って定着する**。
#
#   置く場は検出の地なので、閾値より明るい色しか描けない＝濃くする限界がある。
#   その限界があるから、濃くなりきったものは場所を移すしかない。
#   制約が形式を決めている。
#
#   定着した痕跡は**あなたの形のまま**残る。ただし機械が読んだ字の見出しの下に
#   収められる。字体は一つずつ違うのに、分類だけが規格化される。
#
# 使い方:
#   pip3 install --user pyobjc-framework-Vision
#   python3 main.py                       # → http://localhost:8899 も一緒に立つ
#
#   ウィンドウは2つ。
#     KumiJi            … 寝かせたモニタへ移して `f` で全画面（出力）
#     KumiJi / monitor  … 手元に置く確認用
#
#   `v` カメラ順送り / `0`〜`3` カメラを直接指定
#   調整は config.py を編集して `r` で読み直す。再起動は要らない。
# -----------------------------------------------------------------------------
import os
import sys
import time
import datetime
import importlib

import cv2
import numpy as np

import config as C
import recognize as R
import page_server
import emoji_search
from probe_contour import (
    open_camera, list_cameras, extract_parts, draw_overlay,
    on_mouse, drag, _rect, roi_stats, auto_tune,
)
from view import View, zone_rect, roi_pt_to_canvas, parts_mask_canvas
from state import Piece, centroids

HERE = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.path.join(HERE, C.SAVE_DIR)

JP_FONTS = [
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]


def jp_font_path():
    return next((p for p in JP_FONTS if os.path.exists(p)), None)


def luma(bgr):
    """cv2 のグレースケール換算。置く場に描く色が閾値より明るいかの検査用。"""
    b, g, r = bgr
    return 0.299 * r + 0.587 * g + 0.114 * b


def draw_text(img, text, org, px, color, anchor="la"):
    """日本語を描く。cv2.putText は日本語が出ないので PIL 経由。"""
    path = jp_font_path()
    if not path or not text:
        return
    from PIL import Image, ImageDraw, ImageFont
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    ImageDraw.Draw(pil).text(org, text,
                             font=ImageFont.truetype(path, max(8, int(px))),
                             fill=(color[2], color[1], color[0]), anchor=anchor)
    img[:] = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


# --- 描画 --------------------------------------------------------------------
def draw_halo(canvas, pmask, progress):
    """痕跡が広がって濃くなる。progress 0→1 で半径と濃さが上がる。

    距離変換を1回だけ使う。膨張を層の数だけ繰り返すより一桁速く、
    しかも階段にならず滑らかに落ちる。

    置く場に描くので、いちばん濃くても HALO_COLOR（閾値より十分明るい）止まり。
    ここが「これ以上濃くならない」限界で、だから場所を移す必要が出る。
    """
    if progress <= 0:
        return
    d = max(1, C.HALO_SCALE_DIV)
    h, w = canvas.shape[:2]
    small = cv2.resize(pmask, (w // d, h // d), interpolation=cv2.INTER_NEAREST)
    r = (C.HALO_RADIUS_START
         + (C.HALO_RADIUS_END - C.HALO_RADIUS_START) * progress) / d
    if r < 1:
        return

    # 各画素から最も近い部品までの距離。物の際ほど 0 に近い。
    dist = cv2.distanceTransform(255 - small, cv2.DIST_L2, 3)
    t = np.clip(1.0 - dist / r, 0.0, 1.0) ** C.HALO_FALLOFF
    t *= progress

    bg = float(C.CANVAS_BG)
    base = np.array(C.HALO_COLOR, np.float32)
    # 小さいまま uint8 にしてから拡大する。float の全画面リサイズより桁違いに速い。
    layer = (bg + (base - bg) * t[..., None]).astype(np.uint8)
    up = cv2.resize(layer, (w, h), interpolation=cv2.INTER_LINEAR)
    # 光の無いところは地の色(255)なので、暗い方を採る min で合成できる。
    # 真偽マスクでの添字よりずっと速い。
    cv2.min(canvas, up, dst=canvas)


def fix_cell_rect(idx, cw, ch):
    """定着の場の idx 番目の升（画面座標）。埋める順は FIX_ORDER に従う。"""
    x, y, w, h = zone_rect(C.FIX_ZONE, cw, ch)
    cols, rows = max(1, C.FIX_COLS), max(1, C.FIX_ROWS)
    cell_w, cell_h = w // cols, h // rows
    r, c = divmod(idx, cols)
    if C.FIX_ORDER == "rtl":
        c = cols - 1 - c                      # 右の列から埋める（縦組みの読み）
    return (x + c * cell_w, y + r * cell_h, cell_w, cell_h)


def fit_rect(mark, cell):
    """升の中に痕跡を収める矩形を返す。見出しの高さを除いた領域に合わせる。"""
    ox, oy, cell_w, cell_h = cell
    pad = int(min(cell_w, cell_h) * C.FIX_CELL_PAD)
    label_h = int(cell_h * 0.18) if C.FIX_SHOW_LABEL else 0
    bw, bh = cell_w - pad * 2, cell_h - pad * 2 - label_h
    if bw < 4 or bh < 4 or mark is None:
        return None
    mh, mw = mark.shape[:2]
    s = min(bw / mw, bh / mh)
    nw, nh = max(1, int(mw * s)), max(1, int(mh * s))
    return (ox + pad + (bw - nw) // 2, oy + pad + (bh - nh) // 2, nw, nh)


def draw_mark(canvas, mark, rect, color):
    """痕跡を矩形に収めて描く。穴はそのまま抜ける。"""
    if rect is None:
        return
    x, y, w, h = rect
    H, W = canvas.shape[:2]
    if w < 1 or h < 1 or x >= W or y >= H:
        return
    m = cv2.resize(mark, (w, h), interpolation=cv2.INTER_AREA)
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    sub = m[y0 - y:y1 - y, x0 - x:x1 - x]
    canvas[y0:y1, x0:x1][sub > 127] = color


def draw_fix_zone(canvas, fixed):
    """定着の場。検出しない領域なので、ここは何色でも描ける。

    形はあなたのまま。見出しだけが規格。
    """
    ch, cw = canvas.shape[:2]
    x, y, w, h = zone_rect(C.FIX_ZONE, cw, ch)
    if w < 8 or h < 8:
        return
    canvas[y:y + h, x:x + w] = C.FIX_BG

    slots = max(1, C.FIX_COLS) * max(1, C.FIX_ROWS)
    for idx, (mark, label) in enumerate(fixed[-slots:]):
        cell = fix_cell_rect(idx, cw, ch)
        draw_mark(canvas, mark, fit_rect(mark, cell), C.FIX_INK)
        if C.FIX_SHOW_LABEL and label:
            ox, oy, cell_w, cell_h = cell
            pad = int(min(cell_w, cell_h) * C.FIX_CELL_PAD)
            label_h = int(cell_h * 0.18)
            draw_text(canvas, label, (ox + cell_w // 2, oy + cell_h - pad // 2),
                      label_h * 0.8, C.FIX_LABEL_INK, anchor="ms")

    cv2.line(canvas, (max(0, x - 1), y), (max(0, x - 1), y + h), (222, 219, 214), 1)


# --- 読めた語への反応（絵文字）------------------------------------------------
EMOJI_FONT = "/System/Library/Fonts/Apple Color Emoji.ttc"
EMOJI_STRIKE = 160        # Apple Color Emoji は決まった大きさしか描けない。
                          # 一度これで描いてから cv2 で縮めて使う。
_emoji_cache = {}


def emoji_rgba(em, px):
    """絵文字を RGBA で返す。大きさは 8 画素刻みに丸めて使い回す。"""
    px = max(8, int(round(px / 8) * 8))
    key = (em, px)
    if key in _emoji_cache:
        return _emoji_cache[key]
    base_key = (em, "base")
    if base_key not in _emoji_cache:
        from PIL import Image, ImageDraw, ImageFont
        f = ImageFont.truetype(EMOJI_FONT, EMOJI_STRIKE)
        img = Image.new("RGBA", (int(EMOJI_STRIKE * 1.5),) * 2, (0, 0, 0, 0))
        ImageDraw.Draw(img).text((0, 0), em, font=f, embedded_color=True)
        a = np.array(img)
        ys, xs = np.nonzero(a[..., 3])
        if len(xs):
            a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        _emoji_cache[base_key] = a
    base = _emoji_cache[base_key]
    h, w = base.shape[:2]
    s = px / max(1, max(h, w))
    out = cv2.resize(base, (max(1, int(w * s)), max(1, int(h * s))),
                     interpolation=cv2.INTER_AREA)
    if not C.EMOJI_FULL_COLOR:
        # 検出を止めない方式。白側へ持ち上げて閾値を割らないようにする。
        rgb = out[..., :3].astype(np.float32)
        al = out[..., 3:4].astype(np.float32) / 255.0
        onwhite = rgb * al + 255 * (1 - al)
        mn = float(cv2.cvtColor(onwhite.astype(np.uint8), cv2.COLOR_RGB2GRAY).min())
        k = min(1.0, (255 - C.EMOJI_MIN_LUMA) / max(1.0, 255 - mn))
        out = out.copy()
        out[..., :3] = (255 - (255 - rgb) * k).astype(np.uint8)
    _emoji_cache[key] = out
    return out


def paste_rgba(canvas, rgba, cx, cy, alpha_mul=1.0):
    """RGBA を中心指定で重ねる。はみ出しは切る。"""
    h, w = rgba.shape[:2]
    x, y = int(cx - w / 2), int(cy - h / 2)
    H, W = canvas.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    sub = rgba[y0 - y:y1 - y, x0 - x:x1 - x]
    a = (sub[..., 3:4].astype(np.float32) / 255.0) * float(alpha_mul)
    src = sub[..., :3][..., ::-1].astype(np.float32)          # RGB → BGR
    dst = canvas[y0:y1, x0:x1].astype(np.float32)
    canvas[y0:y1, x0:x1] = (src * a + dst * (1 - a)).astype(np.uint8)


def match_emoji(text):
    """読めた語から絵文字を引く。先頭が当たり、以降は「当たり以外」の候補。

    既定は決めた6語の対応表（EMOJI_SOURCE="dict"）。完全一致のみ。
    "os" にすると OS の絵文字検索に切り替わる（emoji_search.py）。
    """
    if not text:
        return []
    if C.EMOJI_SOURCE == "os":
        return emoji_search.search(text, C.EMOJI_MAX_HITS)
    em = C.EMOJI_WORDS.get(text)
    if not em:
        return []
    others = [v for v in C.EMOJI_WORDS.values() if v != em]
    return [em] + others


def current_title(n):
    """見つけた語数から称号を引く。活版の職階から取っている。"""
    name = ""
    for need, t in C.TITLES:
        if n >= need:
            name = t
    return name


def start_reaction(hits, center, now, canvas_wh=None):
    """検索結果を散らす。**流れているのは検索でヒットした絵文字そのもの。**

    1位を主役として大きく無遅延で出し、残りは順位の重みで配分する。
    """
    rng = np.random.RandomState(int(now * 1000) % (2 ** 31))
    hits = list(hits) or ["❓"]
    main_em, others = hits[0], hits[1:]
    cw, ch = canvas_wh or (C.CANVAS_W, C.CANVAS_H)
    zx, zy, zw, zh = zone_rect(C.PLACE_ZONE, cw, ch)
    cx, cy = center
    items = []
    for i in range(max(1, C.EMOJI_COUNT)):
        # 1個目は必ず当たりを大きく無遅延で（答えが読めるように）。
        # 残りは EMOJI_OTHERS の割合で「当たり以外」を混ぜる。0 なら当たりだけ。
        use_other = (i > 0 and others and rng.rand() < C.EMOJI_OTHERS)
        items.append({
            "em": others[rng.randint(len(others))] if use_other else main_em,
            "ang": rng.uniform(0, 2 * np.pi),
            "spd": rng.uniform(0.45, 1.0),
            "delay": 0.0 if i == 0 else rng.uniform(0.0, 0.45),
            "size": 1.45 if i == 0 else rng.uniform(0.55, 1.05),
            # 出はじめの位置。組んだ字の中心と、置く場のどこかとを
            # EMOJI_SPREAD で混ぜる。1 なら置く場全体にばらける。
            "sx": cx + (rng.uniform(zx, zx + zw) - cx) * C.EMOJI_SPREAD,
            "sy": cy + (rng.uniform(zy, zy + zh) - cy) * C.EMOJI_SPREAD,
        })
    return {"hits": hits, "center": center, "t0": now, "items": items}


def draw_reaction(canvas, react, now):
    """流れている間 True を返す。終わったら False。"""
    t = (now - react["t0"]) / max(0.05, C.EMOJI_SEC)
    if t >= 1.0:
        return False
    for it in react["items"]:
        p = (t - it["delay"]) / max(0.05, 1.0 - it["delay"])
        if p <= 0.0 or p >= 1.0:
            continue
        a = float(np.sin(p * np.pi))                    # 出て、消える
        d = C.EMOJI_DRIFT * it["spd"] * p
        x = it["sx"] + np.cos(it["ang"]) * d
        y = it["sy"] + np.sin(it["ang"]) * d * 0.7      # 横に広がる方を強く
        px = C.EMOJI_SIZE * it["size"] * (0.8 + 0.4 * p)
        paste_rgba(canvas, emoji_rgba(it["em"], px), x, y, a)
    return True


def capture_mark(pmask, size=320):
    """定着させる痕跡を切り出す。あなたの形をそのまま小さく持つ。"""
    ys, xs = np.nonzero(pmask)
    if len(xs) == 0:
        return None
    crop = pmask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = crop.shape
    s = size / max(h, w)
    return cv2.resize(crop, (max(1, int(w * s)), max(1, int(h * s))),
                      interpolation=cv2.INTER_AREA)


def switch_camera(cap, idx):
    """指定インデックスのカメラへ切り替える。開けなければ元のまま返す。

    Continuity Camera（iPhone）のインデックスは接続のたびに変わるので、
    走らせたまま試せる方が早い。フレームが来るかまで確かめてから乗り換える。
    """
    new = open_camera(idx)
    if new is None:
        print(f"  camera [{idx}] は開けない")
        return cap, False
    ok, _ = new.read()
    if not ok:
        new.release()
        print(f"  camera [{idx}] はフレームが来ない")
        return cap, False
    if cap is not None:
        cap.release()
    print(f"  camera [{idx}] に切り替えた")
    return new, True


# --- 読む ---------------------------------------------------------------------
def do_read(piece, gray, parts, roi):
    """静止した配置を1回だけ読む。読めなければ何もしない。

    ふるいは3枚。どれで落ちたかを必ず言う——黙って落とすと、実機で
    「なぜ読まないのか」を探る時間が丸ごと無駄になる。
    """
    piece.begin_read()
    crop = R.crop_raw(gray, parts, roi=roi)
    size = "×" if crop is None else f"{crop.shape[1]}x{crop.shape[0]}"
    ch, conf = R.recognize_vision_raw(gray, parts,
                                      targets=C.REFERENCE_CHARS, roi=roi)
    if ch and not R.in_charset(ch):
        print(f"  読み「{ch}」は仮名でないので捨てる "
              f"（READ_CHARSET={C.READ_CHARSET!r}）"
              "— 部品ではなく周りのものを見ている可能性が高い")
        ch = ""
    if ch and len(ch) < C.READ_MIN_CHARS:
        print(f"  読み「{ch}」は{len(ch)}字なので捨てる "
              f"（READ_MIN_CHARS={C.READ_MIN_CHARS}）")
        ch = ""
    if ch and conf < C.READ_MIN_CONF:
        print(f"  読み「{ch}」は確信度 {conf:.2f} で切り捨て "
              f"（READ_MIN_CONF={C.READ_MIN_CONF}）")
        ch = ""
    return crop, size, ch, conf


def do_react(piece, ch, conf, parts, roi, now):
    """読めた語への反応。出すかどうかの判断は Piece が持っている。"""
    hits = match_emoji(ch)
    if piece.maybe_react(now, ch, hits):
        xs = [q["bbox"][0] + q["bbox"][2] / 2 for q in parts]
        ys = [q["bbox"][1] + q["bbox"][3] / 2 for q in parts]
        ctr = roi_pt_to_canvas((sum(xs) / len(xs), sum(ys) / len(ys)),
                               roi, C.CANVAS_W, C.CANVAS_H)
        piece.react = start_reaction(hits, ctr, now, (C.CANVAS_W, C.CANVAS_H))
        ttl = current_title(len(piece.found))
        print(f"    → {hits[0]} が流れる"
              f"  見つけた語 {len(piece.found)}/{len(C.EMOJI_WORDS)}"
              f"{'  称号: ' + ttl if ttl else ''}")
    # 辞書に無い語（誤読で漢字が出るなど）では hits が空になる。
    # 読めたこと自体はページへ流すので、ここは反応の外で押す。
    page_server.push({
        "char": ch, "conf": round(conf, 3), "parts": len(parts),
        "emoji": hits[0] if hits else "",
        "found": sorted(piece.found), "title": current_title(len(piece.found)),
    })


# --- 定着する -----------------------------------------------------------------
def decide_fix(piece, cur_c, pmask, now):
    """濃くなりきった痕跡を、別の場所へ移しはじめる。

    読めたものしかここへ来ないので、**定着したものには必ず見出しがある**。
    """
    verdict = piece.fix_verdict(cur_c)
    if not verdict:
        return
    if verdict == "already":
        # 同じ配置を微調整しただけでは二重に定着させない。
        # 大きく作り直したときだけ次の1枚になる。
        piece.note_already()
        print("  （定着済みの配置なので重ねない）")
        return

    piece.note_fixed(now, cur_c)
    mark = capture_mark(pmask)
    if mark is None:
        return
    ys, xs = np.nonzero(pmask)
    src = (int(xs.min()), int(ys.min()),
           int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))
    dst = fit_rect(mark, fix_cell_rect(piece.slot(), C.CANVAS_W, C.CANVAS_H)) or src
    nth = len(piece.fixed) + 1      # begin_travel の前に数える（瞬間移動でも合う）
    piece.begin_travel(now, mark, piece.char, src, dst)
    print(f"  定着: 「{piece.char}」（{nth}枚目）")
    page_server.push({
        "char": piece.char, "conf": round(piece.conf, 3),
        "parts": int(pmask.any()) and len(cur_c), "fixed": nth,
        "emoji": (match_emoji(piece.char) or [""])[0],
        "found": sorted(piece.found), "title": current_title(len(piece.found)),
    })


# --- 画面を描く ---------------------------------------------------------------
def compose(piece, pmask, now, progress):
    """作品の画面を1枚描く。

    置く場は検出の地なので、閾値より明るい色しか描けない。だから「濃くして
    いく」には限界がある。その限界があるからこそ、濃くなりきったものは
    別の場所へ移して定着する。制約が形式を決めている。
    """
    canvas = np.full((C.CANVAS_H, C.CANVAS_W, 3), C.CANVAS_BG, np.uint8)
    if pmask is not None and progress > 0:
        draw_halo(canvas, pmask, progress)
    draw_fix_zone(canvas, piece.fixed)

    # 移動中の痕跡。置く場を横切るので**明るい光のまま**運ぶ。
    # 到着して fixed に入った瞬間に FIX_INK の色が乗る＝そこが「定着」。
    moving = piece.travel_rect(now)
    if moving is not None:
        mark, rect, arrived = moving
        draw_mark(canvas, mark, rect, C.HALO_COLOR)
        if arrived:
            piece.land_travel()
            draw_fix_zone(canvas, piece.fixed)

    # 読めた語への反応。いちばん上に重ねる。
    if piece.react is not None and not draw_reaction(canvas, piece.react, now):
        piece.react = None
    return canvas


def debug_view(frame, mask, parts, roi, view_roi, piece, now, progress,
               thr, drops, min_area, use_otsu, cam, vw, show_mask, gray):
    """確認用の窓。**なぜ検出されないのかが数字で分かること**を第一にする。"""
    if show_mask:
        view = draw_overlay(cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR),
                            (0, 0, 0, 0), parts)
    else:
        view = draw_overlay(frame.copy(), roi, parts)
        sx, sy, sw, sh = view_roi
        cv2.rectangle(view, (sx, sy), (sx + sw, sy + sh), (170, 170, 170), 1)
        x, y, w, h = roi
        cv2.rectangle(view, (x, y), (x + w, y + h), (0, 200, 255), 2)
        if drag["active"] and drag["p0"] and drag["cur"]:
            dx, dy, dw, dh = _rect(drag["p0"], drag["cur"])
            cv2.rectangle(view, (dx, dy), (dx + dw, dy + dh), (0, 255, 255), 2)

    still = piece.still(now)
    cv2.putText(view,
                f"parts {len(parts)}  thr {thr}({'otsu' if use_otsu else 'fix'})"
                f"  still {still:.1f}s  fixed {len(piece.fixed)}"
                + ("  [moving]" if piece.move_since is not None else ""),
                (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    cv2.rectangle(view, (10, 38), (310, 50), (90, 90, 90), 1)
    cv2.rectangle(view, (10, 38), (10 + int(progress * 300), 50), (0, 210, 255), -1)

    if vw.show_guide:
        cv2.putText(view, "AIMING - not reading (press g when aligned)",
                    (10, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (80, 160, 255), 2)
    elif piece.reacting(now):
        cv2.putText(view, "REACTING (camera ignored)", (10, 100),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2)

    cv2.putText(view,
                f"cam {cam} x{vw.zoom:.1f} @({vw.center[0]:.2f},{vw.center[1]:.2f})"
                f"  |  out ({vw.out_rect[0]:.2f},{vw.out_rect[1]:.2f},"
                f"{vw.out_rect[2]:.2f},{vw.out_rect[3]:.2f})"
                + ("+keystone" if C.OUT_CORNERS else ""),
                (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
    cv2.putText(view,
                "drag here = set ROI   A:auto-tune thr+area   a:re-find ROI"
                "   zx hjkl:camera   ZX HJKL:output   g:guide W:save"
                "   v/0-3:cam r:reload c:clear f:full q:quit",
                (10, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (170, 170, 170), 1)

    # 閾値を勘で動かさずに済むよう、いま何と何を分けようとしているかを出す。
    ink, ground, otsu, frac = roi_stats(gray, roi)
    lo, hi = sorted((ink, ground))
    gap = abs(ink - ground)
    bad = not (lo <= thr <= hi)
    cv2.putText(view,
                f"{'ink' if C.DETECT_DARK else 'lit'} {ink}"
                f"   bg {ground}   gap {gap}   otsu {otsu}   area {frac:.1f}%"
                + (f"   <- thr {thr} outside {lo}..{hi}" if bad
                   else "   <- gap too small to separate" if gap < 25 else ""),
                (10, 148), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                (90, 200, 255) if (bad or gap < 25) else (200, 200, 200),
                2 if (bad or gap < 25) else 1)

    # 「0個」だけでは、閾値が外れているのか面積のふるいで落ちているのかが
    # 分からない。捨てた理由を数で出す。
    ma_pct = min_area / max(1, roi[2] * roi[3]) * 100
    cv2.putText(view,
                f"dropped: small {drops['small']}  large {drops['large']}"
                f"  border {drops['border']}"
                f"   |  ROI {roi[2]}x{roi[3]}"
                f"   min_area {min_area} = {ma_pct:.0f}% of ROI"
                + ("  <- too big, press [" if ma_pct > 8 else ""),
                (10, 172), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                (90, 200, 255) if ma_pct > 8 else (200, 200, 200),
                2 if ma_pct > 8 else 1)

    if piece.read_at is not None:
        draw_text(view, f"読めた: {piece.char} {piece.conf:.2f}",
                  (10, 80), 34, (0, 220, 255))
    elif piece.fail_at is not None:
        draw_text(view, "読めず — 何もしない", (10, 80), 30, (110, 110, 200))
    return view


# --- 本体 --------------------------------------------------------------------
def main():
    os.makedirs(SAVE_DIR, exist_ok=True)
    if jp_font_path() is None:
        sys.exit("日本語フォントが見つからない。")

    available = list_cameras()
    if not available:
        sys.exit("カメラが開けない。")
    cam = C.CAMERA_INDEX if C.CAMERA_INDEX in available else available[0]
    cap = open_camera(cam)
    print(f"camera [{cam}] で開始。`v` で順送り、`0`〜`3` で直接指定。")
    print("読み手: macOS Vision（ja-JP）。1字だと行として拾われないので2字以上を推奨。")
    lm = luma(C.HALO_COLOR)
    print(f"HALO_COLOR 輝度 {lm:.0f}（下限 {C.DRAW_MIN_LUMA}）"
          f"{'' if lm >= C.DRAW_MIN_LUMA else '  ★ 暗すぎる。自分の光を部品として拾う'}")
    page_server.start(C.PAGE_PORT)
    print("\n出力ウィンドウを寝かせたモニタ／プロジェクターへ移して `f` で全画面。")
    print("検出範囲は確認ウィンドウの上をドラッグして囲う（囲うのは文字ではなく紙）。")
    print("囲ったら `A` を押す。閾値と最小面積をまとめて合わせる。")
    print("カメラを寄せる: z x（ズーム）h j k l（位置）")
    print("写す範囲を合わせる: Z X（拡縮）H J K L（位置）g（枠の表示）W（config へ保存）")
    print("そのほかの調整は config.py を編集して `r` で読み直す。\n")

    piece = Piece()                 # 作品の状態（state.py）
    vw = View()                     # 画角と写す範囲（view.py）
    vw.try_optical(cap)
    min_area, thr_offset = C.MIN_AREA, C.THRESHOLD_OFFSET
    use_otsu = C.USE_OTSU
    last_crop = None                # 直近に OCR へ渡した画像（`s` で保存する）
    last = None                     # 反応中に使い回す検出結果
    show_debug, show_mask, fullscreen = True, False, False

    OUT, DBG = "KumiJi", "KumiJi / monitor"
    cv2.namedWindow(OUT, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(OUT, 1280, 720)
    cv2.namedWindow(DBG, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(DBG, on_mouse)

    while True:
        ok, raw = cap.read()
        if not ok:
            if cv2.waitKey(200) & 0xFF == ord("q"):
                break
            continue

        frame = vw.take(raw)
        H, W = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        roi = vw.resolve_roi(gray, W, H)

        now = time.time()
        reacting = piece.reacting(now)
        no_drop = {"small": 0, "large": 0, "border": 0}
        if vw.show_guide:
            # 枠は濃い色なので、読ませたままにすると枠そのものを部品として
            # 拾い、合わせている最中に痕跡が溜まる。まだ何も置いていない
            # 時間なので、止めてよい。
            mask, parts, thr, drops = np.zeros((roi[3], roi[2]), np.uint8), [], 0, no_drop
        elif reacting and last is not None:
            # フルカラーの絵文字を置く場に描いている間は、カメラがそれを
            # 部品として拾う。直前の検出を保持して、カメラを信じない。
            mask, parts, thr = last
            drops = no_drop
        else:
            mask, parts, thr, drops = extract_parts(gray, roi, min_area,
                                                    thr_offset, use_otsu)
            last = (mask, parts, thr)

        # --- 流れ：検出 → 静止で読む → 読めたら光る → 保持で定着 --------
        cur_c = centroids(parts)
        if not reacting:
            piece.observe(now, cur_c)
            if piece.wants_read(now, bool(parts)):
                last_crop, size, ch, conf = do_read(piece, gray, parts, roi)
                if ch:
                    piece.accept_read(now, ch, conf)
                    print(f"  読めた: {ch} {conf:.2f}   部品{len(parts)}個")
                    do_react(piece, ch, conf, parts, roi, now)
                else:
                    piece.reject_read(now)
                    print(f"  読めず（部品{len(parts)}個 / OCRに渡した画像 {size}）"
                          f"— 何もしない。`s` でその画像を保存できる")

        progress = piece.progress(now, bool(parts))
        if piece.update_presence(now, bool(parts)):
            # ここが出ていないのに同じものが二度定着したら、原因は別にある。
            print("  全部どけた（定着と反応の抑止を解いた）")

        pmask = (parts_mask_canvas(mask, C.CANVAS_W, C.CANVAS_H)
                 if parts and progress > 0 else None)
        if pmask is not None and progress >= 1.0:
            decide_fix(piece, cur_c, pmask, now)

        canvas = compose(piece, pmask, now, progress)
        cv2.imshow(OUT, vw.present(canvas))

        if show_debug:
            cv2.imshow(DBG, debug_view(frame, mask, parts, roi, vw.view_roi,
                                       piece, now, progress, thr, drops,
                                       min_area, use_otsu, cam, vw,
                                       show_mask, gray))

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        if vw.handle_key(key):          # z x h j k l / Z X H J K L / g / W
            continue
        if key == ord("r"):
            importlib.reload(C)
            min_area, thr_offset = C.MIN_AREA, C.THRESHOLD_OFFSET
            vw.reload()
            print(f"config 読み直し  FIX_SECONDS={C.FIX_SECONDS} "
                  f"閾値={C.FIXED_THRESHOLD} HALO輝度={luma(C.HALO_COLOR):.0f}\n"
                  f"  絵文字: {C.EMOJI_SOURCE}  数={C.EMOJI_COUNT} "
                  f"他の絵文字={C.EMOJI_OTHERS}（0なら当たりだけ） "
                  f"散らばり={C.EMOJI_SPREAD} 大きさ={C.EMOJI_SIZE}\n"
                  f"  読み: 文字種={C.READ_CHARSET} 最小{C.READ_MIN_CHARS}字 "
                  f"確信度下限={C.READ_MIN_CONF} "
                  f"再定着={C.REFIX_TOL}px 絵文字クールダウン={C.EMOJI_COOLDOWN_SEC}s")
        elif key == ord("f"):
            fullscreen = not fullscreen
            cv2.setWindowProperty(OUT, cv2.WND_PROP_FULLSCREEN,
                                  cv2.WINDOW_FULLSCREEN if fullscreen
                                  else cv2.WINDOW_NORMAL)
        elif key == ord("d"):
            show_debug = not show_debug
            if show_debug:
                cv2.namedWindow(DBG, cv2.WINDOW_NORMAL)
                cv2.setMouseCallback(DBG, on_mouse)
            else:
                cv2.destroyWindow(DBG)
        elif key == ord("b"):
            show_mask = not show_mask
        elif key == ord("o"):
            use_otsu = not use_otsu
            print(f"  閾値: {'大津（自動）' if use_otsu else f'固定 {C.FIXED_THRESHOLD}'}")
        elif key == ord("A"):
            # 閾値と最小面積をまとめて合わせる。場が変わるたびに
            # 「`o` → `[` を数回」をやり直していたので、1キーにした。
            ma, n, areas, t, why = auto_tune(gray, roi)
            if ma is None:
                print(f"  合わせられない: {why}")
            else:
                use_otsu, thr_offset, min_area = True, 0, ma
                print(f"  合わせた: 大津={t}  MIN_AREA={ma}"
                      f"（ROI 面積の {ma / max(1, roi[2] * roi[3]) * 100:.1f}%）"
                      f"  → 部品 {n}個")
                print(f"    {why}   面積の上位: {areas[:6]}")
        elif key == ord("a"):
            vw.refind_roi(gray)
        elif key == ord("v"):
            order = available or [0, 1, 2, 3]
            nxt = (order[(order.index(cam) + 1) % len(order)]
                   if cam in order else order[0])
            cap, done = switch_camera(cap, nxt)
            if done:
                cam, vw.screen_roi, last = nxt, None, None   # 画角が変わる
        elif ord("0") <= key <= ord("3"):
            idx = key - ord("0")
            cap, done = switch_camera(cap, idx)
            if done:
                cam, vw.screen_roi, last = idx, None, None
                if idx not in available:
                    available.append(idx)
        elif key == ord("c"):
            piece.clear_fixed()
            print("定着した痕跡を消した")
        elif key == ord("["):
            min_area = max(20, min_area - max(20, min_area // 5))
            print(f"  MIN_AREA = {min_area}"
                  f"（ROI 面積の {min_area / max(1, roi[2] * roi[3]) * 100:.1f}%）")
        elif key == ord("]"):
            min_area += max(20, min_area // 5)
            print(f"  MIN_AREA = {min_area}"
                  f"（ROI 面積の {min_area / max(1, roi[2] * roi[3]) * 100:.1f}%）")
        elif key == ord("-"):
            thr_offset -= C.THRESHOLD_STEP
            print(f"  閾値オフセット {thr_offset:+d}")
        elif key == ord("="):
            thr_offset += C.THRESHOLD_STEP
            print(f"  閾値オフセット {thr_offset:+d}")
        elif key == ord("s"):
            # 詰まったときに見たいのは「OCR へ渡した画像」なので、それも出す。
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            shown = vw.present(canvas)
            saved = []
            for nm, img in (("canvas", canvas), ("output", shown),
                            ("frame", frame), ("mask", mask),
                            ("ocr_input", last_crop)):
                if img is None:
                    continue
                if nm == "output" and img is canvas:
                    continue        # 全面のときは canvas と同じものなので出さない
                cv2.imwrite(os.path.join(SAVE_DIR, f"{stamp}_{nm}.png"), img)
                saved.append(nm)
            print(f"保存: {stamp}_[{' '.join(saved)}].png  → outputs/")

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
