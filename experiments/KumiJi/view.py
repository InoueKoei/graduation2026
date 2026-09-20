#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# KumiJi — 見え方の層（カメラの画角と、投影する範囲）
#
#   ここが持つのは「どこを見て、どこへ映すか」だけ。作品の状態（state.py）も
#   描画の中身（main.py）も知らない。
#
#   分けた理由は、**この層だけが実機で毎回触られる**から。プロジェクターの
#   位置は日によって変わるので、寄せる・ずらす・台形を直すの操作が独立して
#   いないと、調整のたびに作品のロジックに触ることになる。
#
#   座標系は3つある。混ぜないこと。
#     元フレーム   … カメラが返す生の画（1280x720 など）。ROI はこれで持つ
#     切り出し     … ズームで切り出したあとの画。検出と部品の座標はこれ
#     画面         … 投影する 1920x1080。描画はこれ
# -----------------------------------------------------------------------------
import os
import re

import cv2
import numpy as np

import config as C
from probe_contour import (
    zoom_crop, zoom_keys, clamp_zoom, clamp_center, try_optical_zoom,
    auto_screen_roi, drag,
)

HERE = os.path.dirname(os.path.abspath(__file__))


# --- 画面の中の領域 ----------------------------------------------------------
def zone_rect(zone, cw, ch):
    """正規化された領域 (x,y,w,h) を画面の画素座標へ。"""
    x, y, w, h = zone
    return (int(x * cw), int(y * ch), int(w * cw), int(h * ch))


def place_roi(screen_roi):
    """カメラが見つけた画面のうち、置く場に当たる部分だけを検出範囲にする。"""
    sx, sy, sw, sh = screen_roi
    zx, zy, zw, zh = C.PLACE_ZONE
    return (int(sx + sw * zx), int(sy + sh * zy),
            max(10, int(sw * zw)), max(10, int(sh * zh)))


def roi_pt_to_canvas(pt, roi, cw, ch):
    """置く場内の座標（ROI基準）→ 画面座標。カメラがほぼ真上という線形近似。"""
    _, _, rw, rh = roi
    zx, zy, zw, zh = zone_rect(C.PLACE_ZONE, cw, ch)
    return (zx + pt[0] / max(1, rw) * zw, zy + pt[1] / max(1, rh) * zh)


def parts_mask_canvas(mask_roi, cw, ch):
    """検出マスクをそのまま画面座標へ写す。

    以前は輪郭から fillPoly で描き直していたが、それだと**リングの穴が埋まる**。
    「わ」や半濁点の○を置いても、定着する痕跡が穴のない塊になってしまう。

    extract_parts が返すマスクは連結成分から作られているので、穴は最初から
    正しく空いている。描き直さず、置く場の矩形へ拡大するだけでよい。
    """
    x, y, w, h = zone_rect(C.PLACE_ZONE, cw, ch)
    m = np.zeros((ch, cw), np.uint8)
    if w > 0 and h > 0:
        m[y:y + h, x:x + w] = cv2.resize(mask_roi, (w, h),
                                         interpolation=cv2.INTER_NEAREST)
    return m


# --- 座標系のあいだ ----------------------------------------------------------
def crop_to_full(rect, crop):
    """切り出したフレームの座標 → 元フレームの座標。"""
    x, y, w, h = rect
    return (x + crop[0], y + crop[1], w, h)


def full_to_crop(rect, crop):
    """元フレームの座標 → いま切り出しているフレームの座標。

    ズームは**同じ場所を切り出し方を変えて見ているだけ**なので、ROI は
    取り直すのではなく変換して持ち越す。取り直すと、手で囲った範囲が
    ズームのたびに捨てられ、当てにならない自動検出に戻されてしまう。

    切り出しの外へ出た分は落とす。完全に外れたら None。
    """
    x, y, w, h = rect
    cx, cy, cw, ch = crop
    x0, y0 = max(x - cx, 0), max(y - cy, 0)
    x1, y1 = min(x - cx + w, cw), min(y - cy + h, ch)
    if x1 - x0 < 10 or y1 - y0 < 10:
        return None
    return (int(x0), int(y0), int(x1 - x0), int(y1 - y0))


