#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# KumiJi — カメラを使わない自己確認
#
#   python3 selftest.py
#
#   1. 状態機械（state.py）を単体で試す。実機で潰したふるまいがそのまま
#      入っているかを見る
#   2. 台本どおりの合成フレームで本体を通し、**1フレームずつ画面の指紋を取る**
#
#   2 が効くのは、直したつもりで別のところを壊したときに気づけること。
#   実機で確かめるには照明も投影も要るが、ここは机上で 10 秒で終わる。
#   指紋が変わったら、変えた覚えがあるかを自分に問うこと。
# -----------------------------------------------------------------------------
import os
import sys
import hashlib

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import config as C
import state as S


# =============================================================================
#  1. 状態機械
# =============================================================================
def test_state():
    ok = [True]

    def check(label, got, want):
        good = got == want
        ok[0] &= good
        print(f"  {'OK ' if good else '★NG'} {label}: {got}"
              + ("" if good else f"   （期待 {want}）"))

    now = 1_000_000.0
    print("初回フレームで静止判定を通過しないこと")
    p = S.Piece()
    p.observe(now, [(10, 10)])
    check("初回の still", round(p.still(now), 3), 0.0)
    check("初回に読みたがらない", p.wants_read(now, True), False)
    check("STILL_SEC 後に読みたがる", p.wants_read(now + C.STILL_SEC + 0.01, True), True)

    print("部品数のちらつきで数え直さないこと")
    p = S.Piece()
    p.observe(now, [(10, 10), (50, 50)])
    base = p.arr_id
    for i in range(1, 10):
        cur = [(10, 10)] if i % 3 == 0 else [(10, 10), (50, 50)]
        p.observe(now + i / 30.0, cur)
    check("ちらついても arr_id は増えない", p.arr_id - base, 0)
    for i in range(30):
        p.observe(now + 1.0 + i / 30.0, [(200, 200)])
    check("本当に動いたら増える", p.arr_id - base, 1)

    print("同じ配置を二度定着させないこと")
    p = S.Piece()
    p.observe(now, [(100, 100)])
    p.accept_read(now, "よい", 1.0)
    check("1枚目は new", p.fix_verdict([(100, 100)]), "new")
    p.note_fixed(now, [(100, 100)])
    check("同じ配置は済み", p.fix_verdict([(100, 100)]), "")
    p.arr_id += 1
    check("10px ずらしただけなら already", p.fix_verdict([(110, 100)]), "already")
    check("80px 動かせば new", p.fix_verdict([(180, 100)]), "new")

    print("絵文字のクールダウンが延びること")
    import main as M

    def fires(seq):
        q = S.Piece()
        return sum(1 for ch, dt in seq
                   if q.maybe_react(now + dt, ch, M.match_emoji(ch)))
    # 実機ログの並び。途中で1部品になり、辞書に無い「し」と読まれる
    check("置いたまま読み続けて", fires([("すし", 0), ("すし", 1.5), ("すし", 3.0),
                                   ("し", 4.5), ("すし", 6.0), ("すし", 7.5),
                                   ("すし", 9.0), ("すし", 10.5)]), 1)
    check("間が空けば再発火", fires([("すし", 0), ("すし", 1.5), ("すし", 20.0)]), 2)
    check("別の当たり語を挟めば", fires([("すし", 0), ("なし", 2.0), ("すし", 4.0)]), 3)
    check("辞書に無い語だけなら", fires([("ほげ", 0), ("ほげ", 2.0)]), 0)

    print("光は読めていなければ育たないこと")
    p = S.Piece()
    check("読めていない時", p.progress(now + 10, True), 0.0)
    p.accept_read(now, "よい", 1.0)
    check("FIX_SECONDS 後", p.progress(now + C.FIX_SECONDS, True), 1.0)
    check("部品をどけたら 0", p.progress(now + C.FIX_SECONDS, False), 0.0)

    print("全部どけたら抑止が解ける。ただし一瞬の 0 では解けないこと")
    p = S.Piece()
    p.note_fixed(now, [(100, 100)])
    p.maybe_react(now, "すし", ["🍣"])
    # 1フレームだけ 0 になる（検出のちらつき）
    check("1フレームの 0 では解けない", p.update_presence(now, False), False)
    check("その間 fixed_c は残る", p.fixed_c is not None, True)
    p.update_presence(now + 1 / 30.0, True)          # また見えた
    check("見えたら計時はやり直し",
          p.update_presence(now + 2 / 30.0, False), False)
    # 本当にどけた。無い状態が CLEAR_CONFIRM_SEC 続いたところで解ける
    t0 = now + 2 / 30.0                       # 無くなった時刻
    check("まだ足りない",
          p.update_presence(t0 + C.CLEAR_CONFIRM_SEC - 0.1, False), False)
    check("続けば解ける",
          p.update_presence(t0 + C.CLEAR_CONFIRM_SEC + 0.01, False), True)
    check("解いたあとは言い続けない", p.update_presence(now + 5.0, False), False)
    check("fixed_c が消える", p.fixed_c, None)
    check("react_word が消える", p.react_word, "")

    print("ちらつきで同じ語が二度反応しないこと（実機の「なつ」）")
    import main as M
    p = S.Piece()
    fired = 0
    # 「なつ」を読み続けるあいだ、部品数が 4→0→4 とちらつく
    for i in range(12):
        t = now + i * 0.4
        p.update_presence(t, i % 4 != 0)             # 4フレームに1回 0 になる
        if p.maybe_react(t, "なつ", M.match_emoji("なつ")):
            fired += 1
    check("ちらついても発火は1回", fired, 1)
    return ok[0]


# =============================================================================
#  2. 台本どおりに本体を通す
# =============================================================================
JP_FONT = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"

