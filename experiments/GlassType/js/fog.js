import { CONFIG } from './config.js';

// 曇りガラスの層。
// buffer(オフスクリーン)に「結露の膜」を持ち、ドラッグで destination-out で拭き取る。
// 曇っている間は毎フレーム薄く塗り足すので、拭いた跡はじわじわ再結露して消える。
export class FogLayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.level = 0; // 表示上の曇り量 0..1
    this.buffer = document.createElement('canvas');
    this.bctx = this.buffer.getContext('2d');
    this.grain = this._makeGrain();
    this._refillAcc = 0; // 再結露の蓄積(8bit丸め対策: まとめて塗る)
    this.resize();
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const w = Math.max(1, Math.round(innerWidth * dpr));
    const h = Math.max(1, Math.round(innerHeight * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = innerWidth + 'px';
    this.canvas.style.height = innerHeight + 'px';
    this.buffer.width = w;
    this.buffer.height = h;
    this._fillFog(1); // リサイズ時は全面結露からやり直し
  }

  // 結露のザラつきテクスチャ(タイル)
  _makeGrain() {
    const t = document.createElement('canvas');
    t.width = t.height = 256;
    const c = t.getContext('2d');
    const img = c.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 225 + Math.random() * 30;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 14 + Math.random() * 26;
    }
    c.putImageData(img, 0, 0);
    return t;
  }

  _fillFog(alpha) {
    const c = this.bctx;
    c.save();
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = alpha;
    c.fillStyle = '#e8edf0';
    c.fillRect(0, 0, this.buffer.width, this.buffer.height);
    c.globalAlpha = alpha * 0.6;
    c.fillStyle = c.createPattern(this.grain, 'repeat');
    c.fillRect(0, 0, this.buffer.width, this.buffer.height);
    c.restore();
  }

  // 指で拭く。座標は buffer ピクセル系
  wipe(x0, y0, x1, y1) {
    const c = this.bctx;
    const r = CONFIG.brushRadius * this.dpr;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.35)));
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      const g = c.createRadialGradient(x, y, r * 0.25, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  // dt=秒, target=センサー由来の曇り目標 0..1
  update(dt, target) {
    // 曇るのは速く、晴れるのは遅く（非対称）
    const k = target > this.level ? CONFIG.condenseSpeed : CONFIG.evaporateSpeed;
    this.level += (target - this.level) * Math.min(1, k * dt);
    // 拭いた跡は「新しい息(target)」に比例して埋め戻る。
    // 息が来てない間もごく僅かに埋まる（level比例の弱い項）。
    // 毎フレームの極小塗りは8bit丸めで飽和して跡が残るため、溜めてまとめて塗る
    this._refillAcc += CONFIG.refogRate * dt * Math.max(target, this.level * 0.3);
    if (this._refillAcc >= 0.05) {
      this._fillFog(Math.min(1, this._refillAcc));
      this._refillAcc = 0;
    }
  }

  render() {
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.globalAlpha = Math.min(1, this.level) * CONFIG.fogMaxAlpha;
    c.drawImage(this.buffer, 0, 0);
    c.globalAlpha = 1;
  }
}