# --- 写す範囲 ----------------------------------------------------------------
def clamp_rect(r):
    """写す範囲を画面の中に収める。画面そのものがプロジェクターの枠なので、
    外へ出しても投影されないだけ。出せないように詰めておく。"""
    x, y, w, h = r
    w = float(np.clip(w, 0.05, 1.0))
    h = float(np.clip(h, 0.05, 1.0))
    return (float(np.clip(x, 0.0, 1.0 - w)), float(np.clip(y, 0.0, 1.0 - h)), w, h)


def fit_output(canvas, rect=None):
    """描いた画面を写す範囲の中へ収める。範囲の外は OUT_BG。

    プロジェクターは黒を「光を出さない」で表すので、外側は何も映らない。
    投影面より投影が大きいときに、はみ出しを切り落とすのに使う。
    """
    rect = C.OUT_RECT if rect is None else rect
    if not C.OUT_CORNERS and tuple(rect) == (0.0, 0.0, 1.0, 1.0):
        return canvas

    ch, cw = canvas.shape[:2]
    out = np.full_like(canvas, C.OUT_BG)

    if not C.OUT_CORNERS:
        # 矩形なら縮小して貼るだけ。透視変換より十倍以上速い。
        x, y, w, h = rect
        x0, y0 = int(x * cw), int(y * ch)
        w0 = max(1, min(int(w * cw), cw - x0))
        h0 = max(1, min(int(h * ch), ch - y0))
        out[y0:y0 + h0, x0:x0 + w0] = cv2.resize(canvas, (w0, h0),
                                                 interpolation=cv2.INTER_AREA)
        return out

    # 4隅指定（台形補正）。プロジェクター本体で追い込めない残りを詰める用。
    src = np.float32([(0, 0), (cw, 0), (cw, ch), (0, ch)])
    dst = np.float32([(px * cw, py * ch) for px, py in C.OUT_CORNERS])
    return cv2.warpPerspective(canvas, cv2.getPerspectiveTransform(src, dst),
                               (cw, ch), flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_CONSTANT,
                               borderValue=(C.OUT_BG,) * 3)


