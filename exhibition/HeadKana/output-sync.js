'use strict';
const OUTPUT_CHANNEL='headkana-text-output-v1';
class TextOutputPublisher {
  constructor(getRuns,getFonts=async()=>[],Channel=globalThis.BroadcastChannel){
    this.getRuns=getRuns;this.getFonts=getFonts;this.id=null;try{this.id=globalThis.sessionStorage?.getItem('headkana-output-source');}catch{}
    if(!this.id){this.id=globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2);try{globalThis.sessionStorage?.setItem('headkana-output-source',this.id);}catch{}}
    this.signature='';this.revision=Date.now()*1000;this.sentFonts=new Set();this.channel=Channel?new Channel(OUTPUT_CHANNEL):null;
    // onConfirm: set by the control page; the text-only tab asks it to enter the kana being chosen (Enter key).
    this.onConfirm=null;
    if(this.channel)this.channel.onmessage=e=>{
      if(e.data?.type==='request'&&(!e.data.source||e.data.source===this.id))this.publish(true);
      if(e.data?.type==='confirm'&&e.data.source===this.id)this.onConfirm?.();
    };
  }
  publish(force=false){
    const runs=this.getRuns().map(r=>({text:r.text,fontFamily:r.fontFamily,fontWeight:r.fontWeight,fontSize:r.fontSize,size:r.size,pending:!!r.pending,...(Number.isFinite(r.rotationDeg)?{rotationDeg:r.rotationDeg}:{}),...(Number.isFinite(r.rotationStartedAt)?{rotationStartedAt:r.rotationStartedAt,rotationDuration:r.rotationDuration}:{})}));
    const signature=JSON.stringify(runs);if(!force&&signature===this.signature)return;
    // A tab asking again (force) may be new, so every font goes out once more; otherwise each font is sent only once.
    if(force)this.sentFonts.clear();
    this.signature=signature;const revision=++this.revision;
    this.channel?.postMessage({type:'text',source:this.id,revision,runs});
    void this.getFonts(runs,this.sentFonts).then(fonts=>{
      fonts=fonts.filter(f=>!this.sentFonts.has(f.family+':'+f.weight));if(!fonts.length)return;
      for(const f of fonts)this.sentFonts.add(f.family+':'+f.weight);
      this.channel?.postMessage({type:'fonts',source:this.id,revision,fonts});
    }).catch(()=>{});
  }
}
class TextOutputReceiver {
  constructor(onText,onFonts=()=>{},source=null,Channel=globalThis.BroadcastChannel){
    this.source=source;this.revision=0;this.channel=Channel?new Channel(OUTPUT_CHANNEL):null;
    if(this.channel){this.channel.onmessage=e=>{
      const m=e.data;if(!m||!['text','fonts'].includes(m.type)||typeof m.source!=='string'||!Number.isSafeInteger(m.revision))return;
      if(this.source&&m.source!==this.source)return;
      if(m.type==='text'&&Array.isArray(m.runs)&&m.revision>=this.revision){this.source=m.source;this.revision=m.revision;onText(m.runs);}
      if(m.type==='fonts'&&Array.isArray(m.fonts))onFonts(m.fonts);
    };this.request();}
  }
  request(){this.channel?.postMessage({type:'request',source:this.source});}
  confirm(){if(this.source)this.channel?.postMessage({type:'confirm',source:this.source});}
}
if(typeof module!=='undefined')module.exports={TextOutputPublisher,TextOutputReceiver,OUTPUT_CHANNEL};
