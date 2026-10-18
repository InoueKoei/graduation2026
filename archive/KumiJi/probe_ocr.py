#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# KumiJi / Step 2 — OCR が使えるかを測定する
#   組み上がった部品を1つのマスクに合成し、macOS 純正の日本語OCR（Vision）に
#   読ませて、正解率を数える。議論ではなく測定で OCR 路線の可否を決める。
#
# 使い方:
#   pip3 install --user pyobjc-framework-Vision
#   python3 probe_ocr.py
#
#   1〜6 キーで「いま組んでいる字」を選び、部品を並べる。
#   既定は自動判定で、**手を止めて 1.2秒たつと1回だけ**判定が降りる。
#   配置を変えるまで再判定はしない（OCR は毎フレーム回すには重いため）。
#   `t` で手動（SPACE のみ）に切り替え。`q` で終了すると正解率の集計が出る。
#
#   各字10回ずつ、隙間の空き方を変えて組む。わざと崩した配置も数回入れる。
# -----------------------------------------------------------------------------
import os
import sys
import time
import datetime

import cv2
import numpy as np

import config as C
import recognize as R
from probe_contour import (
    open_camera, list_cameras, extract_parts, auto_screen_roi,
    draw_overlay, draw_hud, on_mouse, drag, _rect,
)

HERE = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.path.join(HERE, C.SAVE_DIR)

# cv2.putText は日本語が出ないので、認識結果の表示だけ PIL で描く
JP_FONT_CANDIDATES = [
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
]


def find_jp_font():
    for p in JP_FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def draw_jp(img, text, org, size=64, color=(0, 255, 255)):
    """日本語を画像に描く。フォントが見つからなければ何もしない。"""
    path = find_jp_font()
    if not path or not text:
        return img
    from PIL import Image, ImageDraw, ImageFont
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    ImageDraw.Draw(pil).text(org, text, font=ImageFont.truetype(path, size),
                             fill=(color[2], color[1], color[0]))
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def scene_signature(parts):
    """いまの配置を表す指紋。重心を粗く量子化しただけ。

    これが変わらなければ「部品が動いていない」、変われば「組み直された」。
    同じ配置を何度も OCR にかけないための判定に使う。
    """
    t = max(1, C.POS_TOL)
    return tuple(sorted((round(p["cx"] / t), round(p["cy"] / t)) for p in parts))


def judge(mask, exp, tally):
    """OCR と IoU の両方にかけて比べる。集計は IoU（本命）で取る。

    OCR は読めないと黙るが、IoU は必ず最近傍を返してスコアが下がるだけ。
    崩れても読めることが体験の価値なので、本命は IoU。
    """
    # 認識は「規格の目録」46字すべてに対して行う。組める6字に絞ると
    # 6択に丸めることになり、この装置の主張が成立しない。
    o_ch, o_conf = R.recognize_vision(mask, targets=C.REFERENCE_CHARS)
    ranked = R.iou_scores(mask, targets=C.REFERENCE_CHARS)
    i_ch, i_score = ranked[0]
    rv = "  ".join(f"{a}{b:.2f}" for a, b in ranked[1:4])

    for key, got in (("ocr", o_ch), ("iou", i_ch)):
        tally[exp][key][1] += 1
        if got == exp:
            tally[exp][key][0] += 1

    oh, ot = tally[exp]["ocr"]
    ih, it = tally[exp]["iou"]
    print(f"  期待={exp}   OCR={o_ch or '(読めず)':<8}({o_conf:.2f}) {'OK' if o_ch==exp else 'NG'}"
          f"   IoU={i_ch}({i_score:.2f}) {'OK' if i_ch==exp else 'NG'}"
          f"   [{exp}  OCR {oh}/{ot}  IoU {ih}/{it}]   次点: {rv}")
    return {"ocr": (o_ch or "(読めず)", o_conf, o_ch == exp),
            "iou": (i_ch, i_score, i_ch == exp)}


