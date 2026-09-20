# USB Dance Mat / Microntek `USB Joystick` — Reverse Engineering Notes

このドキュメントは、USBダンスマットを **USB HID / Gamepad として扱うための実測メモ**です。  
対象デバイスは `Microntek USB Joystick`（VID `0x0079`, PID `0x0006`）。

主に以下の用途を想定しています。

- macOS / Chrome の Gamepad API から使う
- 生の HID Input Report を読む
- ESP32-S3 / M5Stack などで USB Host として読む
- 物理パネルとボタン番号の対応を確認する

---

## 1. Device identity

| Item | Value |
|---|---|
| Manufacturer | `Microntek` |
| Product | `USB Joystick` |
| Vendor ID | `0x0079` |
| Product ID | `0x0006` |
| HID Usage Page | Generic Desktop Controls (`0x01`) |
| HID Usage | Joystick (`0x04`) |

Windows の USBTree では HID game controller / Joystick として認識された。

macOS + Chrome でも Gamepad API から、

```text
USB Joystick (STANDARD GAMEPAD Vendor: 0079 Product: 0006)
```

として認識できた。

---

## 2. Physical layout

物理的なパネル配置は概ね以下。

```text
SELECT                             START

   ×               ↑               ○

   ←             CENTER             →

   △               ↓               □
```

---

## 3. macOS / Chrome Gamepad API mapping

Chrome の `navigator.getGamepads()` で実測した対応。

| Physical input | Gamepad API |
|---|---:|
| ← | `buttons[0]` |
| ↓ | `buttons[1]` |
| ↑ | `buttons[2]` |
| → | `buttons[3]` |
| □ | `buttons[4]` |
| △ | `buttons[5]` |
| × | `buttons[6]` |
| ○ | `buttons[7]` |
| Select | `buttons[8]` |
| Start | `buttons[9]` |
| Center | `axes[1] = 1.0` when pressed |

つまり、ボタン部分はかなり素直に、

```text
HID Button 1  -> buttons[0]
HID Button 2  -> buttons[1]
...
HID Button 10 -> buttons[9]
```

という 0-based index への変換になっている。

### Minimal browser test

```js
const g = navigator.getGamepads()[0];

console.log(
  g.buttons.map((b, i) => `${i}:${b.pressed ? 1 : 0}`).join(" ")
);

console.log(
  g.axes.map((a, i) => `${i}:${a.toFixed(2)}`).join(" ")
);
```

接続直後は `navigator.getGamepads()` が `null` を返すことがある。  
一度マットを踏むなどのユーザー入力後に列挙されることがあるので、認識確認時は一度入力してから見る。

---

## 4. Raw HID Input Report

Python + `hidapi` で取得した通常時のレポート。

```text
[127, 127, 0, 128, 128, 15, 0, 0]
```

実測上は **8 bytes** 取得できた。

USBTree 側では `InputReportByteLength = 9` と見えていたため、API / OS / Report ID の扱いによる見え方の差はあり得る。  
実装時は「仕様上の長さ」より、実際に使っている API が返すデータ長を確認すること。

### Zero-based byte index

```text
data[0] = 127
data[1] = 127       // CENTER
data[2] = 0
data[3] = 128
data[4] = 128
data[5] = 15        // directions
data[6] = 0         // symbols / select / start
data[7] = 0
```

---

## 5. Direction bits — `data[5]`

通常時:

```text
data[5] = 15
        = 0x0F
        = 00001111
```

上位4bitが方向入力として使われる。

| Direction | Bit | Mask | Value when pressed alone |
|---|---:|---:|---:|
| ← | bit 4 | `0x10` | `31` |
| ↓ | bit 5 | `0x20` | `47` |
| ↑ | bit 6 | `0x40` | `79` |
| → | bit 7 | `0x80` | `143` |

判定例:

```cpp
bool left  = data[5] & 0x10;
bool down  = data[5] & 0x20;
bool up    = data[5] & 0x40;
bool right = data[5] & 0x80;
```

### Simultaneous input

ビットフラグとして加算される。

実測:

```text
↑ + ↓
0x0F + 0x40 + 0x20
= 15 + 64 + 32
= 111
```

```text
← + →
0x0F + 0x10 + 0x80
= 15 + 16 + 128
= 159
```

したがって、方向入力は排他的な Hat Switch 的値ではなく、少なくともこのレポート上では複数方向を同時に保持できる。

---

## 6. Symbol / Start / Select bits — `data[6]`

通常時:

```text
data[6] = 0
```

各入力は1bitずつ。

| Physical input | Mask | Decimal |
|---|---:|---:|
| □ | `0x01` | 1 |
| △ | `0x02` | 2 |
| × | `0x04` | 4 |
| ○ | `0x08` | 8 |
| Select | `0x10` | 16 |
| Start | `0x20` | 32 |

判定例:

```cpp
bool square   = data[6] & 0x01;
bool triangle = data[6] & 0x02;
bool cross    = data[6] & 0x04;
bool circle   = data[6] & 0x08;
bool select   = data[6] & 0x10;
bool start    = data[6] & 0x20;
```

同時押しも単純な bitwise OR。

例:

```text
Select + Start
0x10 | 0x20
= 0x30
= 48
```

---

## 7. Center input — `data[1]`

中央パネルだけボタンではなく軸側に出る。

通常:

```text
data[1] = 127
        = 01111111
```

押下:

```text
data[1] = 255
        = 11111111
```

実質的には最上位bitが立つ。

```cpp
bool center = data[1] & 0x80;
```

macOS / Chrome Gamepad API ではこの入力が、

```js
gamepad.axes[1] === 1
```

として観測された。

---

## 8. Full raw-state decoder example

```cpp
bool left     = data[5] & 0x10;
bool down     = data[5] & 0x20;
bool up       = data[5] & 0x40;
bool right    = data[5] & 0x80;

bool square   = data[6] & 0x01;
bool triangle = data[6] & 0x02;
bool cross    = data[6] & 0x04;
bool circle   = data[6] & 0x08;
bool select   = data[6] & 0x10;
bool start    = data[6] & 0x20;

bool center   = data[1] & 0x80;
```

この11入力だけ使うなら、HID descriptor 全体を完全に解釈しなくても実用上は十分。

---

## 9. Browser-side mapping example

```js
const BUTTON = {
  LEFT: 0,
  DOWN: 1,
  UP: 2,
  RIGHT: 3,

  SQUARE: 4,
  TRIANGLE: 5,
  CROSS: 6,
  CIRCLE: 7,

  SELECT: 8,
  START: 9
};

function readDanceMat() {
  const g = navigator.getGamepads()[0];
  if (!g) return null;

  return {
    left:     g.buttons[BUTTON.LEFT]?.pressed ?? false,
    down:     g.buttons[BUTTON.DOWN]?.pressed ?? false,
    up:       g.buttons[BUTTON.UP]?.pressed ?? false,
    right:    g.buttons[BUTTON.RIGHT]?.pressed ?? false,

    square:   g.buttons[BUTTON.SQUARE]?.pressed ?? false,
    triangle: g.buttons[BUTTON.TRIANGLE]?.pressed ?? false,
    cross:    g.buttons[BUTTON.CROSS]?.pressed ?? false,
    circle:   g.buttons[BUTTON.CIRCLE]?.pressed ?? false,

    select:   g.buttons[BUTTON.SELECT]?.pressed ?? false,
    start:    g.buttons[BUTTON.START]?.pressed ?? false,

    center:   (g.axes[1] ?? 0) > 0.5
  };
}
```

---

## 10. USB Host / adapter notes

### Mac

Mac + Chrome では、USB-C Dock 経由でも Gamepad API まで入力が通ることを確認済み。

つまり少なくとも今回使った Dock では、

```text
Dance Mat
  -> Dock
  -> Mac
  -> Chrome Gamepad API
```

は成立する。

### ESP32-S3 / CoreS3 Lite

一方、CoreS3 Lite を USB Host として使った際は Dock 経由では待機状態のままだった。

単純な USB-A <-> USB-C 変換アダプタに変更すると認識した。

したがって、

- Dock が壊れているわけではない
- PC/Mac の USB Host では問題なく使える
- ESP32-S3 の USB Host / OTG と Dock の間には相性・role negotiation・VBUS 周りの問題があり得る

と考えるのが妥当。

組み込み用途では、まず **単純なOTG変換アダプタで直結**して切り分けるのが安全。

---

## 11. Was Windows necessary?

### 目的が「Mac / Webアプリから使う」だけなら

ほぼ不要だった。

macOS + Chrome だけで、

- Joystickとして認識されているか
- Button index
- Axis
- 同時押し
- 実際のアプリ入力

まで確認できる。

### ただし Windows / USBTree が役に立った部分

低レベルの reverse engineering では有用だった。

USBTree から、

- VID / PID
- Generic Desktop / Joystick
- HID descriptor
- Input / Output report length
- Button usage
- Axis / Hat Switch の存在

などを確認できたため、デバイスの構造を理解する助けにはなった。

要するに、

```text
Web / application layerだけを見る
-> Macだけで十分

HID descriptor / raw reportまで調べる
-> USBTreeやhidapiなど低レベルの道具が有用
```

という整理。

---

## 12. Practical conclusion

このマットは、かなり扱いやすい USB HID Joystick。

アプリ側から見る場合は、

```text
buttons[0..9] + axes[1]
```

だけで11入力を取得できる。

生HID側では、

```text
data[5] -> directions
data[6] -> symbols / Select / Start
data[1] -> Center
```

を見るだけでよい。

入力はビットフラグなので同時押しもそのまま扱える。

---

## 13. Known-good identifiers

```text
VID: 0x0079
PID: 0x0006
Manufacturer: Microntek
Product: USB Joystick
```

Browser example:

```js
const pads = navigator.getGamepads();

const danceMat = [...pads].find(g =>
  g &&
  (
    g.id.toLowerCase().includes("usb joystick") ||
    g.id.toLowerCase().includes("vendor: 0079") ||
    g.id.toLowerCase().includes("product: 0006")
  )
);
```

---

_Last updated from actual device tests on macOS, Chrome, Windows HID inspection, and ESP32-S3 USB Host tests._