# FIX_SECONDS + STILL_SEC + 移動 で約 5秒。余裕を見て 200 フレーム保持する。
SCRIPT = [
    (40,  "",     0),      # 何も置いていない
    (200, "よい", 0),      # 置く → 読む → 光る → 定着 → 移動
    (60,  "よい", 8),      # 微調整（再定着しない）
    (200, "すし", 0),      # 別の語へ作り直す
    (40,  "",     0),      # 全部どける
    (200, "よい", 0),      # 同じ語をもう一度
    (200, "ほげ", 0),      # 辞書に無い語（反応はしないが定着はする）
]


def frame_with(word, dx=0):
    """白い面に黒い字を置いた合成フレーム。"""
    from PIL import Image, ImageDraw, ImageFont
    H, W = 720, 1280
    sx, sy, sw, sh = 190, 95, 900, 520
    fr = np.full((H, W), 60, np.uint8)
    cv2.rectangle(fr, (sx, sy), (sx + sw, sy + sh), 232, -1)
    if word:
        pw = int(sw * 0.72)
        g = Image.new("L", (pw, sh), 0)
        d = ImageDraw.Draw(g)
        f = ImageFont.truetype(JP_FONT, int(sh * 0.42))
        bb = d.textbbox((0, 0), word, font=f)
        d.text(((pw - (bb[2] - bb[0])) // 2 - bb[0] + dx,
                (sh - (bb[3] - bb[1])) // 2 - bb[1]), word, fill=255, font=f)
        fr[sy:sy + sh, sx:sx + pw][np.array(g) > 0] = 36
    return cv2.cvtColor(cv2.GaussianBlur(fr, (3, 3), 0), cv2.COLOR_GRAY2BGR)


def test_run():
    if not os.path.exists(JP_FONT):
        print("  （日本語フォントが無いので通し確認は飛ばす）")
        return True, ""

    frames, answers = [], []
    for n, w, dx in SCRIPT:
        f = frame_with(w, dx)
        frames += [f] * n
        answers += [w] * n

    import main as M
    import view as V
    import recognize as R
    import page_server

    # 時計を偽物にする。実時間で回すと結果が毎回変わって比べられない。
    box = {"i": 0}
    M.time.time = lambda: 1_000_000.0 + box["i"] / 30.0

    class Cap:
        def isOpened(self): return True
        def read(self): return True, frames[min(box["i"], len(frames) - 1)].copy()
        def set(self, *a): return False
        def get(self, *a): return 0.0
        def release(self): pass

    M.open_camera = lambda idx: Cap()
    M.list_cameras = lambda *a, **k: [0]

    # 認識器も台本どおりに答える（Vision を呼ばない＝毎回同じ）
    def read(gray, parts, targets=None, pad=None, roi=None):
        if not parts:
            return ("", 0.0)
        w = answers[min(box["i"], len(answers) - 1)]
        return (w, 1.0) if w else ("", 0.0)
    R.recognize_vision_raw = read
    M.R.recognize_vision_raw = read

    pushes = []
    page_server.start = lambda *a, **k: None
    page_server.push = lambda ev: pushes.append(ev)
    for nm in ("imshow", "namedWindow", "resizeWindow", "setMouseCallback",
               "destroyWindow", "destroyAllWindows", "setWindowProperty"):
        setattr(cv2, nm, lambda *a, **k: None)

    marks = []
    orig_fit = V.fit_output

    def fit(canvas, rect=None):
        out = orig_fit(canvas, rect)
        marks.append(hashlib.md5(out.tobytes()).hexdigest()[:8])
        return out
    V.fit_output = fit

    N = len(frames)
    seen = {"n": 0}

    def waitkey(ms):
        box["i"] += 1
        seen["n"] += 1
        return ord("q") if seen["n"] >= N else 255
    cv2.waitKey = waitkey

    try:
        M.main()
    except SystemExit as e:
        print(f"  ★ SystemExit: {e}")
        return False, ""
    except Exception:
        import traceback
        print("  ★ 例外で落ちた")
        traceback.print_exc()
        return False, ""

    body = "\n".join(
        [f"frames={len(marks)}"]
        + ["push " + " ".join(f"{k}={p[k]}" for k in sorted(p)) for p in pushes]
        + marks)
    fp = hashlib.sha256(body.encode()).hexdigest()[:16]
    # 指紋が変わったときに「どのフレームから」を見るための書き出し。
    #   KUMIJI_DUMP=/tmp/a.txt python3 selftest.py
    dump = os.environ.get("KUMIJI_DUMP")
    if dump:
        open(dump, "w").write(body)
        print(f"  書き出した: {dump}")
    fixed = [p for p in pushes if "fixed" in p]
    print(f"  {len(marks)} フレーム完走  push {len(pushes)}件"
          f"（うち定着 {len(fixed)}件）")
    for p in fixed:
        print(f"    定着 {p['fixed']}枚目: 「{p['char']}」 {p.get('emoji') or '—'}")
    return True, fp


# 台本を変えたらここも変える。変えていないのに変わったら、どこかを壊している。
EXPECT = "b8dc8fdf762eaba8"

if __name__ == "__main__":
    print("=== 1. 状態機械 ===")
    a = test_state()
    print("\n=== 2. 台本どおりに通す ===")
    b, fp = test_run()
    if fp:
        same = fp == EXPECT
        print(f"\n画面の指紋: {fp}"
              + ("  （記録と一致）" if same
                 else f"  ★ 記録 {EXPECT} と違う。"
                      "変えた覚えがあるなら selftest.py の EXPECT を更新する"))
        b &= same
    print("\n" + ("すべて通った" if (a and b) else "★ 落ちたものがある"))
    sys.exit(0 if (a and b) else 1)
