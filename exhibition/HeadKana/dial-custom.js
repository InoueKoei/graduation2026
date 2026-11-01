'use strict';
const DIAL_ROLES={split:'かなを分割',weight:'ウェイト',font:'フォント',size:'文字サイズ',symbols:'文字・記号'};
const WEIGHT_NAMES={100:'極細',200:'細め',300:'ライト',400:'標準',500:'ミディアム',600:'やや太め',700:'ボールド',800:'極太',900:'ブラック'};
const DEFAULT_DIAL_OPTIONS={weights:[100,200,300,400,500,600,700,800,900],sizes:[16,24,34,48,64,96,128],symbols:['、','。','！','？','…','ー',' '],fontIds:['system','serif','mono','zen-maru']};
function dialWrap(index,count){return ((index%count)+count)%count;}
function dialDelta(next,previous,count){let d=next-previous;if(d>count/2)d-=count;if(d<-count/2)d+=count;return d;}
function parseDialNumbers(value,min,max){
  const tokens=value.split(/[\s,、]+/).filter(Boolean),numbers=tokens.map(Number);
  if(!tokens.length||numbers.some(v=>!Number.isInteger(v)||v<min||v>max))throw Error(`${min}〜${max}の整数をカンマで区切ってください`);
  return [...new Set(numbers)].sort((a,b)=>a-b).slice(0,48);
}
function fontWeightFromName(name){
  const s=name.toLowerCase().replace(/[\s_-]/g,'');
  if(/black|heavy|ultraheavy/.test(s)||/-h$/i.test(name))return 900;
  if(/extrabold|ultrabold/.test(s))return 800;
  if(/semibold|demibold/.test(s))return 600;
  if(/bold/.test(s))return 700;
  if(/medium/.test(s))return 500;
  if(/extralight|ultralight/.test(s))return 200;
  if(/thin/.test(s))return 100;
  if(/light/.test(s))return 300;
  return 400;
}
function matchMojiFonts(curated,available){
  const normalize=s=>s.toLowerCase().replace(/[\s_-]/g,'');
  return curated.flatMap((entry,index)=>{
    const wanted=normalize(entry.postscript||entry.family||'');
    const faces=available.filter(fd=>normalize(entry.postscript?fd.postscriptName:fd.family).includes(wanted));
    if(!wanted||!faces.length)return [];
    return [{id:`moji-${index}`,label:entry.label.trim(),family:`HeadKanaLocal${index}`,faces,
      weights:[...new Set(faces.map(f=>fontWeightFromName(f.style+' '+f.postscriptName)))].sort((a,b)=>a-b)}];
  });
}
class DialAssignments {
  constructor(fonts,options={}){
    this.fonts=fonts;this.options={...DEFAULT_DIAL_OPTIONS,...options};
    this.mode=Object.hasOwn(DIAL_ROLES,options.mode)?options.mode:'split';
    this.style={fontId:'system',fontWeight:400,fontSize:34};this.leftIndex=0;this.rightIndex=0;this.previous=null;
    this.alignChoice();
  }
  rebase(){this.previous=null;}
  setMode(mode){if(!Object.hasOwn(DIAL_ROLES,mode))return;this.mode=mode;this.alignChoice();}
  font(id=this.style.fontId){return this.fonts.find(f=>f.id===id)||this.fonts[0];}
  choices(){
    if(this.mode==='font'){
      const fonts=this.fonts.filter(f=>this.options.fontIds.includes(f.id));
      return (fonts.length?fonts:[this.fonts[0]]).map(f=>({value:f.id,label:f.label}));
    }
    if(this.mode==='weight'){
      const available=this.font().weights,weights=this.options.weights.filter(w=>available.includes(w));
      return (weights.length?weights:[available.reduce((a,b)=>Math.abs(b-this.style.fontWeight)<Math.abs(a-this.style.fontWeight)?b:a)]).map(w=>({value:w,label:String(w),detail:WEIGHT_NAMES[w]||''}));
    }
    if(this.mode==='size')return this.options.sizes.map(n=>({value:n,label:String(n),detail:'px'}));
    if(this.mode==='symbols')return this.options.symbols.map(s=>({value:s,label:s===' '?'空白':s}));
    return [];
  }
  alignChoice(){const key={font:'fontId',weight:'fontWeight',size:'fontSize'}[this.mode];this.rightIndex=Math.max(0,this.choices().findIndex(c=>c.value===this.style[key]));}
  sync(positions){
    if(!Array.isArray(positions)||positions.length!==2||!Number.isInteger(positions[0])||!Number.isInteger(positions[1])||positions[0]<0||positions[0]>=25||positions[1]<25||positions[1]>=46)return false;
    if(this.previous){
      if(this.mode!=='split'){
        this.leftIndex=dialWrap(this.leftIndex+dialDelta(positions[0],this.previous[0],25),46);
        this.rightIndex=dialWrap(this.rightIndex+dialDelta(positions[1],this.previous[1],21),Math.max(1,this.choices().length));
      }
    }else if(this.mode!=='split')this.leftIndex=positions[0];
    if(this.mode==='split')this.leftIndex=positions[0];
    this.previous=positions.slice();return true;
  }
  draft(){
    const style={...this.style},choice=this.choices()[this.rightIndex];if(!choice)return style;
    const key={font:'fontId',weight:'fontWeight',size:'fontSize'}[this.mode];if(key)style[key]=choice.value;
    const font=this.font(style.fontId);
    if(!font.weights.includes(style.fontWeight))style.fontWeight=font.weights.reduce((a,b)=>Math.abs(b-style.fontWeight)<Math.abs(a-style.fontWeight)?b:a);
    return style;
  }
  commit(){this.style=this.draft();return {...this.style};}
}
function runStyle(run){return {fontFamily:run.fontFamily||'-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif',fontWeight:String(run.fontWeight||400),fontSize:`${(run.fontSize||34)*(run.size||1)}px`};}
class DialFontCatalog {
  constructor(){
    const all=[100,200,300,400,500,600,700,800,900];
    this.fonts=[{id:'system',label:'ゴシック',family:'-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif',weights:all},
      {id:'serif',label:'明朝',family:'"Hiragino Mincho ProN","Yu Mincho",serif',weights:all},
      {id:'mono',label:'等幅',family:'"Osaka-Mono",monospace',weights:all},
      {id:'zen-maru',label:'ゼン丸ゴシック',family:'"HeadKanaZenMaru",sans-serif',weights:[300,400,500,700,900]}];
    this.loaded=new Map();
  }
  async readLocalFonts(){
    if(!window.queryLocalFonts)throw Error('PCのフォント読み込みはChromeで利用できます');
    // Request access only from the explicit button click. Font files stay in this browser.
    const available=await window.queryLocalFonts();
    const response=await fetch('moji-fonts.json');if(!response.ok)throw Error('Moji-stackの書体リストを読み込めませんでした');
    const curated=(await response.json()).fonts;
    this.fonts=this.fonts.filter(f=>!f.id.startsWith('moji-')).concat(matchMojiFonts(curated,available));
    return this.fonts.filter(f=>f.faces).length;
  }
  load(id,weight){
    const font=this.fonts.find(f=>f.id===id);if(!font?.faces)return Promise.resolve();
    const face=font.faces.find(f=>fontWeightFromName(f.style+' '+f.postscriptName)===weight)||font.faces[0];
    const key=face.postscriptName;if(!this.loaded.has(key))this.loaded.set(key,(async()=>{
      const data=await (await face.blob()).arrayBuffer();
      const loaded=await new FontFace(font.family,data,{weight:String(fontWeightFromName(face.style+' '+face.postscriptName))}).load();document.fonts.add(loaded);
    })().catch(error=>{this.loaded.delete(key);throw error;}));
    return this.loaded.get(key);
  }
}
if(typeof module!=='undefined')module.exports={DialAssignments,DialFontCatalog,DIAL_ROLES,DEFAULT_DIAL_OPTIONS,parseDialNumbers,matchMojiFonts,fontWeightFromName,runStyle};
