import { CONFIG } from './config.js';

// 背景の描き分け。モード: 'minimal' | 'bokeh' | 'image'
export const BG_MODES = [
  { value: 'minimal', label: 'ミニマル' },
  { value: 'bokeh',   label: '夜のボケ' },
  { value: 'image',   label: '画像' },
];

let img = null;
let imgState = 'none'; // none | loading | ok | fail

export function loadBackgroundImage(onDone) {
  if (imgState === 'ok' || imgState === 'loading') { onDone?.(); return; }
  imgState = 'loading';
  img = new Image();
  img.onload = () => { imgState = 'ok'; onDone?.(); };
  img.onerror = () => {
    imgState = 'fail';
    console.warn(`背景画像が読めない: ${CONFIG.backgroundImage} → 夜のボケに退避`);
    onDone?.();
  };
  img.src = CONFIG.backgroundImage;
}

export function drawBackground(canvas, mode) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(innerWidth * dpr));
  canvas.height = Math.max(1, Math.round(innerHeight * dpr));
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  const c = canvas.getContext('2d');

  if (mode === 'image') {
    if (imgState === 'ok') { drawImageCover(c, canvas); return; }
    if (imgState === 'none' || imgState === 'loading') {
      loadBackgroundImage(() => drawBackground(canvas, mode));
      drawMinimal(c, canvas); // 読み込み中のつなぎ
      return;
    }
    mode = 'bokeh'; // 読込失敗 → 退避
  }
  if (mode === 'minimal') drawMinimal(c, canvas);
  else drawBokeh(c, canvas);
}

// --- ミニマル: 黒鉛のグラデ＋わずかなビネット ---
function drawMinimal(c, canvas) {
  const g = c.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#14171c');
  g.addColorStop(1, '#20242c');
  c.fillStyle = g;
  c.fillRect(0, 0, canvas.width, canvas.height);
  const v = c.createRadialGradient(
    canvas.width / 2, canvas.height / 2, canvas.height * 0.3,
    canvas.width / 2, canvas.height / 2, canvas.height * 0.95
  );
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.4)');
  c.fillStyle = v;
  c.fillRect(0, 0, canvas.width, canvas.height);
}

// --- 夜のボケ: グラデ＋ぼけた光 ---
function drawBokeh(c, canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const grad = c.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#0b1026');
  grad.addColorStop(0.6, '#16224a');
  grad.addColorStop(1, '#2a1a3a');
  c.fillStyle = grad;
  c.fillRect(0, 0, canvas.width, canvas.height);

  const colors = ['#ffd27a', '#ffa94d', '#7ad7ff', '#ff7ab5', '#b18cff', '#fff3c4'];
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * canvas.width;
    const y = canvas.height * (0.25 + Math.random() * 0.7);
    const r = (4 + Math.random() * 22) * dpr;
    c.save();
    c.filter = `blur(${(r / 3).toFixed(1)}px)`;
    c.globalAlpha = 0.25 + Math.random() * 0.5;
    c.fillStyle = colors[(Math.random() * colors.length) | 0];
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
}

// --- 画像: cover相当で敷く ---
function drawImageCover(c, canvas) {
  const s = Math.max(canvas.width / img.width, canvas.height / img.height);
  const w = img.width * s, h = img.height * s;
  c.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}
