#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# KumiJi / Step 1 — 輪郭プローブ
#   寝かせた液晶モニタ（白表示）の上に置いた 3Dプリント部品を、真上のカメラから
#   撮って「何個あるか・どこにあるか・どんな輪郭か」が安定して取れるかだけを見る。
#   認識も較正もまだしない。ここが通らないと先に進んでも無駄なので、最初に潰す。
#
#   モニタが下から光るので、部品の影が原理的に落ちないのがこの構成の利点。
#
# 使い方:
#   python3 probe_contour.py            # cv2 と numpy だけ。追加インストール不要
#
#   カメラを離して置く（プロジェクター構成）ときは `z` で寄せてから ROI を取る。
#   起動したらまず `r` を押して、モニタの画面領域だけを ROI として囲うこと。
#   画面の外（机や部屋）が入っていると、大津の閾値が「画面 vs 机」で割れてしまい、
#   部品がまったく拾えない。ここが最初の詰まりどころ。
#
# 合否の1文:
#   モニタ上に部品を6個ばらばらに置いたとき、6個が6個として安定して取れるか。
# -----------------------------------------------------------------------------
import os
import sys
import datetime

import cv2
import numpy as np

import config as C

HERE = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.path.join(HERE, C.SAVE_DIR)


def open_camera(index):
    """指定インデックスのカメラを開く。開けなければ None。"""
    cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        cap.release()
        return None
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, C.FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, C.FRAME_HEIGHT)
    return cap


def try_optical_zoom(cap, zoom):
    """レンズの光学ズームを試す。効いたかどうかを返す。

    効けば画素が実際に増えるので、切り出しより望ましい。ただし macOS の
    AVFoundation 経由では **まず効かない**（set は成功を返すのに get が
    変わらない）。効いたかを get で確かめてから信じる。
    """
    if not cap.set(cv2.CAP_PROP_ZOOM, float(zoom)):
        return False
    got = cap.get(cv2.CAP_PROP_ZOOM)
    return abs(got - zoom) < 0.01 * max(1.0, zoom)


def zoom_crop(frame, zoom=None, center=None):
    """ズーム率に応じてフレームを切り出す。**拡大はしない。**

    引き伸ばすと画素が水増しになるだけで、OCR に渡せる情報は増えない。
    切り出した素の画素のまま返す。ウィンドウは WINDOW_NORMAL なので、
    小さい画を渡せば同じ枠に引き伸ばして表示される＝見た目はちゃんと寄る。

    戻り値は (切り出したフレーム, 切り出した矩形)。矩形は元フレーム座標で、
    HUD に出すのと、保存した画像を後から見るときの手掛かりに使う。
    """
    z = C.CAM_ZOOM if zoom is None else zoom
    cx, cy = C.CAM_CENTER if center is None else center
    H, W = frame.shape[:2]
    if z <= 1.0:
        return frame, (0, 0, W, H)

    w, h = max(32, int(W / z)), max(32, int(H / z))
    # 中心は指定どおりに寄せるが、切り出しがフレームの外へ出ないよう詰める
    x = int(np.clip(cx * W - w / 2, 0, W - w))
    y = int(np.clip(cy * H - h / 2, 0, H - h))
    return frame[y:y + h, x:x + w], (x, y, w, h)


def clamp_zoom(z):
    """ズーム率の範囲。上げすぎると視野が消えるので 6倍で止める。"""
    return float(np.clip(z, 1.0, 6.0))


def clamp_center(c):
    return (float(np.clip(c[0], 0.0, 1.0)), float(np.clip(c[1], 0.0, 1.0)))


