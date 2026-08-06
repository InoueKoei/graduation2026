import { ImageSegmenter, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// ── 調整パラメータ ─────────────────────────────
const CONFIG = {
  cellSize: 64,            // 1文字ぶんのセル送り(px)。列幅もこれ
  fontFamily: '"Hiragino Mincho ProN","Yu Mincho",serif',

  // ── 見た目 ──
  bgColor: '#ffffff',      // 背景（紙）の色
  bgOpacity: 0,            // 背景の不透明度(0-1)。下げると映像が薄く透ける
  textColor: '#ffffff',    // 文字色
  textOpacity: 1,          // 文字の不透明度(0-1)
  personMode: 'video',     // 'video'=人物部分に映像を見せる / 'color'=単色で塗る
  personColor: '#000000',  // personMode:'color' のときの人物部分の色
  personOpacity: 1,        // personMode:'color' のときの不透明度(0-1)

  // ── 判定 ──
  personThreshold: 0.4,    // セル内の人物信頼度がこれ以上になったら「人」
  releaseThreshold: 0.25,  // 「人」セルはここまで下がるまで解除しない（ヒステリシス）
  dilateCells: 0,          // 人シルエットの外側マージン（セル数）
  sample: 6,               // セル判定サンプリング n×n
  maskSmoothing: 0.55,     // 前フレームを残す割合。輪郭のちらつきを抑える
  maskEdgeLow: 0.2,        // 表示マスクの半透明開始位置
  maskEdgeHigh: 0.7,       // 表示マスクが不透明になる位置
  camWidth: 1280,
  camHeight: 720,
  relayoutMs: 120,         // 組み直しの最短間隔(ms)
};

const TEXT =
  "ことばはいつもからだのまわりをながれている" +
  "あなたがそこにたつときもじはあなたのかたちをおぼえ" +
  "そっとよけてとおりすぎてゆくくうはくはあなたのりんかく" +
  "うつしだされたかげのなかにだけしずけさがのこる" +
  "てをあげればことばはひらきうごけばまたとじてゆく" +
  "かきことばとからだのあいだにあたらしいよはくがうまれる";
const chars = [...TEXT];
const SVG_NS = 'http://www.w3.org/2000/svg';

// ── DOM ───────────────────────────────────────
const intro    = document.getElementById('intro');
const startBtn = document.getElementById('start');
const statusEl = document.getElementById('status');
const video    = document.getElementById('cam');
const backdrop = document.getElementById('backdrop');
const ctx      = backdrop.getContext('2d');
const svg      = document.getElementById('glyphs');
const maskcv   = document.getElementById('maskcv');
const mctx     = maskcv.getContext('2d', { willReadFrequently:true });
// 人物単色塗り用（personMode:'color'）
const tintcv   = document.createElement('canvas');
const tintctx  = tintcv.getContext('2d');
const fontSel  = document.getElementById('fontSelect');
const loadFontsBtn = document.getElementById('loadFonts');
const sizeRange    = document.getElementById('sizeRange');

// ── 状態 ───────────────────────────────────────
let COL_W=CONFIG.cellSize, ROW_H=CONFIG.cellSize, cols=0, rows=0;
let mask=null, maskW=0, maskH=0, maskDirty=false, maskInitialized=false;
let blockRaw=null;   // ヒステリシス済みの素の人セル
let blockDil=null;   // dilate 後（レイアウトはこちらを見る）
let needLayout=true, lastLayout=0;
let dpr=1;

function resize(){
  dpr=Math.min(window.devicePixelRatio||1,2);
  backdrop.width=innerWidth*dpr; backdrop.height=innerHeight*dpr;
  backdrop.style.width=innerWidth+'px'; backdrop.style.height=innerHeight+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  COL_W=ROW_H=CONFIG.cellSize;
  cols=Math.max(1,Math.floor(innerWidth/COL_W));
  rows=Math.ceil(innerHeight/ROW_H);
  blockRaw=new Uint8Array(cols*rows);
  blockDil=new Uint8Array(cols*rows);
  svg.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);
  layout();
}
window.addEventListener('resize',resize);

// CONFIGの色をCSS変数へ反映（intro・パネル等のDOMも追従）
function applyTheme(){
  document.documentElement.style.setProperty('--paper', CONFIG.bgColor);
}
applyTheme();

// 縦書きは右端から読み始めるため、グリッドは右端に揃える
const colX=(c)=>innerWidth-(cols-c-0.5)*COL_W;

// video の object-fit:cover と同じ拡大率・切り抜き位置を返す
function getCoverRect(){
  const sourceW=video.videoWidth||CONFIG.camWidth;
  const sourceH=video.videoHeight||CONFIG.camHeight;
  const scale=Math.max(innerWidth/sourceW,innerHeight/sourceH);
  const width=sourceW*scale, height=sourceH*scale;
  return { x:(innerWidth-width)/2, y:(innerHeight-height)/2, width, height };
}

