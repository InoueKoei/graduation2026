// 文字と画像を、幅 384 ドットの白黒 canvas にする。
// ここで作った canvas をそのまま AtomPrinter.printCanvas に渡せば刷れる。

const Render = (() => {
  const W = AtomPrinter.WIDTH;

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // ---------- 文字 ----------

  // 日本語は空白で切れないので、1文字ずつ測って幅を超えたら折り返す
  function layoutLines(ctx, text, maxWidth, spacing) {
    const lines = [];
    for (const para of text.split('\n')) {
      let line = [];
      let width = 0;
      for (const ch of Array.from(para)) {
        const w = ctx.measureText(ch).width + spacing;
        if (line.length && width + w - spacing > maxWidth) {
          lines.push({ chars: line, width: width - spacing });
          line = [];
          width = 0;
        }
        line.push({ ch, w });
        width += w;
      }
      lines.push({ chars: line, width: Math.max(0, width - spacing) });
    }
    return lines;
  }

  async function text(o) {
    const font = `${o.weight} ${o.size}px "${o.font}", sans-serif`;
    try { await document.fonts.load(font, o.text || 'あ'); } catch (_) {}

    const measure = makeCanvas(1, 1).getContext('2d');
    measure.font = font;
    const maxWidth = W - o.margin * 2;
    const lines = layoutLines(measure, o.text, maxWidth, o.spacing);
    const lineH = o.size * o.lineHeight;

    const c = makeCanvas(W, o.padding * 2 + lines.length * lineH);
    const ctx = c.getContext('2d');
    const fg = o.invert ? '#fff' : '#000';
    ctx.fillStyle = o.invert ? '#000' : '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = fg;
    ctx.font = font;
    ctx.textBaseline = 'middle';

    lines.forEach((line, i) => {
      let x = o.margin;
      if (o.align === 'center') x = (W - line.width) / 2;
      if (o.align === 'right') x = W - o.margin - line.width;
      const y = o.padding + i * lineH + lineH / 2;
      for (const { ch, w } of line.chars) {
        ctx.fillText(ch, x, y);
        x += w;
      }
    });

    // 文字はディザをかけずに切る。かけると輪郭がざらつく
    binarize(c, grayOf(c), 'threshold', o.threshold);
    return c;
  }

  // ---------- 画像 ----------

  function image(img, o) {
    const rotated = o.rotate % 180 !== 0;
    const srcW = rotated ? img.naturalHeight : img.naturalWidth;
    const srcH = rotated ? img.naturalWidth : img.naturalHeight;
    const drawW = Math.round(W * o.scale / 100);
    const drawH = Math.round(srcH * drawW / srcW);

    const c = makeCanvas(W, drawH + o.padding * 2);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(W / 2, o.padding + drawH / 2);
    ctx.rotate(o.rotate * Math.PI / 180);
    const w = rotated ? drawH : drawW;
    const h = rotated ? drawW : drawH;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();

    const gray = grayOf(c);
    adjust(gray, o.brightness, o.contrast);
    if (o.invert) for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
    binarize(c, gray, o.dither, o.threshold);
    return c;
  }

  // ---------- 共通 ----------

  function grayOf(c) {
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const g = new Float32Array(c.width * c.height);
    for (let i = 0; i < g.length; i++) {
      g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    }
    return g;
  }

  // brightness / contrast はどちらも -100〜100
  function adjust(g, brightness, contrast) {
    const b = brightness * 2.55;
    const k = (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (let i = 0; i < g.length; i++) g[i] = k * (g[i] - 128) + 128 + b;
  }

  // 誤差拡散のカーネル。[dx, dy, 重み]
  const KERNELS = {
    floyd: { div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
    atkinson: { div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  };

  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  function binarize(c, g, method, threshold = 128) {
    const { width: w, height: h } = c;
    const out = new Uint8Array(w * h);  // 1 = 黒
    if (KERNELS[method]) {
      const { div, taps } = KERNELS[method];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const black = g[i] < threshold;
          out[i] = black ? 1 : 0;
          const err = g[i] - (black ? 0 : 255);
          for (const [dx, dy, wt] of taps) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny < h) g[ny * w + nx] += err * wt / div;
          }
        }
      }
    } else if (method === 'bayer') {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) * 16;
          out[y * w + x] = g[y * w + x] < t ? 1 : 0;
        }
      }
    } else {
      for (let i = 0; i < out.length; i++) out[i] = g[i] < threshold ? 1 : 0;
    }

    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < out.length; i++) {
      const v = out[i] ? 0 : 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  return { text, image };
})();