def zoom_keys(key, zoom, center):
    """ズームとパンのキーを処理する。main.py と probe で同じ操作にするため
    ここに置く。小文字はカメラ側、大文字は写す範囲側（main.py）。

    戻り値は (zoom, center, 変わったか)。
    """
    z, c, hit = zoom, center, True
    if   key == ord("z"): z = clamp_zoom(zoom + C.CAM_ZOOM_STEP)
    elif key == ord("x"): z = clamp_zoom(zoom - C.CAM_ZOOM_STEP)
    elif key == ord("h"): c = clamp_center((center[0] - C.CAM_PAN_STEP, center[1]))
    elif key == ord("l"): c = clamp_center((center[0] + C.CAM_PAN_STEP, center[1]))
    elif key == ord("k"): c = clamp_center((center[0], center[1] - C.CAM_PAN_STEP))
    elif key == ord("j"): c = clamp_center((center[0], center[1] + C.CAM_PAN_STEP))
    else: hit = False
    return z, c, hit


def list_cameras(max_index=4):
    """使えるカメラのインデックスと解像度を調べて表示する。
    Continuity Camera（iPhone）のインデックスは固定でないので毎回これで探す。"""
    found = []
    for i in range(max_index):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            ok, frame = cap.read()
            if ok and frame is not None:
                h, w = frame.shape[:2]
                found.append((i, w, h))
                print(f"  [{i}] {w}x{h}")
        cap.release()
    if not found:
        print("  （見つからない。カメラの使用許可を確認）")
    return [i for i, _, _ in found]


