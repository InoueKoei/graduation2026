# 母音子音 MVP ── 母音側マクロパッド
#
# ボード : Waveshare RP2040-Zero (CircuitPython 10.x + KMK)
# 配線   : 4x4 マトリクス  col = GP0-GP3 / row = GP4-GP7 / COL2ROW
#
# 5キーに あいうえお を割り当て、残り11キーは無効（KC.NO）にしてある。
# 母音側の体験者は「あいうえお しか打てない」状態になる。
#
# 送るのは F13-F17。PCキーボード側（子音担当）が絶対に出せないキーなので、
# 表示アプリは「この入力は必ずマクロパッドから来た」と判断できる。
# 変更するときは index.html の VOWEL_KEYS も対で直すこと。

import board
from kmk.kmk_keyboard import KMKKeyboard
from kmk.keys import KC
from kmk.scanners import DiodeOrientation

keyboard = KMKKeyboard()

keyboard.col_pins = (board.GP0, board.GP1, board.GP2, board.GP3)
keyboard.row_pins = (board.GP4, board.GP5, board.GP6, board.GP7)
keyboard.diode_orientation = DiodeOrientation.COL2ROW

# --- 母音キー ---------------------------------------------------------
# macOS が F13-F17 を横取りする場合は F18-F22 などに逃がす
# （index.html の VOWEL_KEYS も同じキー名に直す）

A = KC.F13   # あ
I = KC.F14   # い
U = KC.F15   # う
E = KC.F16   # え
O = KC.F17   # お

__ = KC.NO   # 無効キー

# --- 配列 -------------------------------------------------------------
# 物理4x4の左上から読み順。並べ替えたいときはこの表だけ入れ替える。
#
#   [あ][い][う][え]
#   [お][  ][  ][  ]
#   [  ][  ][  ][  ]
#   [  ][  ][  ][  ]

keyboard.keymap = [
    [
        A,  I,  U,  E,    # 行1
        O,  __, __, __,   # 行2
        __, __, __, __,   # 行3
        __, __, __, __,   # 行4
    ]
]

if __name__ == '__main__':
    keyboard.go()