// ── セル判定 ───────────────────────────────────
function cellPersonFrac(c,r){
  if(!mask) return 0;
  const n=CONFIG.sample;
  const cx=colX(c), cy=(r+0.5)*ROW_H;
  const cover=getCoverRect();
  let confidence=0,total=0;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){
    const px=cx-COL_W/2+COL_W*(i+0.5)/n;
    const py=cy-ROW_H/2+ROW_H*(j+0.5)/n;
    // 表示は鏡像かつ cover で切り抜かれているため、その逆変換を行う
    const mx=Math.floor(((innerWidth-px-cover.x)/cover.width)*maskW);
    const my=Math.floor(((py-cover.y)/cover.height)*maskH);
    if(mx<0||my<0||mx>=maskW||my>=maskH) continue;
    total++;
    confidence+=mask[my*maskW+mx];
  }
  return total>0 ? confidence/total : 0;
}

// ヒステリシス付きでセルの人判定を更新。変化があれば true
function updateBlockMap(){
  let changed=false;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const i=r*cols+c;
    const frac=cellPersonFrac(c,r);
    const was=blockRaw[i]===1;
    const now=was ? frac>CONFIG.releaseThreshold : frac>=CONFIG.personThreshold;
    if(now!==was){ blockRaw[i]=now?1:0; changed=true; }
  }
  if(changed){
    const d=CONFIG.dilateCells;
    blockDil.fill(0);
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      if(blockRaw[r*cols+c]!==1) continue;
      for(let rr=Math.max(0,r-d);rr<=Math.min(rows-1,r+d);rr++)
        for(let cc=Math.max(0,c-d);cc<=Math.min(cols-1,c+d);cc++)
          blockDil[rr*cols+cc]=1;
    }
  }
  return changed;
}
const isBlocked=(c,r)=>blockDil[r*cols+c]===1;

// ── 縦書きレイアウト（SVG） ─────────────────────
// 列を右→左に走査し、人体で分断された空き区間ごとに <text> ランを作る。
// ランは writing-mode:vertical-rl でブラウザがシェイピングするため、
// 縦書きグリフ(vert)と連綿(calt/liga)がラン内で結ばれ、
// 人の動きでラン長＝連綿の区切りが変わる。
function takeChars(start,n){
  let s='';
  for(let k=0;k<n;k++) s+=chars[(start+k)%chars.length];
  return s;
}
function measure(t){
  try{ return t.getComputedTextLength(); }catch(e){ return 0; }
}
function fillSegment(x, top, height, startIdx, fontSize){
  const t=document.createElementNS(SVG_NS,'text');
  t.setAttribute('x', x);
  t.setAttribute('y', top + fontSize*0.06);
  svg.appendChild(t);

  // まず1セル1文字で当て、実測で詰める（連綿フォントは送りが縮むため）
  let n=Math.max(1, Math.ceil(height/fontSize)+1);
  t.textContent=takeChars(startIdx,n);
  let guard=0;
  while(n>0 && measure(t)>height && guard++<60){
    n--; t.textContent=takeChars(startIdx,n);
  }
  // 連綿で詰まって余白が出たぶんを追い足す
  guard=0;
  while(guard++<8){
    t.textContent=takeChars(startIdx,n+1);
    const len=measure(t);
    if(len===0 || len>height){ t.textContent=takeChars(startIdx,n); break; }
    n++;
  }
  if(n<=0){ svg.removeChild(t); return startIdx; }
  return startIdx+n;
}
function layout(){
  while(svg.firstChild) svg.removeChild(svg.firstChild);
  const fontSize=Math.round(ROW_H*0.84);
  svg.style.fontSize=fontSize+'px';
  svg.style.fontFamily=CONFIG.fontFamily;
  svg.style.fill=CONFIG.textColor;
  svg.style.opacity=CONFIG.textOpacity;

  let idx=0;
  for(let c=cols-1;c>=0;c--){          // 右の列から左へ
    const x=colX(c);
    let r=0;
    while(r<rows){
      while(r<rows && isBlocked(c,r)) r++;
      const rStart=r;
      while(r<rows && !isBlocked(c,r)) r++;
      const segH=(r-rStart)*ROW_H;
      if(segH<fontSize) continue;      // 1文字も入らない隙間は飛ばす
      idx=fillSegment(x, rStart*ROW_H, segH, idx, fontSize);
    }
  }
}

