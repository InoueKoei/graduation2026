'use strict';
const output=document.getElementById('output'),loadedFonts=new Map();
const mirror=new TextOutputReceiver(runs=>{
  output.replaceChildren(...runs.slice(0,97).map(run=>{
    const span=document.createElement('span');span.textContent=typeof run.text==='string'?run.text:'';
    Object.assign(span.style,runStyle(run));
    if(run.pending){span.className='pending';span.setAttribute('aria-label',span.textContent+'（選択中）');}
    return span;
  }));
},fonts=>{
  for(const font of fonts){
    const key=font.family+':'+font.weight;if(loadedFonts.has(key)||!(font.data instanceof ArrayBuffer))continue;
    const job=new FontFace(font.family,font.data,{weight:String(font.weight)}).load().then(face=>document.fonts.add(face));
    loadedFonts.set(key,job);void job.catch(()=>loadedFonts.delete(key));
  }
},new URLSearchParams(location.search).get('source'));
// A display opened before the control page is ready asks again until it has a source.
const requestTimer=setInterval(()=>{if(mirror.revision)clearInterval(requestTimer);else mirror.request();},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)mirror.request();});
window.addEventListener('pageshow',()=>mirror.request());
