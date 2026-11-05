'use strict';
const output=document.getElementById('output'),loadedFonts=new Map(),bakedSets=new Map();
let latestRuns=[];
// Baked faces arrive as PNG masks; a set still loading or missing a glyph falls back to text.
function bakedSet(slug){
  if(!bakedSets.has(slug))bakedSets.set(slug,fetch(`baked/${slug}/glyphs.json`).then(r=>r.ok?r.json():null).catch(()=>null).then(set=>{bakedSets.set(slug,set);showRuns(latestRuns);}));
  const set=bakedSets.get(slug);return set instanceof Promise?null:set;
}
function bakedGlyph(run){
  const slug=bakedSlug(run.fontFamily),set=slug&&bakedSet(slug);if(!set)return null;
  const weights=Object.keys(set.weights).map(Number),want=Number(run.fontWeight)||400;if(!weights.length)return null;
  const weight=weights.reduce((a,b)=>Math.abs(b-want)<Math.abs(a-want)?b:a);
  const glyph=set.weights[weight]?.[run.text];if(!glyph)return null;
  const scale=(run.fontSize||34)*(run.size||1)/set.size,pad=glyph.file?set.pad*scale:0;
  const outer=document.createElement('span'),mask=document.createElement('span');
  outer.className='letter-glyph baked';outer.setAttribute('role','img');outer.setAttribute('aria-label',run.text);
  Object.assign(outer.style,{width:`${glyph.w*scale}px`,height:`${glyph.h*scale}px`});
  outer.dataset.inkWidth=String(glyph.w*scale-pad*2);outer.dataset.inkHeight=String(glyph.h*scale-pad*2);
  if(glyph.file){const url=`url("baked/${slug}/${glyph.file}")`;mask.className='baked-mask';mask.style.maskImage=url;mask.style.webkitMaskImage=url;outer.append(mask);}
  return outer;
}
function layoutOutputLetters(){
  for(const slot of output.children){
    const glyph=slot.firstElementChild;
    const body=glyph.dataset.inkWidth?{x:glyph.offsetWidth/2,y:glyph.offsetHeight/2,width:Math.max(1,Number(glyph.dataset.inkWidth)),height:Math.max(1,Number(glyph.dataset.inkHeight))}:centerRotationBody(glyph);
    if(!body)continue;
    const box=rotationFootprint(body.width,body.height,Number(slot.dataset.angle)||0,slot.dataset.moving==='true');
    Object.assign(slot.style,{width:`${Math.ceil(box.width)+8}px`,height:`${Math.ceil(box.height)+8}px`});
    Object.assign(glyph.style,{position:'absolute',left:'50%',top:'50%',marginLeft:`${-body.x}px`,marginTop:`${-body.y}px`});
  }
}
function showRuns(runs){
  latestRuns=runs;
  output.replaceChildren(...runs.slice(0,97).map(run=>{
    const slot=document.createElement('span');slot.className='letter-slot';slot.dataset.angle=String(run.rotationDeg||0);slot.dataset.moving=String(!!run.pending);
    let span=bakedGlyph(run);
    if(span)Object.assign(span.style,rotationStyle(run));
    else{span=document.createElement('span');span.className='letter-glyph';span.textContent=typeof run.text==='string'?run.text:'';Object.assign(span.style,runStyle(run),rotationStyle(run));}
    if(run.pending){span.classList.add('pending');span.setAttribute('aria-label',run.text+'（選択中）');}
    slot.append(span);return slot;
  }));
  layoutOutputLetters();
}
const mirror=new TextOutputReceiver(showRuns,fonts=>{
  for(const font of fonts){
    const key=font.family+':'+font.weight;if(loadedFonts.has(key)||!(font.data instanceof ArrayBuffer))continue;
    const job=new FontFace(font.family,font.data,{weight:String(font.weight)}).load().then(face=>{document.fonts.add(face);layoutOutputLetters();});
    loadedFonts.set(key,job);void job.catch(()=>loadedFonts.delete(key));
  }
},new URLSearchParams(location.search).get('source'));
// A display opened before the control page is ready asks again until it has a source.
const requestTimer=setInterval(()=>{if(mirror.revision)clearInterval(requestTimer);else mirror.request();},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)mirror.request();});
window.addEventListener('pageshow',()=>mirror.request());

// Black-and-white inversion comes from the control page (?invert=1); "i" flips it here and keeps it in the URL.
const params=new URLSearchParams(location.search);
document.documentElement.classList.toggle('invert',params.get('invert')==='1');
// Enter enters the kana being chosen on the control page, like a short press of the dial.
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.repeat&&!e.isComposing&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();mirror.confirm();}
});
document.addEventListener('keydown',e=>{
  if(e.key!=='i'||e.metaKey||e.ctrlKey||e.altKey)return;
  const on=document.documentElement.classList.toggle('invert');
  if(on)params.set('invert','1');else params.delete('invert');
  history.replaceState(null,'',location.pathname+(params.size?'?'+params:''));
});

document.addEventListener('dblclick',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}
});

document.fonts?.addEventListener('loadingdone',()=>layoutOutputLetters());
window.addEventListener('resize',()=>layoutOutputLetters());
