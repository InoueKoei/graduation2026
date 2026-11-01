'use strict';
const OUTPUT_CHANNEL='headkana-text-output-v1';
class TextOutputPublisher {
  constructor(getRuns,getFonts=async()=>[],Channel=globalThis.BroadcastChannel){
    this.getRuns=getRuns;this.getFonts=getFonts;this.id=null;try{this.id=globalThis.sessionStorage?.getItem('headkana-output-source');}catch{}
    if(!this.id){this.id=globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2);try{globalThis.sessionStorage?.setItem('headkana-output-source',this.id);}catch{}}
    this.signature='';this.revision=Date.now()*1000;this.channel=Channel?new Channel(OUTPUT_CHANNEL):null;
    if(this.channel)this.channel.onmessage=e=>{if(e.data?.type==='request'&&(!e.data.source||e.data.source===this.id))this.publish(true);};
  }
  publish(force=false){
    const runs=this.getRuns().map(r=>({text:r.text,fontFamily:r.fontFamily,fontWeight:r.fontWeight,fontSize:r.fontSize,size:r.size,pending:!!r.pending}));
    const signature=JSON.stringify(runs);if(!force&&signature===this.signature)return;
    this.signature=signature;const revision=++this.revision;
    this.channel?.postMessage({type:'text',source:this.id,revision,runs});
    void this.getFonts(runs).then(fonts=>{if(fonts.length&&revision===this.revision)this.channel?.postMessage({type:'fonts',source:this.id,revision,fonts});}).catch(()=>{});
  }
}
class TextOutputReceiver {
  constructor(onText,onFonts=()=>{},source=null,Channel=globalThis.BroadcastChannel){
    this.source=source;this.revision=0;this.channel=Channel?new Channel(OUTPUT_CHANNEL):null;
    if(this.channel){this.channel.onmessage=e=>{
      const m=e.data;if(!m||!['text','fonts'].includes(m.type)||typeof m.source!=='string'||!Number.isSafeInteger(m.revision))return;
      if(this.source&&m.source!==this.source)return;
      if(m.type==='text'&&Array.isArray(m.runs)&&m.revision>=this.revision){this.source=m.source;this.revision=m.revision;onText(m.runs);}
      if(m.type==='fonts'&&m.revision===this.revision&&Array.isArray(m.fonts))onFonts(m.fonts);
    };this.request();}
  }
  request(){this.channel?.postMessage({type:'request',source:this.source});}
}
if(typeof module!=='undefined')module.exports={TextOutputPublisher,TextOutputReceiver,OUTPUT_CHANNEL};
