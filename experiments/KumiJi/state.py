#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# KumiJi — 作品の状態機械
#
#   「配置が変わった／静止した／読めた／濃くなりきった／定着した／反応した」
#   という移り変わりだけを持つ。**描画もカメラも OCR も知らない。**
#
#   もともとこれは main.py の 441行のループの中に、39個のローカル変数として
#   散っていた。そのせいで2回落ちた——セルの数を `cap` という名前で持って
#   カメラを潰し、ROI を `found` という名前で持って「見つけた語」の集合を
#   潰した。どちらも名前が衝突しただけで、ロジックの誤りではない。
#   状態が裸で並んでいる構造そのものが原因だった。
#
#   ここに閉じ込めると、状態は Piece の属性としてしか触れなくなる。
#   そしてカメラも窓も要らないので、**時計と配置だけ渡せば机上で試せる**。
# -----------------------------------------------------------------------------
import config as C


# --- 配置の比べ方 ------------------------------------------------------------
def centroids(parts):
    """並び順は extract_parts が左上から振ってあるので、そのまま使える。"""
    return [(p["cx"], p["cy"]) for p in parts]


def moved(prev, cur, tol):
    """配置が動いたか。量子化して完全一致を見ると、境界をまたぐノイズで
    誤って「動いた」になる。許容差つきで比べる。"""
    if prev is None or len(prev) != len(cur):
        return True
    return any(abs(a[0] - b[0]) > tol or abs(a[1] - b[1]) > tol
               for a, b in zip(prev, cur))


def lerp_rect(a, b, t):
    # 丸めずに切り捨てる。main.py にあったものと同じにしておくこと。
    # round にすると移動中の矩形が1画素ずれる。
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))


