// 物理シーン: Matter.js によるシミュレーションと、文字グリフのキャンバス描画。
//
// 描画は Matter 標準レンダラを使わず自前で行う。理由は、衝突用に凹形状を
// 凸分割したボディではなく「本物のグリフ輪郭」を塗りたいため（書体の表情を保つ）。
// シミュレーション(物理) と 見た目(描画) を分離している。

import Matter from 'matter-js';
import decomp from 'poly-decomp';
import { normalizeVolume } from './fonts.js';

// 凹多角形の凸分割に poly-decomp を使う（fromVertices が内部で利用）
Matter.Common.setDecomp(decomp);

const { Engine, Runner, Bodies, Body, Composite } = Matter;

const INK = '#1a1a1a';
const PLATE = '#cccccc';
const PLATE_EDGE = '#949494';

export function createScene(canvas) {
  const ctx = canvas.getContext('2d');
  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1;
  engine.positionIterations = 10;
  engine.velocityIterations = 10;
  const world = engine.world;

  const letters = []; // { body, path: Path2D }
  let plate = null;
  let guards = []; // 皿の両端の立ち上がり（落下防止ガード）
  const GUARD_RISE = 60; // 皿の上面から立ち上がる高さ(px)
  const GUARD_W = 6; // ガードの厚み(px)
  let view = { w: 0, h: 0, dpr: 1 };
  let previewPath = null;
  let previewX = 0;
  let voiceLevel = 0; // 音声入力の音量 (0–1)
  let inkColor = INK; // 文字色（カラーピッカーで変更可能）
  let bgColor = '#f2f2f2'; // 背景色（皿の線色を明暗で切り替えるのに使う）

  function buildPlate() {
    if (plate) Composite.remove(world, plate);
    if (guards.length) Composite.remove(world, guards);
    const w = view.w;
    const h = view.h;
    const plateW = w * 0.8;
    const plateH = 16;
    const plateX = w / 2;
    const plateY = h * 0.82;
    // 受け皿だけが文字を受け止める。皿に乗らなかった文字は画面外まで落ちて消える。
    plate = Bodies.rectangle(plateX, plateY, plateW, plateH, {
      isStatic: true,
      friction: 0.9,
      chamfer: { radius: plateH / 2 },
      label: 'plate',
    });
    plate.plugin = { w: plateW, h: plateH };

    // 両端の立ち上がりガード。上面から GUARD_RISE 分立ち上げ、皿に少し沈めて隙間をなくす。
    const topSurface = plateY - plateH / 2;
    const sink = 8; // 皿へのめり込み量（隙間防止）
    const guardH = GUARD_RISE + sink;
    const guardY = topSurface - GUARD_RISE + guardH / 2;
    const guardOpts = { isStatic: true, friction: 0.9, restitution: 0, label: 'guard' };
    guards = [
      Bodies.rectangle(plateX - plateW / 2, guardY, GUARD_W, guardH, guardOpts),
      Bodies.rectangle(plateX + plateW / 2, guardY, GUARD_W, guardH, guardOpts),
    ];
    Composite.add(world, [plate, ...guards]);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    view = { w, h, dpr };
    previewX = w / 2;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildPlate();
  }

  /**
   * 文字ボディを 1 つ追加する。
   * @param {{contours: {x:number,y:number}[][]}} geometry buildLetterGeometry の結果
   */
  function addLetter(geometry, spawnX, color = null) {
    // 衝突は穴を除いた外周シルエット(solids)で。描画は全輪郭(contours)。
    const vertexSets = geometry.solids;
    const x = spawnX ?? view.w / 2;
    const y = -120;

    // 複数輪郭をまとめて渡すと 1 つの複合ボディになる（= 「か」が分離しない）。
    // 各輪郭は内部で凸分割され、剛体として一体で動く。
    const body = Bodies.fromVertices(
      x,
      y,
      vertexSets,
      {
        friction: 0.5,
        frictionStatic: 0.65,
        restitution: 0,
        density: 0.0012,
        // 凸包の単一ボディなので食い込みは起きにくい。slop は控えめにして
        // 文字どうしがめり込んで見えないようにする。
        slop: 0.05,
        label: 'letter',
      },
      true
    );
    if (!body) return null;

    Body.setAngle(body, (Math.random() * 2 - 1) * 0.5);
    Body.setAngularVelocity(body, (Math.random() * 2 - 1) * 0.05);

    // 描画用は元グリフのパス命令(曲線そのまま=単純化なし)から Path2D を作る
    const path = buildPath(geometry.renderCommands);

    Composite.add(world, body);
    const entry = { body, path, color }; // color が null なら共通の文字色を使う
    letters.push(entry);
    return entry;
  }

  function setPreview(geometry) {
    previewPath = geometry ? buildPath(geometry.renderCommands) : null;
  }

  function setPreviewX(x) {
    previewX = x;
  }

  function setVoiceLevel(v) {
    voiceLevel = v;
  }

  function setInkColor(color) {
    inkColor = color;
  }

  function setBackgroundColor(color) {
    bgColor = color;
  }

  // 背景の明暗で皿の線色を黒/白に切り替える
  function plateLineColor() {
    const h = bgColor.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 0.5 ? '#000000' : '#ffffff';
  }

  function reset() {
    for (const { body } of letters) Composite.remove(world, body);
    letters.length = 0;
  }

  function cull() {
    for (let i = letters.length - 1; i >= 0; i--) {
      const { body } = letters[i];
      if (body.position.y > view.h + 300) {
        Composite.remove(world, body);
        letters.splice(i, 1);
      }
    }
  }

  function drawPlate() {
    const { w, h } = plate.plugin;
    // 主張の弱い 2px の線。文字が乗る上面（body の上端）に描く。
    const topY = plate.position.y - h / 2;
    ctx.save();
    ctx.translate(plate.position.x, topY);
    ctx.rotate(plate.angle);
    ctx.strokeStyle = plateLineColor();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    // 上面の横線
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
    ctx.stroke();
    // 両端の立ち上がりガード（上方向 = マイナス）
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(-w / 2, -GUARD_RISE);
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, -GUARD_RISE);
    ctx.stroke();
    ctx.restore();
  }

  function drawLetter(entry) {
    const { body, path, color } = entry;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    // 塗り。evenodd で「あ」「ま」などのカウンター(穴)を正しく抜く。
    // 衝突は穴を埋めた外周シルエットなので、文字どうしは入れ子・貫通せず、
    // 塗りどうしが重ならない（＝輪郭が干渉しない）。
    ctx.fillStyle = color || inkColor; // 個別色があればそれを、なければ共通の文字色
    ctx.fill(path, 'evenodd');
    ctx.restore();
  }

  function drawPreview() {
    if (!previewPath) return;
    // ゴースト文字
    ctx.save();
    ctx.translate(previewX, 100);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = inkColor;
    ctx.fill(previewPath, 'evenodd');
    ctx.restore();
    // 矢印アイコン（左右矢印キーで動かせることを示す）
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = inkColor;
    ctx.font = '600 18px -apple-system, "Hiragino Sans", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText('←', previewX - 72, 100);
    ctx.textAlign = 'left';
    ctx.fillText('→', previewX + 72, 100);
    ctx.restore();
  }

  // マイク音量バー：皿の直下に細いバーで可視化
  function drawVoiceLevel() {
    if (!plate || voiceLevel < 0.001) return;
    const t = normalizeVolume(voiceLevel);
    if (t < 0.02) return;
    const maxW = plate.plugin.w - 32;
    const barH = 3;
    const bx = plate.position.x - maxW / 2;
    const by = plate.position.y + plate.plugin.h / 2 + 10;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = inkColor;
    ctx.beginPath();
    ctx.roundRect(bx, by, maxW * t, barH, barH / 2);
    ctx.fill();
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, view.w, view.h);
    drawPreview();
    drawPlate();
    drawVoiceLevel();
    for (const entry of letters) drawLetter(entry);
  }

  // 描画ループ（物理は Runner が回す）
  function loop() {
    cull();
    render();
    requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener('resize', resize);
  Runner.run(Runner.create(), engine);
  requestAnimationFrame(loop);

  return { addLetter, reset, setPreview, setPreviewX, setVoiceLevel, setInkColor, setBackgroundColor, get count() { return letters.length; } };
}

// 元グリフのパス命令から Path2D を生成（曲線をそのまま再現）
function buildPath(commands) {
  const p = new Path2D();
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        p.moveTo(cmd.x, cmd.y);
        break;
      case 'L':
        p.lineTo(cmd.x, cmd.y);
        break;
      case 'Q':
        p.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
        break;
      case 'C':
        p.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        break;
      case 'Z':
        p.closePath();
        break;
      default:
        break;
    }
  }
  return p;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