def extract_parts(gray, roi, min_area, thr_offset, use_otsu=None):
    """ROI 内をグレースケールから二値化し、部品ごとの情報を返す。

    戻り値: (mask, parts, thr, drops)
      mask  : ROI と同じ大きさの二値画像（部品が白）
      parts : [{contour, cx, cy, area, bbox, rect}] ROI 座標系
      thr   : 実際に使った閾値（HUD 表示用）
      drops : {"small", "large", "border"} 何個をどの理由で捨てたか

    drops は勘で閾値を振るのをやめるために返している。「0個」だけでは
    閾値が外れているのか、面積のふるいで落ちているのかが分からない。
    実機で ROI を 80x82 まで小さく囲ったのに MIN_AREA=800（ROI 面積の 12%）
    のままで、閾値をどう振っても通らない状態に半時間費やした。
    """
    x, y, w, h = roi
    sub = gray[y:y + h, x:x + w]

    # 液晶を撮るとカメラの画素と干渉して縞（モアレ）が出る。先に潰す。
    k = C.BLUR_KERNEL | 1  # 必ず奇数に
    blur = cv2.GaussianBlur(sub, (k, k), 0)

    # 部品は画面面積の数%しかないので、大津は明るい側に引っ張られて高く出る。
    # 既定は固定閾値。`o` キーで大津に切り替えて比べられる。
    if use_otsu is None:
        use_otsu = C.USE_OTSU
    # 部品が地より暗いか明るいかで、二値化の向きが変わる。
    # モニタ構成は「下から光る地に黒い部品」なので暗い側。プロジェクターだと
    # 明るい部品を暗い地に置く構成が成り立つので、切り替えられるようにする。
    pol = cv2.THRESH_BINARY_INV if C.DETECT_DARK else cv2.THRESH_BINARY
    if use_otsu:
        base, _ = cv2.threshold(blur, 0, 255, pol | cv2.THRESH_OTSU)
    else:
        base = C.FIXED_THRESHOLD
    thr = int(np.clip(base + thr_offset, 0, 255))
    _, mask = cv2.threshold(blur, thr, 255, pol)

    # 面積でゴミを落とす。大きすぎるものは背景（画面の外や影）なので同じく捨てる。
    # あわせて ROI の縁に接する塊も捨てる。画面に置いた部品は縁に触れないので、
    # 縁に触れているものは画面の縁・ベゼル・明るさムラだと判断してよい。
    max_area = w * h * C.MAX_AREA_RATIO
    pad = C.BORDER_PAD
    n, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
    clean = np.zeros_like(mask)
    drops = {"small": 0, "large": 0, "border": 0}
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < min_area:
            drops["small"] += 1
            continue
        if area > max_area:
            drops["large"] += 1
            continue
        if C.DROP_BORDER:
            bx, by = stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP]
            bw, bh = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
            if bx <= pad or by <= pad or bx + bw >= w - pad or by + bh >= h - pad:
                drops["border"] += 1
                continue
        clean[labels == i] = 255

    contours, _ = cv2.findContours(clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    parts = []
    for cnt in contours:
        m = cv2.moments(cnt)
        if m["m00"] == 0:
            continue
        parts.append({
            "contour": cnt,
            "cx": m["m10"] / m["m00"],
            "cy": m["m01"] / m["m00"],
            "area": cv2.contourArea(cnt),
            "bbox": cv2.boundingRect(cnt),
            "rect": cv2.minAreaRect(cnt),   # (中心, (幅,高さ), 角度)
        })
    # 左上から順に番号が振られるように並べ替える（見ていて分かりやすい）
    parts.sort(key=lambda p: (round(p["cy"] / 50), p["cx"]))
    return clean, parts, thr, drops


def roi_stats(gray, roi):
    """ROI を大津で2つに割って、それぞれの平均を返す。

    はじめはパーセンタイル（暗い方1%）で測っていたが、**部品が占める面積の
    割合に振られる**。同じ場でも ROI を広く取ると部品が 1% に届かなくなり、
    実測で差が 33 と 12 に変わった。閾値を決める根拠がこれでは頼れない。

    大津は「2つの山に割る」ので、割ったあとの各クラスの平均を取れば
    面積の割合に依らない。部品が 0.5% でも 20% でも同じ値が出る。

    戻り値: (部品側の平均, 地側の平均, 大津が選ぶ閾値, 部品側の面積比%)
    """
    x, y, w, h = roi
    sub = gray[y:y + h, x:x + w]
    if sub.size == 0:
        return (0, 0, 0, 0.0)
    k = C.BLUR_KERNEL | 1
    blur = cv2.GaussianBlur(sub, (k, k), 0)
    t, _ = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    t = int(t)
    dark = blur <= t
    lo = float(blur[dark].mean()) if dark.any() else 0.0
    hi = float(blur[~dark].mean()) if (~dark).any() else 255.0
    side = dark if C.DETECT_DARK else ~dark
    part, ground = (lo, hi) if C.DETECT_DARK else (hi, lo)
    return (int(round(part)), int(round(ground)), t, float(side.mean() * 100))


def auto_tune(gray, roi, max_parts=10, min_gap=25):
    """いまの ROI を見て、閾値と最小面積を決める。

    手順を短くするために作った。ここまで「囲う → `o` で大津 → `[` を数回」を
    毎回やり直していて、しかも起動のたびに失われていた。場が変わるたびに
    同じ探索をするなら、機械にやらせた方がよい。

    決め方:
      1. **まず地と部品の差を見る。** 差が min_gap 未満なら合わせない。
         部品が置かれていないか、照明が部品を洗ってしまっている。
         そこで無理に閾値を決めると、平らな面のノイズを部品として拾う
         （実測で、真っ白な紙に 890個の「部品」を見つけた）
      2. 閾値は大津に任せる。場ごとに正しい値が変わるので固定値は持たない
      3. その閾値で連結成分を取り、面積を大きい順に並べる
      4. 隣り合う面積の**比**が 3倍以上のところで切って、上側を部品とみなす。
         差ではなく比を見る。部品どうしの差より、部品とノイズの比の方が大きい
      5. 段差が無ければ、いちばん大きい塊の 20% を下限にする

    戻り値: (min_area, 部品数, 面積の上位, 閾値, 理由)
            合わせられなければ min_area は None で、理由に文が入る。
    """
    x, y, w, h = roi
    sub = gray[y:y + h, x:x + w]
    if sub.size == 0:
        return (None, 0, [], 0, "ROI が空")

    ink, ground, otsu, frac = roi_stats(gray, roi)
    gap = abs(ink - ground)
    if gap < min_gap:
        return (None, 0, [], otsu,
                f"地と部品の差が {gap} しかない（{min_gap} 未満）。"
                "部品が置かれていないか、照明が部品を洗っている。"
                "ここで閾値を決めると平らな面のノイズを拾うので、合わせない")

    k = C.BLUR_KERNEL | 1
    blur = cv2.GaussianBlur(sub, (k, k), 0)
    pol = cv2.THRESH_BINARY_INV if C.DETECT_DARK else cv2.THRESH_BINARY
    thr, mask = cv2.threshold(blur, 0, 255, pol | cv2.THRESH_OTSU)
    thr = int(thr)

    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    max_area = w * h * C.MAX_AREA_RATIO
    areas = sorted((int(stats[i, cv2.CC_STAT_AREA]) for i in range(1, n)
                    if stats[i, cv2.CC_STAT_AREA] <= max_area), reverse=True)
    if not areas:
        return (None, 0, [], thr, "大津の閾値では塊が1つも出ない")

    head = areas[:max_parts + 1]
    cut = None
    best = 3.0                      # これ未満の比は段差とみなさない
    for i in range(len(head) - 1):
        ratio = head[i] / max(1, head[i + 1])
        if ratio >= best:
            best, cut = ratio, i + 1
    if cut is not None:
        min_area = max(20, int(head[cut - 1] * 0.7))
        why = f"面積に {best:.0f}倍の段差があるので、そこで切った"
    else:
        min_area = max(20, int(areas[0] * 0.2))
        why = "段差が無いので、いちばん大きい塊の 20% を下限にした"
    min_area = min(min_area, int(max_area * 0.5))
    n_parts = sum(1 for a in areas if a >= min_area)
    return (min_area, n_parts, areas[:8], thr, why)


def auto_screen_roi(gray, margin=0.03):
    """画面（フレーム内で最大の明るい塊）を自動で見つけて ROI にする。

    机の上に寝かせた白いモニタは、周囲より明らかに明るい大きな矩形になるので
    これで取れる。macOS の cv2.selectROI は別ウィンドウが裏に開いて操作できない
    ことがあるため、手で囲わずに済むこちらを既定にした。
    """
    H, W = gray.shape[:2]
    blur = cv2.GaussianBlur(gray, (9, 9), 0)
    _, bright = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    # 画面の上に載った黒い部品で穴が空くので、閉じて1つの塊にする
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25))
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, k)

    cnts, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    big = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(big) < W * H * 0.05:      # 小さすぎるなら失敗とみなす
        return None

    x, y, w, h = cv2.boundingRect(big)
    mx, my = int(w * margin), int(h * margin)     # 画面の縁のにじみを避けて内側に入れる
    return (x + mx, y + my, max(10, w - 2 * mx), max(10, h - 2 * my))