// ── 背景と人物の合成（毎フレーム） ───────────────
function draw(){
  ctx.clearRect(0,0,innerWidth,innerHeight);
  ctx.save();
  ctx.globalAlpha=CONFIG.bgOpacity;
  ctx.fillStyle=CONFIG.bgColor;
  ctx.fillRect(0,0,innerWidth,innerHeight);
  ctx.restore();

  if(mask){
    if(maskcv.width!==maskW||maskcv.height!==maskH){ maskcv.width=maskW; maskcv.height=maskH; }
    const img=mctx.createImageData(maskW,maskH);
    const edgeRange=Math.max(0.001,CONFIG.maskEdgeHigh-CONFIG.maskEdgeLow);
    for(let i=0;i<mask.length;i++){
      const x=Math.max(0,Math.min(1,(mask[i]-CONFIG.maskEdgeLow)/edgeRange));
      const smooth=x*x*(3-2*x);
      img.data[i*4+3]=Math.round(smooth*255);
    }
    mctx.putImageData(img,0,0);
    const cover=getCoverRect();

    if(CONFIG.personMode==='video'){
      // 背景色を人型に抜く → 下の映像が覗く
      ctx.save();
      ctx.globalCompositeOperation='destination-out';
      ctx.translate(innerWidth,0); ctx.scale(-1,1);
      ctx.imageSmoothingEnabled=true;
      ctx.drawImage(maskcv,cover.x,cover.y,cover.width,cover.height);
      ctx.restore();
    }else{
      // 人型を単色で塗る（映像は見せない）
      if(tintcv.width!==maskW||tintcv.height!==maskH){ tintcv.width=maskW; tintcv.height=maskH; }
      tintctx.clearRect(0,0,maskW,maskH);
      tintctx.globalCompositeOperation='source-over';
      tintctx.drawImage(maskcv,0,0);
      tintctx.globalCompositeOperation='source-in';
      tintctx.fillStyle=CONFIG.personColor;
      tintctx.fillRect(0,0,maskW,maskH);
      ctx.save();
      ctx.globalAlpha=CONFIG.personOpacity;
      ctx.translate(innerWidth,0); ctx.scale(-1,1);
      ctx.imageSmoothingEnabled=true;
      ctx.drawImage(tintcv,cover.x,cover.y,cover.width,cover.height);
      ctx.restore();
    }
  }
}

// ── MediaPipe Image Segmentation ──────────────
let segmenter=null;
async function initSeg(){
  const files=await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  segmenter=await ImageSegmenter.createFromOptions(files,{
    baseOptions:{
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
      delegate:"GPU"
    },
    runningMode:"VIDEO",
    outputCategoryMask:false,
    outputConfidenceMasks:true
  });
}

let lastTime=-1;
function loop(){
  if(segmenter && video.readyState>=2 && video.currentTime!==lastTime){
    lastTime=video.currentTime;
    segmenter.segmentForVideo(video, performance.now(), (res)=>{
      const confidenceMasks=res.confidenceMasks;
      if(confidenceMasks&&confidenceMasks.length){
        // selfie_multiclass の 0 番は背景。1-背景信頼度を人物信頼度にする
        const bg=confidenceMasks[0];
        const data=bg.getAsFloat32Array();
        maskW=bg.width; maskH=bg.height;
        if(!mask||mask.length!==data.length){
          mask=new Float32Array(data.length);
          maskInitialized=false;
        }
        const keep=maskInitialized?CONFIG.maskSmoothing:0;
        for(let i=0;i<data.length;i++){
          const personConfidence=1-Math.max(0,Math.min(1,data[i]));
          mask[i]=mask[i]*keep+personConfidence*(1-keep);
        }
        maskInitialized=true;
        for(const confidenceMask of confidenceMasks) confidenceMask.close();
        maskDirty=true;
      }
    });
  }
  // 組み直しはセル判定が変化したときだけ・最短 relayoutMs 間隔
  if(maskDirty){
    maskDirty=false;
    if(updateBlockMap()) needLayout=true;
  }
  const now=performance.now();
  if(needLayout && now-lastLayout>=CONFIG.relayoutMs){
    layout(); needLayout=false; lastLayout=now;
  }
  draw();
  requestAnimationFrame(loop);
}

// ── フォント選択 ──────────────────────────────
fontSel.addEventListener('change',()=>{ CONFIG.fontFamily=fontSel.value; layout(); });
sizeRange.addEventListener('input',()=>{ CONFIG.cellSize=+sizeRange.value; resize(); });
loadFontsBtn.addEventListener('click',async()=>{
  if(!('queryLocalFonts' in window)){ loadFontsBtn.textContent='非対応ブラウザ'; return; }
  try{
    const fonts=await window.queryLocalFonts();
    const seen=new Set();
    for(const f of fonts){
      if(seen.has(f.family)) continue;
      seen.add(f.family);
      const opt=document.createElement('option');
      opt.value=`"${f.family}"`; opt.textContent=f.family;
      fontSel.appendChild(opt);
    }
    loadFontsBtn.textContent=`読込済 (${seen.size})`;
    loadFontsBtn.disabled=true;
  }catch(e){ loadFontsBtn.textContent='許可されませんでした'; console.error(e); }
});

// ── 起動 ───────────────────────────────────────
async function start(){
  startBtn.disabled=true;
  statusEl.textContent='よみこみちゅう…';
  try{
    const stream=await navigator.mediaDevices.getUserMedia({
      video:{ facingMode:"user", width:CONFIG.camWidth, height:CONFIG.camHeight },
      audio:false });
    video.srcObject=stream; await video.play();
    await initSeg();
    statusEl.textContent='';
    intro.style.opacity='0';
    setTimeout(()=>intro.style.display='none',800);
    loop();
  }catch(e){
    statusEl.textContent=''; startBtn.disabled=false;
    intro.querySelector('p').textContent=
      'カメラを　つかえませんでした　きょかを　かくにんしてください';
    console.error(e);
  }
}
startBtn.addEventListener('click',start);

resize();   // 初期レイアウト（カメラ開始前も縦書きテキストを組んでおく）
