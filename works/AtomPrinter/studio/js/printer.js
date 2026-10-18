// ATOM Printer に 1bit 画像を送る。
// ファーム（../PRINTER_FW）の /bmp_size → /bmp を順に叩くだけで、変換はすべてこちら側でやる。
// 他の作品からも使えるように、ここには UI のことを書かない。

const AtomPrinter = (() => {
  const WIDTH = 384;               // 印字幅（ドット）。58mm 紙で 8 ドット/mm
  const BUFFER_LIMIT = 50 * 1024;  // ファームの BMP_BUFFER_LIMIT。これを超える画像は分割して送る
  const BYTES_PER_SEC = 960;       // ATOM → プリンタは 9600bps 8N1

  // 白黒にした canvas を 1bit に詰める（黒 = 1、左のドットが上位ビット）
  function packCanvas(canvas) {
    const { width, height } = canvas;
    const px = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const rowBytes = width / 8;
    const bits = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (px[i + 3] >= 128 && px[i] < 128) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return bits;
  }

  async function sendChunk(host, bits, width, height, feed) {
    const base = `http://${host}`;
    // text/plain で送るのは、JSON だとプリフライト（OPTIONS）が飛び、ファームが答えられないため
    let res = await fetch(`${base}/bmp_size`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ bmp_width: width, bmp_height: height, feed }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(await res.text());

    const form = new FormData();
    form.append('file', new Blob([bits]), 'image.bin');
    // ファームは刷り終わってから返事をするので、送信時間ぶん待つ
    const waitMs = (estimateSeconds(width, height) + 15) * 1000;
    res = await fetch(`${base}/bmp`, { method: 'POST', body: form, signal: AbortSignal.timeout(waitMs) });
    const msg = await res.text();
    if (!res.ok) throw new Error(msg);
  }

  async function printBits(host, bits, width, height, { feed = 3, onProgress } = {}) {
    if (width % 8 !== 0 || width > WIDTH) throw new Error(`幅は 8 の倍数かつ ${WIDTH} 以下: ${width}`);
    const rowBytes = width / 8;
    const rowsPerChunk = Math.floor(BUFFER_LIMIT / rowBytes);
    for (let y = 0; y < height; y += rowsPerChunk) {
      const h = Math.min(rowsPerChunk, height - y);
      const last = y + h >= height;
      // 途中のかたまりは改行を入れない＝紙の上では1枚の画像としてつながる
      await sendChunk(host, bits.subarray(y * rowBytes, (y + h) * rowBytes), width, h, last ? feed : 0);
      if (onProgress) onProgress((y + h) / height);
    }
  }

  function printCanvas(host, canvas, opts) {
    return printBits(host, packCanvas(canvas), canvas.width, canvas.height, opts);
  }

  // 公式ページと同じ /print を使って空行を送る
  async function feed(host, lines = 3) {
    const q = new URLSearchParams({ printType: 'ASCII', Pdata: '\n'.repeat(lines), newLine: 'off' });
    const res = await fetch(`http://${host}/print?${q}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(await res.text());
  }

  function estimateSeconds(width, height) {
    return (width / 8) * height / BYTES_PER_SEC;
  }

  return { WIDTH, packCanvas, printBits, printCanvas, feed, estimateSeconds };
})();
