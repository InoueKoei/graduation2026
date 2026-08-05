import { CONFIG } from './config.js';

const lerp = (a, b, t) => a + (b - a) * t;
const norm = (v, [lo, hi]) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

// 温湿度(実測)を活字のパラメータに翻訳して、CSS変数へ流し込む係。
// 値は毎フレームなめらかに追従させる。
export class TypeStyler {
  constructor() {
    this.t = 0.5; // 正規化温度 0..1
    this.h = 0.3; // 正規化湿度 0..1
    this.out = {}; // 直近の出力(HUD表示用)
  }

  update(dt, temp, humidity) {
    if (temp == null || humidity == null) return;
    const tt = norm(temp, CONFIG.tempRange);
    const th = norm(humidity, CONFIG.humRange);
    const k = Math.min(1, CONFIG.easeSpeed * dt);
    this.t += (tt - this.t) * k;
    this.h += (th - this.h) * k;

    const { t, h } = this;
    const wght = Math.round(lerp(CONFIG.weightRange[0], CONFIG.weightRange[1], t));
    const hue = lerp(CONFIG.hueRange[0], CONFIG.hueRange[1], t) % 360;
    const sat = lerp(CONFIG.satRange[0], CONFIG.satRange[1], t);
    const light = lerp(CONFIG.lightRange[0], CONFIG.lightRange[1], t);

    const hh = Math.pow(h, CONFIG.bleedGamma);
    const bleed = CONFIG.bleedMax * hh;
    const ct = 1 + (CONFIG.contrastMax - 1) * hh;
    const ls = lerp(CONFIG.lsRange[0], CONFIG.lsRange[1], h);

    const s = document.documentElement.style;
    s.setProperty('--wght', wght);
    s.setProperty('--ink', `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`);
    s.setProperty('--bleed', bleed.toFixed(2) + 'px');
    s.setProperty('--ct', ct.toFixed(2));
    s.setProperty('--ls', ls.toFixed(4) + 'em');

    this.out = { wght, bleed };
  }
}
