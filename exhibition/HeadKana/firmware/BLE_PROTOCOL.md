# HeadKana v2.0: sensor-only BLE

Current DJ role (CoreS3 v2.2): the protocol-2 binary layout is unchanged. BLE and USB sensor JSON both run at approximately 50Hz, while the BLE read snapshot updates at 10Hz. The browser owns a separate CoreS3 link, independent from the dial's BLE or USB session. Each completed CoreS3 pitch excursion immediately edits the trailing text run captured when that nod began. The cycle is dakuten → handakuten → small kana → dakuten, with no waiting window. Pauses preserve the cycle on the same text run; a different run starts at dakuten. Yaw, red/blue buttons, and strong nod size are not text-editing commands on this modifier link.

Device name and UUIDs remain unchanged from v1.3:

- Name: `M5-Kana`
- Service: `9f6c0001-4b68-4b3a-9c87-df6f1da60001`
- Notify: `9f6c0002-4b68-4b3a-9c87-df6f1da60001`
- Read snapshot: `9f6c0003-4b68-4b3a-9c87-df6f1da60001`
- Read/write selection: `9f6c0004-4b68-4b3a-9c87-df6f1da60001`

The browser writes one byte (`0`–`45`) to the selection characteristic when the selected kana changes. ESP receives no composition text, candidates, or font sizes. Double-tapping the M5Stack touch screen switches between sensor/button diagnostics and a large display of that selected kana.
ESP samples its IMU, calibrates gyro bias while stationary, and debounces GPIO2 red / GPIO1 blue. Text editing, gestures and speech run in the browser.

## Notifications

Target interval: 20 ms. Screen refresh can add scheduling jitter. Each sample is one complete 20-byte notification (minimum ATT MTU=23 supported). Multi-byte fields are little endian.

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | uint8 | `0xA5` |
| 1 | uint8 | Flags: bit0 ready, bit1 IMU present, bit2 red pressed, bit3 blue pressed. Upper bits zero. |
| 2 | uint16 | Sequence, wraps at 65536 |
| 4 | uint32 | IMU sample time in milliseconds, wraps at 2^32 |
| 8,10,12 | int16 | Acceleration x/y/z in 0.001 g |
| 14,16,18 | int16 | Bias-corrected angular velocity x/y/z in 0.01 degrees/second |

No Japanese strings or text events in v2 notifications. Do not pass these packets through the v1 fragmented JSON decoder.

## Read snapshot / serial

```json
{"type":"sensor","protocol":2,"seq":20,"t":2000,"ready":true,"imu":true,"red":false,"blue":false,"accel":[0,1,0],"gyro":[0,0,0]}
```

The snapshot is a complete JSON string without a notification header. The browser reads `protocol` before subscribing to select the correct decoder. The updated site still understands legacy v1.3 JSON notifications, but gestures require v2.0 firmware.

Serial: 115200 baud; `s` prints current sensor JSON; `c` restarts stationary gyro bias calibration. Serial JSON and the read snapshot update approximately every 100 ms.

## RP2040-Zero single dial + GC9A01 (v1.7, protocol 4)

Build with `HEADKANA_SINGLE_LCD`. One encoder uses S1/S2/KEY=GP6/7/8. LCD SPI uses MOSI=GP3, SCK=GP2, DC=GP4, CS=GP5, RST=GP1. Local selection spans all 46 kana and works without USB. LCD and transmitted selection share the same index.

USB lines: `@S,flags,selected,seq\n`. Flags: bit0 ready, bit1 confirm, bit2 erase, bit3 KEY pressed. Selected=0..45; sequence=uint16 with wraparound. State coalesces at 25ms, heartbeat=250ms, button-event FIFO=32. Short release confirms; 800ms hold erases once. Host writes are not required. The browser recognizes this marker as single-LCD hardware; `@D` remains the dual-dial protocol. Partial serial lines and invalid bounds are handled by `DialSerialDecoder`.

## RP2040-Zero USB dial (v1.6)

The same sketch selects a USB-only implementation under ARDUINO_ARCH_RP2040. S1/S2/KEY GPIOs are 6/7/8 on the left and 26/15/14 on the right. GPIO interrupts accumulate encoder turns independently of USB writes. The main loop samples both buttons before queueing events, left first. Output retains the existing `@D,flags,eventCharacter,sequence,left,right,pressedMask` format. State updates are coalesced at 25ms and heartbeats at 250ms. Button events retain their position snapshots in a 32-frame FIFO. No BLE radio is provided by RP2040-Zero. USB descriptor: VID 0x2e8a / PID 0x0003, product RP2040 Zero.

## StampS3 + EC11 dial (protocol 3)