def main():
    os.makedirs(SAVE_DIR, exist_ok=True)

    langs = R.vision_languages()
    if not langs:
        sys.exit("Vision が使えない。`pip3 install --user pyobjc-framework-Vision`")
    print(f"Vision 対応言語: {', '.join(langs)}")
    if "ja-JP" not in langs:
        print("★ ja-JP が無い。OS のバージョンを確認。")
    print(f"組める字: {' '.join(C.BUILDABLE_CHARS)}")
    print(f"規格の目録: {len(C.REFERENCE_CHARS)}字\n")

    available = list_cameras()
    if not available:
        sys.exit("カメラが開けない。")
    cam_pos = available.index(C.CAMERA_INDEX) if C.CAMERA_INDEX in available else 0
    cap = open_camera(available[cam_pos])

    roi = None
    min_area = C.MIN_AREA
    thr_offset = C.THRESHOLD_OFFSET
    expect_i = 0                       # いま組んでいる字（1〜6キーで選ぶ）
    last = {"ocr": ("", 0.0, None), "iou": ("", 0.0, None)}
    tally = {ch: {"ocr": [0, 0], "iou": [0, 0]} for ch in C.BUILDABLE_CHARS}

    # 自動判定の状態。毎フレーム OCR を回さず、静止したら1回だけ判定する。
    auto = C.AUTO_JUDGE
    sig_prev = None        # 直前フレームの配置
    sig_since = 0.0        # その配置になった時刻
    sig_judged = None      # 最後に判定した配置（同じ配置は再判定しない）

    win = "KumiJi / OCR probe"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(win, on_mouse)

    while True:
        ok, frame = cap.read()
        if not ok:
            if cv2.waitKey(300) & 0xFF == ord("q"):
                break
            continue

        H, W = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if roi is None:
            roi = auto_screen_roi(gray) or (0, 0, W, H)
            print(f"ROI（自動検出）= {roi}")
        if drag["done"]:
            roi = drag["done"]; drag["done"] = None
            print(f"ROI（手動）= {roi}")

        mask, parts, thr, drops = extract_parts(gray, roi, min_area, thr_offset)

        view = draw_overlay(frame.copy(), roi, parts)
        x, y, w, h = roi
        cv2.rectangle(view, (x, y), (x + w, y + h), (200, 200, 200), 1)
        if drag["active"] and drag["p0"] and drag["cur"]:
            dx, dy, dw, dh = _rect(drag["p0"], drag["cur"])
            cv2.rectangle(view, (dx, dy), (dx + dw, dy + dh), (0, 255, 255), 2)

        exp = C.BUILDABLE_CHARS[expect_i]

        # --- 静止したら1回だけ判定する ---------------------------------
        now = time.time()
        sig = scene_signature(parts)
        if sig != sig_prev:
            sig_prev, sig_since = sig, now      # 動いた。計時をやり直す
        still = now - sig_since
        ready = auto and parts and sig != sig_judged and still >= C.STILL_SEC
        if ready:
            sig_judged = sig
            last = judge(mask, exp, tally)

        oh, ot = tally[exp]["ocr"]
        ih, it = tally[exp]["iou"]
        draw_hud(view, [
            f"parts: {len(parts)}     thr: {thr}     min_area: {min_area}",
            f"dropped: small {drops['small']}  large {drops['large']}"
            f"  border {drops['border']}",
            f"expect: [{expect_i + 1}]   OCR {oh}/{ot}    IoU {ih}/{it}",
            f"OCR {'OK' if last['ocr'][2] else 'NG'} {last['ocr'][1]:.2f}   "
            f"IoU {'OK' if last['iou'][2] else 'NG'} {last['iou'][1]:.2f}",
            (f"AUTO  still {still:.1f}/{C.STILL_SEC:.1f}s"
             + ("  (judged)" if sig == sig_judged else "")) if auto else "MANUAL (SPACE)",
            "1-6:expect SPACE:judge t:auto v:cam a:roi [ ]:area s:save q:quit",
        ])
        # 日本語は PIL で右上に
        view = draw_jp(view, f"組: {exp}", (W - 400, 14), 46, (255, 255, 255))
        if last["ocr"][0]:
            col = (0, 255, 0) if last["ocr"][2] else (0, 80, 255)
            view = draw_jp(view, f"OCR: {last['ocr'][0]}", (W - 400, 70), 40, col)
        if last["iou"][0]:
            col = (0, 255, 0) if last["iou"][2] else (0, 80, 255)
            view = draw_jp(view, f"IoU: {last['iou'][0]} {last['iou'][1]:.2f}",
                           (W - 400, 122), 40, col)

        cv2.imshow(win, view)
        key = cv2.waitKey(1) & 0xFF

        if key == ord("q"):
            break
        elif ord("1") <= key <= ord("6"):
            i = key - ord("1")
            if i < len(C.BUILDABLE_CHARS):
                expect_i = i
                print(f"→ いま組む字: {C.BUILDABLE_CHARS[i]}")
        elif key == ord(" "):
            if len(parts) == 0:
                print("部品が検出されていない。")
                continue
            last = judge(mask, exp, tally)
            sig_judged = sig
        elif key == ord("v"):
            cap.release()
            cam_pos = (cam_pos + 1) % len(available)
            cap = open_camera(available[cam_pos])
            roi = None
            print(f"camera [{available[cam_pos]}] へ切り替え")
        elif key == ord("t"):
            auto = not auto
            sig_judged = None
            print(f"判定: {'自動（静止したら1回）' if auto else '手動（SPACE）'}")
        elif key == ord("a"):
            found = auto_screen_roi(gray)
            if found:
                roi = found; print(f"ROI（自動検出）= {roi}")
        elif key == ord("f"):
            roi = (0, 0, W, H)
        elif key == ord("["):
            min_area = max(50, min_area - 100)
        elif key == ord("]"):
            min_area += 100
        elif key == ord("-"):
            thr_offset -= 2
        elif key == ord("="):
            thr_offset += 2
        elif key == ord("s"):
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            clean = R.render_for_ocr(mask)
            cv2.imwrite(os.path.join(SAVE_DIR, f"{stamp}_ocr_view.png"), view)
            if clean is not None:
                cv2.imwrite(os.path.join(SAVE_DIR, f"{stamp}_ocr_input.png"), clean)
            print(f"保存: {stamp}_ocr_view.png / {stamp}_ocr_input.png")

    cap.release()
    cv2.destroyAllWindows()

    print("\n=== 集計 ===            OCR        IoU")
    tot = {"ocr": [0, 0], "iou": [0, 0]}
    for ch in C.BUILDABLE_CHARS:
        oh, ot = tally[ch]["ocr"]; ih, it = tally[ch]["iou"]
        tot["ocr"][0] += oh; tot["ocr"][1] += ot
        tot["iou"][0] += ih; tot["iou"][1] += it
        if ot:
            print(f"  {ch} :  {oh}/{ot} ({oh/ot*100:3.0f}%)   {ih}/{it} ({ih/it*100:3.0f}%)")
    oh, ot = tot["ocr"]; ih, it = tot["iou"]
    if ot:
        print(f"  合計: {oh}/{ot} ({oh/ot*100:3.0f}%)   {ih}/{it} ({ih/it*100:3.0f}%)")


if __name__ == "__main__":
    main()
