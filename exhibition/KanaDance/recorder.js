// ============================================================
//  recorder.js — シャッターで字を写し、下の帯に並べる
//
//  写すのは画面の canvas ではなく、同じ線を別の canvas に描き直したもの。
//  画面の canvas には関節の点も乗っていて、ポーズの濃さ（CSS の opacity）も掛かっているので、
//  そのまま写すと点が混ざり、薄い字になる。描き直せば線だけが元の濃さで取れる。
//
//  札の下には、シャッターを切った瞬間の映像を写真として敷く。字と同じ縮尺・同じ位置で切り抜くので、
//  線は写真の身体の上にそのまま乗る。写真の濃さは CSS 変数（--record-photo-opacity）で、あとから変えられる。
//
//  帯は左から右へ並び、満杯（RECORDS.max 枚）になると左端の古いものから消えて、残りが左へ流れる。
// ============================================================

import { RECORDS } from './config.js';
import { Renderer } from './renderer.js';

export class Recorder {
  #list;
  #work = document.createElement('canvas');
  #renderer = new Renderer(this.#work);

  /** @param {HTMLOListElement} list 帯（ol） */
  constructor(list) {
    this.#list = list;
  }

  /**
   * いまの字を写して帯の右端に足す。
   * @param {{letter:string, lines?:string[], frames:Array<Object>, blend:Object,
   *          video?:HTMLVideoElement, width:number, height:number}} shot
   *   lines が無い字（線データの無い字）は、画面と同じく大きな文字で写す。
   *   video が無い・まだ映っていないときは写真なしで字だけ写す
   * @returns {boolean} 写せたか（線が画面の外で何も描けなかったときは false）
   */
  add({ letter, lines, frames, blend, video, width, height }) {
    const work = this.#work;
    if (work.width !== width || work.height !== height) { work.width = width; work.height = height; }
    this.#renderer.clear();
    if (lines?.length) this.#renderer.drawKanaBlend(lines, frames, blend);
    else this.#renderer.drawBigChar(letter);

    const box = inkBounds(work);
    if (!box) return false;

    const item = document.createElement('li');
    item.className = 'record is-in';
    item.title = letter;
    const place = placement(box);
    if (video?.videoWidth) item.appendChild(cardLayer('record-photo', video, place));
    item.appendChild(cardLayer('record-ink', work, place));
    item.addEventListener('animationend', () => item.classList.remove('is-in'), { once: true });
    this.#list.appendChild(item);
    this.#trim();
    return true;
  }

  clear() {
    this.#list.replaceChildren();
  }

  /** 満杯を超えた分を左端から消す。消える札は幅を畳むので、残りが左へ流れて見える */
  #trim() {
    const live = [...this.#list.children].filter((li) => !li.classList.contains('is-out'));
    for (const li of live.slice(0, Math.max(0, live.length - RECORDS.max))) {
      li.classList.add('is-out');
      li.addEventListener('animationend', () => li.remove(), { once: true });
      setTimeout(() => li.remove(), 1000); // アニメーションが走らない環境（タブが裏）でも溜めない
    }
  }
}

/** 墨が乗っている範囲（不透明な画素の外接矩形）。何も無ければ null */
function inkBounds(canvas) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 字の外接矩形を、札の内側（RECORDS.inset の余白を除いた枠）に縦横比を保って収める置き方。
 * 札全体に写る元画像の範囲（src）も返す。写真はこの範囲を切り抜くので、字とぴったり重なる。
 */
function placement(box) {
  const { cardW, cardH, inset, pixelRatio } = RECORDS;
  const outW = cardW * pixelRatio;
  const outH = cardH * pixelRatio;
  const s = Math.min((cardW - inset.x * 2) * pixelRatio / box.w, (cardH - inset.y * 2) * pixelRatio / box.h);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return { outW, outH, src: { x: cx - outW / s / 2, y: cy - outH / s / 2, w: outW / s, h: outH / s } };
}

/**
 * 札の1層（写真か字）。元画像の src 範囲を札いっぱいに描く。
 * 画面の映像は左右反転して見せているので、写したものも反転して見たままの向きにする。
 * 範囲が映像の外にはみ出した分は描かれず、札の白地のまま残る。
 */
function cardLayer(className, source, { outW, outH, src }) {
  const out = document.createElement('canvas');
  out.className = className;
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  ctx.translate(outW, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, src.x, src.y, src.w, src.h, 0, 0, outW, outH);
  return out;
}
