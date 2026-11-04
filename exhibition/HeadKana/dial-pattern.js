'use strict';
const DIAL_PATTERN_NAMES={auto:'自動認識',dual:'2ダイヤル',single:'1ダイヤル＋丸型LCD',studio:'文字＋フォント＋スライダー'};
class DialPatternState {
  constructor(choice='auto'){this.choice=Object.hasOwn(DIAL_PATTERN_NAMES,choice)?choice:'auto';this.detected=null;this.selected=0;this.pressed=false;}
  get studio(){return (this.detected||this.choice)==='studio';}
  get full(){return this.single||this.studio;}
  get single(){return (this.detected||this.choice)==='single';}
  choose(choice){if(!Object.hasOwn(DIAL_PATTERN_NAMES,choice))return;this.choice=choice;this.detected=null;}
  beginConnection(){this.detected=null;}
  accept(state){
    if(state.protocol===5&&Number.isInteger(state.selected)&&state.selected>=0&&state.selected<46){
      this.detected='studio';this.selected=state.selected;this.pressed=!!state.pressed;this.fontPressed=!!state.fontPressed;return true;
    }
    if(state.protocol===4&&Number.isInteger(state.selected)&&state.selected>=0&&state.selected<46){
      this.detected='single';this.selected=state.selected;this.pressed=!!state.pressed;return true;
    }
    if(state.protocol===3){this.detected='dual';return true;}
    return false;
  }
  step(delta){this.selected=((this.selected+delta)%46+46)%46;return this.selected;}
}
if(typeof module!=='undefined')module.exports={DialPatternState,DIAL_PATTERN_NAMES};

class TypeDialControls {
  constructor(){this.reset();this.fontIndex=0;this.sizeRaw=77;this.weightRaw=1536;this.sizeStep=1;}
  reset(){this.previousCounter=null;}
  feed(state,count){
    if(this.previousCounter!==null){
      let delta=state.fontCounter-this.previousCounter;
      if(delta>32767)delta-=65536;if(delta< -32768)delta+=65536;
      this.fontIndex=((this.fontIndex+delta)%count+count)%count;
    }
    this.previousCounter=state.fontCounter;this.sizeRaw=state.sizeRaw;this.weightRaw=state.weightRaw;
  }
  style(fonts){
    this.fontIndex=((this.fontIndex%fonts.length)+fonts.length)%fonts.length;
    const font=fonts[this.fontIndex],wanted=100+800*this.weightRaw/4095;
    const fontWeight=font.weights.reduce((a,b)=>Math.abs(b-wanted)<Math.abs(a-wanted)?b:a);
    // The size snaps to multiples of sizeStep px (1 = every pixel), within 12–600px.
    const size=12+588*(1-Math.pow(1-this.sizeRaw/4095,2)),step=this.sizeStep>=1?this.sizeStep:1;
    return {fontId:font.id,fontWeight,fontSize:Math.min(600,Math.max(12,Math.round(size/step)*step))};
  }
}
if(typeof module!=='undefined')module.exports.TypeDialControls=TypeDialControls;
