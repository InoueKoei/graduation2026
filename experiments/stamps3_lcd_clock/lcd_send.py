#!/usr/bin/env python3
"""液晶に 1 行送る。デーモンが起動していなければ黙って捨てる。

    python3 lcd_send.py "Mｵﾜｯﾀ"
    python3 lcd_send.py "A2"
    python3 lcd_send.py C

UDP なので受け手がいなくてもブロックせず、失敗もしない。
Claude Code のフックから呼んでも絶対に固まらない、というのがこれの存在理由。
"""

import socket
import sys

if len(sys.argv) < 2:
    sys.exit(__doc__)

msg = " ".join(sys.argv[1:]).encode("utf-8")
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.sendto(msg, ("127.0.0.1", 9123))
except OSError:
    pass   # 送れなくても呼び出し元を止めない
