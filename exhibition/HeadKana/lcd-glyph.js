'use strict';
// Draws the 46 kana in the input's font and weight for the dial's round LCD (firmware v2.7+, @GLYPHSET).
// The board keeps the whole set, so turning the dial switches locally; a new set goes out only when the font or weight changes.
// The size is not reflected on the LCD: every kana uses one em, shrunk only if the turned glyph would leave the tile.
// The LCD is mounted turned, so the glyph is turned 120° counter-clockwise like the built-in Noto bitmaps.
const LCD_GLYPH_ANGLE_CCW=120,LCD_GLYPH_EM=150;
function renderLcdGlyph(canvas,run,size){
  canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),radians=LCD_GLYPH_ANGLE_CCW*Math.PI/180;
  ctx.fillStyle='#000';ctx.fillRect(0,0,size,size);
  const measure=em=>{ctx.font=`${run.fontWeight||400} ${em}px ${run.fontFamily}`;return ctx.measureText(run.text);};
  let em=LCD_GLYPH_EM,m=measure(em);
  const inkWidth=m.actualBoundingBoxLeft+m.actualBoundingBoxRight,inkHeight=m.actualBoundingBoxAscent+m.actualBoundingBoxDescent;
  const c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians)),turned=Math.max(inkWidth*c+inkHeight*s,inkWidth*s+inkHeight*c),limit=size-8;
  if(turned>limit){em*=limit/turned;m=measure(em);}
  // Centre the ink, not the em box, as the text-only page does.
  ctx.translate(size/2,size/2);ctx.rotate(-radians);ctx.fillStyle='#fff';
  ctx.fillText(run.text,(m.actualBoundingBoxLeft-m.actualBoundingBoxRight)/2,(m.actualBoundingBoxAscent-m.actualBoundingBoxDescent)/2);
}
// Run-length coded 4-bit grey: 1x yyyyyy = black (x=0) / white (x=1) for y+1 pixels (1-64); 0g gggyyy = grey g for y+1 pixels (1-8).
function encodeLcdGlyph(canvas,size){
  const {data}=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,size,size),total=size*size,out=[];
  for(let i=0;i<total;){
    const level=data[i*4]>>4,solid=level===0||level===15,max=solid?64:8;let run=1;
    while(i+run<total&&run<max&&data[(i+run)*4]>>4===level)run++;
    out.push(solid?0x80|(level?0x40:0)|(run-1):(level<<3)|(run-1));i+=run;
  }
  return Uint8Array.from(out);
}
class LcdGlyphSender {
  constructor(write){this.write=write;this.size=0;this.signature='';this.selected=0;this.job=null;this.sending=false;this.canvas=document.createElement('canvas');}
  enable(size){if(size===this.size)return;this.size=size;this.signature='';}
  disable(){this.size=0;this.job=null;this.signature='';}
  // ready: () => Promise, settled once the run's font can be drawn. A newer font or weight restarts the set.
  update(selected,run,ready){
    this.selected=selected;
    if(!this.size||!run)return;
    const signature=JSON.stringify([run.fontFamily,run.fontWeight]);
    if(signature===this.signature)return;
    this.signature=signature;this.job={run,ready};void this.flush();
  }
  async flush(){
    if(this.sending)return;this.sending=true;
    try{
      while(this.job){
        const {run,ready}=this.job;this.job=null;
        try{await ready?.();}catch{}
        if(!this.size)break;
        await this.write(Uint8Array.of(0x53));
        // Nearest the kana being chosen first, re-checked after every glyph so a turn mid-set is served next.
        const left=new Set(KANA.keys());
        while(left.size&&!this.job&&this.size){
          const distance=i=>{const d=Math.abs(i-this.selected)%46;return Math.min(d,46-d);};
          const index=[...left].reduce((a,b)=>distance(b)<distance(a)?b:a);left.delete(index);
          renderLcdGlyph(this.canvas,{...run,text:KANA[index]},this.size);
          const body=encodeLcdGlyph(this.canvas,this.size),frame=new Uint8Array(body.length+4);
          frame.set([0x67,index,body.length&255,body.length>>8]);frame.set(body,4);
          await this.write(frame);
        }
      }
    }catch(error){console.warn('LCD glyph:',error.message);}
    finally{this.sending=false;}
  }
}
if(typeof module!=='undefined')module.exports={encodeLcdGlyph,LcdGlyphSender};