# --- マウスドラッグで ROI を切る（別ウィンドウを開かないので macOS で確実） -----
drag = {"p0": None, "cur": None, "done": None, "active": False}


def _rect(a, b):
    x0, y0 = a
    x1, y1 = b
    return (min(x0, x1), min(y0, y1), abs(x1 - x0), abs(y1 - y0))


def on_mouse(event, x, y, flags, param):
    if event == cv2.EVENT_LBUTTONDOWN:
        drag["p0"], drag["cur"], drag["active"] = (x, y), (x, y), True
    elif event == cv2.EVENT_MOUSEMOVE and drag["active"]:
        drag["cur"] = (x, y)
    elif event == cv2.EVENT_LBUTTONUP and drag["active"]:
        drag["active"] = False
        r = _rect(drag["p0"], (x, y))
        if r[2] > 20 and r[3] > 20:
            drag["done"] = r


def draw_overlay(frame, roi, parts, show_index=True):
    """元映像に輪郭・重心・最小外接矩形・通し番号を重ねる。"""
    x, y, _, _ = roi
    off = np.array([x, y])

    for i, p in enumerate(parts):
        cv2.drawContours(frame, [p["contour"] + off], -1, C.CONTOUR_COLOR, 2)

        box = cv2.boxPoints(p["rect"]).astype(np.int32) + off
        cv2.polylines(frame, [box], True, C.BOX_COLOR, 1)

        cx, cy = int(p["cx"]) + x, int(p["cy"]) + y
        cv2.drawMarker(frame, (cx, cy), C.CENTROID_COLOR, cv2.MARKER_CROSS, 14, 2)

        if show_index:
            cv2.putText(frame, str(i), (cx + 10, cy - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, C.CENTROID_COLOR, 2)
    return frame


def draw_hud(frame, lines):
    """左上に半透明の帯を敷いて状態を出す。"""
    pad, lh = 10, 22
    h = pad * 2 + lh * len(lines)
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (430, h), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)
    for i, t in enumerate(lines):
        cv2.putText(frame, t, (pad, pad + lh * (i + 1) - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, C.HUD_COLOR, 1, cv2.LINE_AA)
    return frame


def main():
    os.makedirs(SAVE_DIR, exist_ok=True)

    print("使えるカメラを探す:")
    available = list_cameras()
    if not available:
        sys.exit("カメラが開けない。システム設定 > プライバシーとセキュリティ > カメラ を確認。")

    cam_pos = 0
    if C.CAMERA_INDEX in available:
        cam_pos = available.index(C.CAMERA_INDEX)
    cap = open_camera(available[cam_pos])
    print(f"\ncamera [{available[cam_pos]}] で開始。`c` で切り替え、`r` で ROI 指定。\n")

    roi = None
    min_area = C.MIN_AREA
    thr_offset = C.THRESHOLD_OFFSET
    use_otsu = C.USE_OTSU
    show_mask = False
    zoom, center = clamp_zoom(C.CAM_ZOOM), clamp_center(C.CAM_CENTER)
    if C.CAM_TRY_OPTICAL and zoom > 1.0:
        print(f"光学ズーム {zoom}: {'効いた' if try_optical_zoom(cap, zoom) else '効かない（切り出しで寄せる）'}")

    win = "KumiJi / contour probe"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(win, on_mouse)

    while True:
        ok, frame = cap.read()
        if not ok:
            print("フレームが取れない。`c` で別のカメラを試す。")
            if cv2.waitKey(300) & 0xFF == ord("q"):
                break
            continue

        # ズームは「切り出す」だけ。ここから下は切り出したフレームだけを見るので、
        # ROI も部品の座標も、すべて切り出し後の座標系で一貫する。
        frame, crop = zoom_crop(frame, zoom, center)
        H, W = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # 起動直後は画面領域を自動で探す。見つからなければ全画面のまま。
        if roi is None:
            roi = auto_screen_roi(gray) or (0, 0, W, H)
            print(f"ROI（自動検出）= {roi}")

        # ドラッグで手動指定されたらそちらを優先
        if drag["done"]:
            roi = drag["done"]
            drag["done"] = None
            print(f"ROI（手動）= {roi}")
        mask, parts, thr, drops = extract_parts(gray, roi, min_area, thr_offset,
                                                use_otsu)

        if show_mask:
            view = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
            view = draw_overlay(view, (0, 0, 0, 0), parts)
        else:
            view = draw_overlay(frame.copy(), roi, parts)
            x, y, w, h = roi
            cv2.rectangle(view, (x, y), (x + w, y + h), (200, 200, 200), 1)
            if drag["active"] and drag["p0"] and drag["cur"]:
                dx, dy, dw, dh = _rect(drag["p0"], drag["cur"])
                cv2.rectangle(view, (dx, dy), (dx + dw, dy + dh), (0, 255, 255), 2)

        full_roi = roi == (0, 0, W, H)
        ink, ground, otsu, frac = roi_stats(gray, roi)
        draw_hud(view, [
            f"parts: {len(parts)}   thr: {thr} ({'otsu' if use_otsu else 'fixed'} {thr_offset:+d})",
            f"min_area: {min_area} ({min_area / max(1, roi[2] * roi[3]) * 100:.0f}% of ROI)"
            f"    camera: {available[cam_pos]}",
            f"dropped: small {drops['small']}  large {drops['large']}"
            f"  border {drops['border']}",
            "ROI: FULL FRAME  <- drag on the window, or press 'a'" if full_roi
            else f"ROI: {roi[2]}x{roi[3]}  (drag / a:auto / f:full)",
            f"{'ink' if C.DETECT_DARK else 'lit'} {ink}   bg {ground}"
            f"   gap {abs(ink - ground)}   otsu {otsu}   area {frac:.1f}%",
            f"zoom: x{zoom:.1f}  center: ({center[0]:.2f}, {center[1]:.2f})"
            + (f"  crop {crop[2]}x{crop[3]}" if zoom > 1.0 else "  (full frame)"),
            "A:auto-tune  z x:zoom  h j k l:pan  a:find ROI  drag:ROI  c:cam b:mask o:otsu",
            "[ ]:area  - =:thr  s:save  q:quit",
        ])
        cv2.imshow(win, view)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("A"):
            ma, n, areas, t, why = auto_tune(gray, roi)
            if ma is None:
                print(f"  合わせられない: {why}")
            else:
                use_otsu, thr_offset, min_area = True, 0, ma
                print(f"  合わせた: 大津={t}  MIN_AREA={ma}  → 部品 {n}個   {why}")
        elif key == ord("a"):
            found = auto_screen_roi(gray)
            if found:
                roi = found
                print(f"ROI（自動検出）= {roi}")
            else:
                print("自動検出に失敗。ドラッグか `r` で手動指定を。")
        elif key == ord("r"):
            # 別ウィンドウが開く。裏に隠れることがあるので見つからなければドラッグで。
            sel = cv2.selectROI("select screen area (ENTER to fix)", frame,
                                showCrosshair=False)
            cv2.destroyWindow("select screen area (ENTER to fix)")
            if sel[2] > 10 and sel[3] > 10:
                roi = sel
                print(f"ROI = {roi}")
        elif key == ord("f"):
            roi = (0, 0, W, H)
            print("ROI を全画面に戻した")
        elif key == ord("c"):
            cap.release()
            cam_pos = (cam_pos + 1) % len(available)
            cap = open_camera(available[cam_pos])
            roi = None
            print(f"camera [{available[cam_pos]}] へ切り替え")
        elif key == ord("b"):
            show_mask = not show_mask
        elif key == ord("o"):
            use_otsu = not use_otsu
            print(f"閾値: {'大津' if use_otsu else '固定'}")
        elif key in (ord("z"), ord("x"), ord("h"), ord("j"), ord("k"), ord("l")):
            zoom, center, _ = zoom_keys(key, zoom, center)
            roi = None      # 画角が変わったので ROI を取り直す
            print(f"  CAM_ZOOM = {zoom:.2f}   "
                  f"CAM_CENTER = ({center[0]:.3f}, {center[1]:.3f})")
        elif key == ord("["):
            min_area = max(50, min_area - 100)
        elif key == ord("]"):
            min_area += 100
        elif key == ord("-"):
            thr_offset -= C.THRESHOLD_STEP
        elif key == ord("="):
            thr_offset += C.THRESHOLD_STEP
        elif key == ord("s"):
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            cv2.imwrite(os.path.join(SAVE_DIR, f"{stamp}_view.png"), view)
            cv2.imwrite(os.path.join(SAVE_DIR, f"{stamp}_mask.png"), mask)
            print(f"保存: {stamp}_view.png / {stamp}_mask.png  （parts={len(parts)}）")
            for i, p in enumerate(parts):
                x0, y0, w0, h0 = p["bbox"]
                print(f"  [{i}] center=({p['cx']:.0f},{p['cy']:.0f}) "
                      f"area={p['area']:.0f} bbox={w0}x{h0} angle={p['rect'][2]:.1f}")

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
