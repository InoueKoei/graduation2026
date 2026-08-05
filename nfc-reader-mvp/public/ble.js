// ============================================================
// 展示用：ESP32(RC522) と BLE で直結する（Web Bluetooth）
// ------------------------------------------------------------
// ・ESP32 から「札番号」を notify で受け取る
// ・受け取ったら /scan?card=NN&format=haptic を叩く（サーバーは localhost のまま）
// ・返った "vibrate"/"none" を ESP32 へ write して手元を振動させる
//
// 注意：Web Bluetooth は Chrome/Edge のみ、かつ「安全なコンテキスト」が必要。
//       表示は http://localhost:3000/ で開くこと（localhost は許可される）。
//       ※ http://192.168… では動きません。展示PC本体で localhost 表示に。
// ============================================================
(function () {
  const SERVICE_UUID = "7a0b9d00-4e2a-4b7c-9c1a-0f1e2d3c4b5a";
  const CHAR_SCAN = "7a0b9d01-4e2a-4b7c-9c1a-0f1e2d3c4b5a";
  const CHAR_FEEDBACK = "7a0b9d02-4e2a-4b7c-9c1a-0f1e2d3c4b5a";

  let device = null;
  let feedbackChar = null;

  const btn = document.getElementById("bleBtn");
  const stat = document.getElementById("bleStat");
  if (!btn) return; // ボタンが無いページでは何もしない

  function setStatus(text, on) {
    if (stat) {
      stat.textContent = text;
      stat.classList.toggle("on", !!on);
    }
  }

  // 対応ブラウザ判定
  if (!navigator.bluetooth) {
    btn.disabled = true;
    setStatus("この端末は Web Bluetooth 非対応（Chrome で開いてください）", false);
    return;
  }

  // スキャン通知を受けたとき
  async function onScan(e) {
    const card = new TextDecoder().decode(e.target.value).trim();
    if (!card) return;
    try {
      const r = await fetch(`/scan?card=${encodeURIComponent(card)}&format=haptic`);
      const haptic = (await r.text()).trim(); // "vibrate" or "none"
      // ESP32 へ結果を書き戻して手元を振動させる
      if (feedbackChar) {
        await feedbackChar.writeValue(new TextEncoder().encode(haptic));
      }
    } catch (err) {
      console.warn("scan 処理でエラー:", err);
    }
  }

  async function connect() {
    try {
      setStatus("接続中…", false);
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
      });
      device.addEventListener("gattserverdisconnected", onDisconnected);
      await openGatt();
    } catch (err) {
      console.warn("接続キャンセル/失敗:", err);
      setStatus("未接続", false);
    }
  }

  async function openGatt() {
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(SERVICE_UUID);
    const scanC = await svc.getCharacteristic(CHAR_SCAN);
    feedbackChar = await svc.getCharacteristic(CHAR_FEEDBACK);
    await scanC.startNotifications();
    scanC.addEventListener("characteristicvaluechanged", onScan);
    setStatus(`接続中：${device.name || "ESP32"}`, true);
    btn.textContent = "🔵 切断";
  }

  // 切断時：展示中に切れても自動で再接続を試みる
  async function onDisconnected() {
    feedbackChar = null;
    setStatus("再接続中…", false);
    for (let i = 0; i < 5; i++) {
      try {
        await openGatt();
        return;
      } catch (e) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    setStatus("未接続（ボタンで再接続）", false);
    btn.textContent = "🔵 Bluetooth接続";
  }

  btn.onclick = () => {
    if (device && device.gatt && device.gatt.connected) {
      device.gatt.disconnect();
      setStatus("未接続", false);
      btn.textContent = "🔵 Bluetooth接続";
    } else if (device) {
      openGatt().catch(() => connect());
    } else {
      connect();
    }
  };

  setStatus("未接続", false);
})();