The dial firmware advertises as `M5-Kana-Dial` with the same service, notify and snapshot UUIDs. v1.5 snapshot: `{"type":"dial","protocol":3,"ready":true,"selected":0,"positions":[0,25],"pressedMask":0}`. Notifications are 8 bytes: `0xD3`, flags, event character index (0–45), little-endian uint16 sequence, left position (0–24), right position (25–45), and pressed-key mask (bit0 left / bit1 right). Flag bit0 is ready, bit1 confirm, bit2 erase and bit3 any button held; upper bits are zero. Both positions are sent together. Each key confirms its own dial's character; same-cycle confirmations are separate packets in left-then-right order. State packets have no confirm/erase flag and use left position as the compatibility character field. USB lines are `@D,flags,eventCharacter,sequence,left,right,pressedMask`. The browser also accepts older 5-byte notifications and three-field USB lines. A heartbeat is sent every 250 ms.

EC11 rotation changes the selected kana with wraparound. A short press confirms the selected kana; holding the switch for 800 ms erases one character. ESP does not receive or store the composition text.

## Browser gestures (historical initial thresholds)

Current update (2026-10-15): conversion disabled, selection restricted to 46 kana. Static pitch/roll does not gate yaw selection; only pitch motion above 30 degrees/second can start a nod. All yaw selection is applied immediately, independently of nod/shake classification and gesture cooldowns. Nod completion carries an absolute selectionIndex identifying the character selected when nodding began. The selection index now maps -60 to +60 degrees across all 46 kana (120/45 degrees between centers), with 0.35-degree boundary hysteresis and endpoint clamping; neutral selects index 23 (ね). A qualified shake erases once after 160 ms of quiet and rolls back only its own selection movement. A one-way turn is never held for classification. Firmware and BLE format are unchanged. The initial conversion behavior below is retained as history only.

- Neutral: collect 25 stationary notification samples after ready. Use "正面を合わせる" after mounting.
- Selection: yaw projected on gravity, 8 degrees per kana, ignores rates below 2.5 degrees/s. Reverse option is available.
- Nod: pitch excursion at least 10 degrees, peak speed at least 30 degrees/s, return within 4.5 degrees in 100–1200 ms. Appends selected kana; confirms active conversion candidate instead when present.
- Strong nod: peak speed at least 150 degrees/s (adjustable), or excursion at least 28 degrees. That input is displayed at 2× font size. Converted words inherit maximum size of their source kana; a strong confirmation makes the converted word large.
- Tilt: roll at least 18 degrees (adjustable), held 300 ms. Starts conversion or advances candidate. Return below 45% of the threshold to rearm. Pitch/yaw movement suppresses tilt recognition.
- Shake: three alternating rapid yaw lobes with at least 8 degrees per lobe, within 1100 ms; threshold 90 degrees/s (adjustable). Deletes one character, or cancels a conversion preview. Rapid lobes suppress kana selection. Cooldowns prevent repeated edits.
- Buttons: red release confirms; blue release erases; blue held 1500 ms clears; red+blue reads current browser text once and suppresses individual actions until both release.
- A sample gap greater than 120 ms resets motion/button state; no integrating across missing data. An 800 ms receive timeout disables input and requires a new neutral calibration on resumed data. Disconnect/reconnect resets sensor state, preserving the browser text.

Dictionary conversion is a local prototype based on SKK-JISYO.L. It offers exact reading candidates and a simple phrase split fallback, katakana, and hiragana; its candidate ordering is not a full Japanese IME. See the dictionary notice/license bundled with the site.


## RP2040-Zero type LCD (v1.8, protocol 5)

USB: `@T,flags,selected,seq,fontCounter,sizeRaw,weightRaw,fontPressed\n`. Flags bits0..3 match protocol4; bit4=font KEY short release/reapply. Bounds: flags0..31, selected0..45, seq/fontCounter0..65535, sizeRaw/weightRaw0..4095, fontPressed0..1. Font counter wraps at16bits; browser computes signed deltas, rebasing first sample on connection. Event FIFO stores the complete parameter snapshot. No font-file or text transfer to the MCU. LCD remains fixed-font kana.

Character encoder6/7/8; font encoder26/15/14; sizeADC29; weightADC28. Size maps12..128px; weight selects nearest actual weight supported by chosen browser font. Main KEY confirms/erases; font KEY reapplies only. All controls sampled independently, no active/inactive side.


## 2026-11-02 LCD v1.9 wiring update

Type-LCD protocol5 unchanged. LCD RST/CS/DC/MOSI/SCK=GP1/2/3/4/5. Main CLK/DT/SW=GP6/7/8 (equivalent to A/B/KEY). Software SPI and row-run painting avoid installed Adafruit RP2040 bulk-transfer hardware-SPI assumption. Font encoder26/15/14 and ADC29/28 unchanged.
