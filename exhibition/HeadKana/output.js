'use strict';
const output=document.getElementById('output'),loadedFonts=new Map();
function layoutOutputLetters(){
  for(const slot of output.children){
    const glyph=slot.firstElementChild,body=centerRotationBody(glyph);if(!body)continue;
    const box=rotationFootprint(body.width,body.height,Number(slot.dataset.angle)||0,slot.dataset.moving==='true');
    Object.assign(slot.style,{width:`${Math.ceil(box.width)+8}px`,height:`${Math.ceil(box.height)+8}px`});
    Object.assign(glyph.style,{position:'absolute',left:'50%',top:'50%',marginLeft:`${-body.x}px`,marginTop:`${-body.y}px`});
  }
}
const mirror=new TextOutputReceiver(runs=>{
  output.replaceChildren(...runs.slice(0,97).map(run=>{
    const slot=document.createElement('span');slot.className='letter-slot';slot.dataset.angle=String(run.rotationDeg||0);slot.dataset.moving=String(!!run.pending);
    const span=document.createElement('span');span.className='letter-glyph';span.textContent=typeof run.text==='string'?run.text:'';
    Object.assign(span.style,runStyle(run),rotationStyle(run));
    if(run.pending){span.className+=' pending';span.setAttribute('aria-label',span.textContent+'（選択中）');}
    slot.append(span);return slot;
  }));
  layoutOutputLetters();
},fonts=>{
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