def draw_out_guide(canvas):
    """写す範囲の位置合わせ用の枠。**画面の縁そのもの**に描く。

    これを描いたあと fit_output で写し込むので、枠はちょうど写す範囲の外周に
    一致する。プロジェクターの向きとレンズはこの枠を見ながら合わせ、
    残りを `H J K L` `Z X` で詰める。

    枠を出しているあいだは検出を止めるので、色は濃くてよい（見えることが先）。
    """
    ch, cw = canvas.shape[:2]
    col = C.OUT_GUIDE_COLOR
    n = max(1, C.OUT_GUIDE_DIV)
    for i in range(1, n):
        x, y = cw * i // n, ch * i // n
        cv2.line(canvas, (x, 0), (x, ch), col, 2)
        cv2.line(canvas, (0, y), (cw, y), col, 2)

    # 線の太さは中心に対して引かれるので、縁に置くと半分が画面の外へ出る。
    # 太さの半分だけ内側へ寄せて、全部が映るようにする。
    t, a = 8, max(40, min(cw, ch) // 8)
    o = t // 2
    cv2.rectangle(canvas, (o, o), (cw - 1 - o, ch - 1 - o), col, t)

    # 4隅の鉤。角がちゃんと投影面に載っているかを遠目で確かめる目印
    for ox, sx in ((o, 1), (cw - 1 - o, -1)):
        for oy, sy in ((o, 1), (ch - 1 - o, -1)):
            cv2.line(canvas, (ox, oy), (ox + sx * a, oy), col, t * 3)
            cv2.line(canvas, (ox, oy), (ox, oy + sy * a), col, t * 3)
    cv2.drawMarker(canvas, (cw // 2, ch // 2), col, cv2.MARKER_CROSS, a, 4)
    return canvas


def out_keys(key, rect):
    """写す範囲のキー。**大文字が写す範囲、小文字がカメラ**で揃えてある。
    拡縮は中心を保つ（向きを合わせたあとに大きさだけ詰められる）。"""
    x, y, w, h = rect
    d, hit = C.CAM_PAN_STEP, True
    if key == ord("H"):
        x -= d
    elif key == ord("L"):
        x += d
    elif key == ord("K"):
        y -= d
    elif key == ord("J"):
        y += d
    elif key in (ord("Z"), ord("X")):
        f = 1.0 + (d if key == ord("Z") else -d)
        x, y = x - w * (f - 1) / 2, y - h * (f - 1) / 2
        w, h = w * f, h * f
    else:
        hit = False
    return clamp_rect((x, y, w, h)), hit


def warn_roi(roi, fw, fh):
    """検出範囲が狭すぎないか見る。

    ここが小さいと OCR に渡る画像も小さくなり、Vision はテキスト行として
    拾わない。実機で 60x57 まで絞ってしまい、閾値も面積も合っているのに
    何も読めない状態になった。**先に言う方がよい。**
    """
    w, h = roi[2], roi[3]
    pw = int(w * C.PLACE_ZONE[2])        # 実際に検出されるのはこの幅だけ
    ph = int(h * C.PLACE_ZONE[3])
    if w < 300 or h < 300:
        print(f"  ★ 検出範囲が狭い（{w}x{h}、置く場は {pw}x{ph}）。"
              "OCR に渡る画像が小さすぎて読まれない。")
        print("     囲うのは**文字ではなく紙**。縁に触れた塊は捨てる設定なので"
              "（DROP_BORDER）、文字にぴったり寄せると部品ごと落ちる。")
        print(f"     カメラを寄せるか、紙を大きくするか、広く囲い直す"
              f"（目安 300x300 以上、フレーム幅 {fw} の 1/3 以上）。")
    elif w < fw / 3:
        print(f"  （検出範囲がフレーム幅の {w / fw * 100:.0f}%、"
              f"置く場は {pw}x{ph}。投影面がもっと大きく写る方が読みやすい）")


def save_view_config(zoom, center, rect, roi=None):
    """いま合わせた値を config.py に書き戻す。`W` キー。

    走らせながら config.py を手で編集していることがあるので、**書く直前に
    ディスクから読み直して**この数行だけを差し替える。他の編集には触らない。
    行末のコメントもそのまま残す。
    """
    path = os.path.join(HERE, "config.py")
    try:
        src = open(path, encoding="utf-8").read()
    except OSError as e:
        print(f"  config.py が読めない: {e}")
        return
    want = {
        "CAM_ZOOM":   f"{zoom:.2f}",
        "CAM_CENTER": f"({center[0]:.3f}, {center[1]:.3f})",
        "OUT_RECT":   f"({rect[0]:.3f}, {rect[1]:.3f}, {rect[2]:.3f}, {rect[3]:.3f})",
    }
    if roi is not None:
        want["SCREEN_ROI"] = f"({roi[0]}, {roi[1]}, {roi[2]}, {roi[3]})"
    done = []
    for k, v in want.items():
        m = re.search(rf"^({k}\s*=\s*)([^\n#]*?)(\s*#.*)?$", src, re.M)
        if m is None:
            print(f"  {k} の行が見つからない。手で書いて。")
            continue
        src = src[:m.start()] + m.group(1) + v + (m.group(3) or "") + src[m.end():]
        done.append(f"{k} = {v}")
    if done:
        open(path, "w", encoding="utf-8").write(src)
        print("  config.py に書き戻した: " + " / ".join(done))


class View:
    """カメラの画角と、投影する範囲。実機で毎回触られる値をここに集める。

    小文字のキーがカメラ側、大文字が写す範囲側。`W` で config へ書き戻す。
    """

    def __init__(self):
        self.zoom = clamp_zoom(C.CAM_ZOOM)
        self.center = clamp_center(C.CAM_CENTER)
        self.out_rect = clamp_rect(C.OUT_RECT)
        self.show_guide = C.OUT_GUIDE
        self.screen_roi = None       # 元フレームの座標で持つ（ズームで失われない）
        self.crop = (0, 0, 0, 0)
        self.view_roi = None         # 切り出しの中での ROI
        self._warned = False

    def try_optical(self, cap):
        if C.CAM_TRY_OPTICAL and self.zoom > 1.0:
            got = try_optical_zoom(cap, self.zoom)
            print(f"光学ズーム {self.zoom}: "
                  f"{'効いた' if got else '効かない（切り出しで寄せる）'}")

    # --- 取り込み -----------------------------------------------------------
    def take(self, raw):
        """生のフレームを切り出す。ここから下は切り出した座標系で一貫する。"""
        frame, self.crop = zoom_crop(raw, self.zoom, self.center)
        return frame

    def resolve_roi(self, gray, W, H):
        """検出範囲を決める。config → 自動検出 → ドラッグ の優先順。"""
        if self.screen_roi is None:
            if C.SCREEN_ROI:
                self.screen_roi = tuple(C.SCREEN_ROI)
                print(f"画面 ROI = {self.screen_roi}（config.SCREEN_ROI）")
            else:
                det = auto_screen_roi(gray) or (0, 0, W, H)
                self.screen_roi = crop_to_full(det, self.crop)
                print(f"画面 ROI = {self.screen_roi}（自動）")
            warn_roi(self.screen_roi, W, H)

        # 確認ウィンドウの上でドラッグされたらそちらを優先。
        # プロジェクターだと投影面がいちばん明るい塊にならないことがあり、
        # そのとき自動検出はフレーム全部を返したり、関係ない塊を掴んだりする。
        if drag["done"]:
            self.screen_roi = crop_to_full(drag["done"], self.crop)
            drag["done"] = None
            print(f"画面 ROI = {self.screen_roi}（手動・元フレーム座標）")
            print(f"  config.py に固定するなら  SCREEN_ROI = {self.screen_roi}"
                  "   （`W` キーでも書ける）")
            warn_roi(self.screen_roi, W, H)

        vr = full_to_crop(self.screen_roi, self.crop)
        if vr is None:
            # 寄せすぎて ROI が画角の外に出た。いまの画角そのものを使う。
            vr = (0, 0, W, H)
            if not self._warned:
                print("  ROI が画角の外に出た。`x` で引くか、囲い直す。")
                self._warned = True
        else:
            self._warned = False
        self.view_roi = vr
        return place_roi(vr)

    def refind_roi(self, gray):
        det = auto_screen_roi(gray)     # `found` は見つけた語の集合。使わないこと
        if det:
            self.screen_roi = crop_to_full(det, self.crop)
            print(f"画面 ROI = {self.screen_roi}（自動・元フレーム座標）")
        else:
            print("  自動検出に失敗。確認ウィンドウの上をドラッグして囲う。")

    # --- 出力 ---------------------------------------------------------------
    def present(self, canvas):
        """描き終わった画面を、写す範囲へ収めて返す。"""
        if self.show_guide:
            draw_out_guide(canvas)
        return fit_output(canvas, self.out_rect)

    # --- キー ---------------------------------------------------------------
    def handle_key(self, key):
        """この層のキーを処理する。扱ったら True。"""
        if key in (ord("z"), ord("x"), ord("h"), ord("j"), ord("k"), ord("l")):
            self.zoom, self.center, _ = zoom_keys(key, self.zoom, self.center)
            # ROI は取り直さない。元フレームの座標で持っているので、
            # 切り出し方が変わっても同じ場所を指したままになる。
            print(f"  カメラ  CAM_ZOOM = {self.zoom:.2f}  "
                  f"CAM_CENTER = ({self.center[0]:.3f}, {self.center[1]:.3f})")
            return True
        if key in (ord("Z"), ord("X"), ord("H"), ord("J"), ord("K"), ord("L")):
            self.out_rect, _ = out_keys(key, self.out_rect)
            print("  写す範囲  OUT_RECT = "
                  f"({self.out_rect[0]:.3f}, {self.out_rect[1]:.3f}, "
                  f"{self.out_rect[2]:.3f}, {self.out_rect[3]:.3f})"
                  + ("   ★ OUT_CORNERS を指定しているので、この値は効かない。"
                     "矩形で合わせたいなら config.py の OUT_CORNERS を None に"
                     if C.OUT_CORNERS else ""))
            return True
        if key == ord("g"):
            self.show_guide = not self.show_guide
            print("  位置合わせの枠を出した（このあいだは読まない）"
                  if self.show_guide else "  枠を消した。読みを再開する")
            return True
        if key == ord("W"):
            save_view_config(self.zoom, self.center, self.out_rect, self.screen_roi)
            return True
        return False

    def reload(self):
        """config を読み直したときに、この層の値も戻す。"""
        self.zoom = clamp_zoom(C.CAM_ZOOM)
        self.center = clamp_center(C.CAM_CENTER)
        self.out_rect = clamp_rect(C.OUT_RECT)
        self.show_guide = C.OUT_GUIDE
        # ROI は config に書いてあればそれに従う。無ければ手で囲ったものを
        # そのまま残す（勝手に捨てないこと）。
        if C.SCREEN_ROI:
            self.screen_roi = tuple(C.SCREEN_ROI)
            print(f"  画面 ROI = {self.screen_roi}（config.SCREEN_ROI）")
