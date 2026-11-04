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
//
//  調整の「記録の書き出し」を入れると、同じ範囲を PNG でもダウンロードする（バナーなどの素材用）。
//  札は 512×384 に縮めてあるので、書き出しは映像の実寸の解像度で描き直す。
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
   *          video?:HTMLVideoElement, width:number, height:number,
   *          exportMode?:'off'|'photo'|'ink', photoOpacity?:number}} shot
   *   lines が無い字（線データの無い字）は、画面と同じく大きな文字で写す。
   *   video が無い・まだ映っていないときは写真なしで字だけ写す。
   *   exportMode が off 以外なら PNG でも書き出す（photo は札のまま、ink は字だけで地は透過）
   * @returns {boolean} 写せたか（線が画面の外で何も描けなかったときは false）
   */
  add({ letter, lines, frames, blend, video, width, height, exportMode = 'off', photoOpacity = 1 }) {
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
    const photo = video?.videoWidth ? video : null;
    if (photo) item.appendChild(cardLayer('record-photo', photo, place));
    item.appendChild(cardLayer('record-ink', work, place));
    if (exportMode !== 'off') {
      exportShot(letter, exportMode === 'photo' ? photo : null, work, place, photoOpacity, exportMode === 'photo');
    }
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
  drawMirrored(out.getContext('2d'), source, src, outW, outH);
  return out;
}

/** 元画像の src 範囲を、左右反転して w×h いっぱいに描く */
function drawMirrored(ctx, source, src, w, h) {
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, src.x, src.y, src.w, src.h, 0, 0, w, h);
  ctx.restore();
}

/**
 * 札と同じ範囲を PNG で書き出す。大きさは札の縦横比のまま、映像の実寸（src の幅）まで上げる
 * （字が小さく写って札のほうが大きいときは札の大きさ）。
 * paper が true なら札と同じく白地に写真を濃さどおり敷き、false なら地を透過のまま字だけ描く。
 * ファイル名は「字_月日時分秒.png」。
 */
function exportShot(letter, photo, ink, { outW, outH, src }, photoOpacity, paper) {
  const k = Math.max(1, src.w / outW);
  const out = document.createElement('canvas');
  out.width = Math.round(outW * k);
  out.height = Math.round(outH * k);
  const ctx = out.getContext('2d');
  if (paper) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
  }
  if (photo) {
    ctx.globalAlpha = photoOpacity;
    drawMirrored(ctx, photo, src, out.width, out.height);
    ctx.globalAlpha = 1;
  }
  drawMirrored(ctx, ink, src, out.width, out.height);

  const name = `${letter}_${stamp(new Date())}.png`;
  out.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }, 'image/png');
}

/** 月日時分秒（例：11月3日 8:46:46 → 1103084646） */
function stamp(d) {
  return [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0')).join('');
}