class Piece:
    """一つの上演のあいだ持ち越される状態。

    流れはこの順。
      1. observe()      配置を見る。変わったら arr_id が増える
      2. wants_read()   静止して STILL_SEC たったか
      3. accept_read() / reject_read()
      4. progress()     読めていれば光が育つ
      5. fix_verdict()  濃くなりきったら、新しい1枚か作り直しか
      6. begin_travel() → travel_rect() → land_travel()
    """

    def __init__(self):
        # 配置。arr_id が増えるたびに「別の配置」になる。読みと定着はこの id
        # に紐づくので、同じ配置を二度読んだり二度定着させたりしない。
        self.arr_id = 0
        self.prev_c = None
        # still_since は「まだ落ち着いていない」を None で表す。
        # 0.0 を入れると now がエポック秒なので still が17億秒になり、
        # 初回フレームで静止判定を無条件に通過してしまう。
        self.still_since = None
        self.move_since = None      # 変化が続いているか見るための計時
        self.empty_since = None     # 部品が無くなった時刻（ちらつきと区別する）
        self.cleared_at = None      # どの「無くなり」で抑止を解いたか

        # 読み
        self.read_for = -1          # どの配置で読んだか
        self.char = ""
        self.conf = 0.0
        self.read_at = None         # 読めた時刻。None なら読めていない
        self.fail_at = None         # 読めなかった時刻（再挑戦の判定用）

        # 定着
        self.fixed_for = -1
        self.fixed_at = None        # 定着した時刻（光が引くのに使う）
        self.fixed_c = None         # 定着したときの配置（二重定着を防ぐ）
        self.fixed = []             # [(痕跡マスク, 読まれた字)]
        self.travel = None          # 移動中の痕跡

        # 読めた語への反応
        self.react = None           # 流れている絵文字
        self.react_word = ""
        self.react_at = 0.0
        self.found = set()

    # --- 配置 ---------------------------------------------------------------
    def observe(self, now, cur_c):
        """配置を見る。新しい配置として確定したら True。

        変化が続いたときだけ「動いた」と認める。部品数は閾値の際でちらつくので、
        1フレームの取りこぼしで数え直してはいけない（実機で同じ「より」が2枚
        定着した）。ただし初回は待たずに確定させる（比べる相手がまだ無い）。
        """
        first = self.prev_c is None
        if first or moved(self.prev_c, cur_c, C.POS_TOL):
            if first:
                commit = True
            elif self.move_since is None:
                self.move_since, commit = now, False
            else:
                commit = now - self.move_since >= C.MOVE_CONFIRM_SEC
            if commit:
                self.prev_c, self.move_since = cur_c, None
                self.still_since = now
                self.arr_id += 1
                # 配置が変わったので、読みの状態をすべて捨てる
                self.char, self.conf = "", 0.0
                self.read_at, self.fail_at = None, None
                return True
        else:
            self.move_since = None      # 元に戻った＝ちらつきだった
        return False

    def still(self, now):
        return 0.0 if self.still_since is None else now - self.still_since

    def update_presence(self, now, has_parts):
        """全部どけたか見る。どけたなら抑止を解いて True。

        どけたときは定着の抑止も絵文字のクールダウンも解ける——次は同じもの
        でも定着してよいし、反応も出してよい。**だから一瞬の 0 で解いては
        いけない。** 実機で「なつ」が2枚定着し🌻が2回出た。読めずが連発する
        ような検出のちらつきでは部品数が一瞬 0 になり、そのたびに抑止が
        外れていた。配置の変化を MOVE_CONFIRM_SEC で待つのと同じ理屈。
        """
        if has_parts:
            self.empty_since = None
            return False
        if self.empty_since is None:
            self.empty_since = now
            return False
        if now - self.empty_since < C.CLEAR_CONFIRM_SEC:
            return False
        if self.cleared_at == self.empty_since:
            return False            # この「無くなり」ではもう解いてある
        self.cleared_at = self.empty_since
        self.fixed_c = None
        self.react_word, self.react_at = "", 0.0
        return True

    # --- 読み ---------------------------------------------------------------
    def wants_read(self, now, has_parts):
        """静止したら1回だけ読む。読めなければ何もしない。"""
        if not has_parts or self.read_at is not None:
            return False
        fresh = self.read_for != self.arr_id
        retry = (C.REREAD_SEC > 0 and self.fail_at is not None
                 and now - self.fail_at >= C.REREAD_SEC)
        return (fresh or retry) and self.still(now) >= C.STILL_SEC

    def begin_read(self):
        self.read_for = self.arr_id

    def accept_read(self, now, ch, conf):
        self.char, self.conf, self.read_at, self.fail_at = ch, conf, now, None

    def reject_read(self, now):
        self.fail_at = now

    # --- 反応 ---------------------------------------------------------------
    def maybe_react(self, now, ch, hits):
        """反応を出すか決める。出すなら True（そのとき状態も進む）。

        規則をここ1箇所に置いている。もともと「クールダウン」は状態側、
        「辞書に無い語は何もしない」は呼び出し側にあり、**2箇所に割れていた**。
        分かれていると、間に読めた別の語がクールダウンを解いてしまう取り違えを
        招く（辞書に無い「し」が「すし」の抑止を外す、など）。

        - 同じ語がクールダウン中なら、時刻だけ延ばして出さない。
          配置で判定すると部品数の揺れですり抜ける（実機で🍣が4回出た）ので、
          語と時間だけで止める。読み続けているあいだ延び続けるので、置いたまま
          なら反応は一度きり。片付けるか別の字にして間が空けば、また反応する。
        - 辞書に無い語（hits が空）は何もしない。**クールダウンも触らない。**
        """
        if ch == self.react_word and now - self.react_at < C.EMOJI_COOLDOWN_SEC:
            self.react_at = now                 # 読み続けているので延ばす
            return False
        if not hits:
            return False
        self.found.add(ch)
        self.react_word, self.react_at = ch, now
        return True

    def reacting(self, now):
        """反応中はカメラを信じない（フルカラーの絵文字を部品として拾うので）。"""
        return (self.react is not None and C.EMOJI_FULL_COLOR
                and now - self.react["t0"] < C.EMOJI_SEC)

    # --- 定着 ---------------------------------------------------------------
    def progress(self, now, has_parts):
        """光の育ち。読めていなければ育たない（光は「読めた」の合図）。"""
        p = 0.0
        if has_parts and self.read_at is not None:
            p = min(1.0, (now - self.read_at) / max(0.1, C.FIX_SECONDS))
        # 定着し終わったら光は引く。インクが出ていったので。
        if self.fixed_for == self.arr_id and self.fixed_at is not None:
            p = max(0.0, 1.0 - (now - self.fixed_at) / max(0.1, C.FIX_RELEASE_SEC))
        return p

    def fix_verdict(self, cur_c):
        """濃くなりきったときの判断。

        ""        … この配置はもう済んでいる
        "already" … 同じ配置を微調整しただけ。重ねない
        "new"     … 新しい1枚として定着させる
        """
        if self.fixed_for == self.arr_id:
            return ""
        if self.fixed_c is not None and not moved(self.fixed_c, cur_c, C.REFIX_TOL):
            return "already"
        return "new"

    def note_already(self):
        self.fixed_for = self.arr_id

    def note_fixed(self, now, cur_c):
        self.fixed_for, self.fixed_at, self.fixed_c = self.arr_id, now, cur_c

    def begin_travel(self, now, mark, label, src, dst):
        """移動を始める。FIX_TRAVEL_SEC が 0 なら瞬間移動（演出なし）。"""
        if C.FIX_TRAVEL_SEC <= 0:
            self.fixed.append((mark, label))
        else:
            self.travel = {"mark": mark, "label": label,
                           "src": src, "dst": dst, "t0": now}

    def travel_rect(self, now):
        """移動中の痕跡の、いまの位置。(痕跡, 矩形, 着いたか) か None。"""
        if self.travel is None:
            return None
        t = min(1.0, (now - self.travel["t0"]) / max(0.01, C.FIX_TRAVEL_SEC))
        e = t ** C.FIX_TRAVEL_EASE
        return (self.travel["mark"],
                lerp_rect(self.travel["src"], self.travel["dst"], e),
                t >= 1.0)

    def land_travel(self):
        """到着。ここで FIX_INK の色が乗る＝そこが「定着」。"""
        self.fixed.append((self.travel["mark"], self.travel["label"]))
        self.travel = None

    def clear_fixed(self):
        self.fixed.clear()
        self.fixed_for, self.fixed_at = -1, None
        self.travel, self.react = None, None

    def slot(self):
        """次の痕跡を置く升の番号。升を使い切ったら最後の升に重ねる。"""
        slots = max(1, C.FIX_COLS) * max(1, C.FIX_ROWS)
        return min(len(self.fixed), slots - 1)
