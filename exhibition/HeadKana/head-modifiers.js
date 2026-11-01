'use strict';
const MODIFIER_NAMES=['濁点','半濁点','小文字'];
const VOICED_BASE=Array.from('うかきくけこさしすせそたちつてとはひふへほ');
const VOICED_FORM=Array.from('ゔがぎぐげござじずぜぞだぢづでどばびぶべぼ');
const HALF_BASE=Array.from('はひふへほ'),HALF_FORM=Array.from('ぱぴぷぺぽ');
const SMALL_BASE=Array.from('あいうえおつやゆよわかけ'),SMALL_FORM=Array.from('ぁぃぅぇぉっゃゅょゎゕゖ');
function modifiedKana(character,count){
  let base=character.normalize('NFD').replace(/[\u3099\u309a]/g,'').normalize('NFC');
  const small=SMALL_FORM.indexOf(base);if(small>=0)base=SMALL_BASE[small];
  const source=count===1?VOICED_BASE:count===2?HALF_BASE:SMALL_BASE;
  const forms=count===1?VOICED_FORM:count===2?HALF_FORM:SMALL_FORM;
  const index=source.indexOf(base);return index<0?null:forms[index];
}
function applyKanaModifier(doc,count,target){
  if(!target||!doc.composition.includes(target))return {changed:false,reason:'target-missing'};
  const from=target.text,to=modifiedKana(from,count);
  if(to===null)return {changed:false,reason:'unsupported',from};
  target.text=to;return {changed:from!==to,from,to};
}
class HeadModifierInput {
  constructor(action=()=>{},options={}){this.action=action;this.options={minAngle:20,minSpeed:60,...options};this.recenter();}
  recenter(){this.up=null;this.samples=[];this.previous=null;this.seq=null;this.pitch=0;this.nod=null;this.cooldown=0;this.action({type:'reset'});}
  feed(s){
    if(!s||!Number.isInteger(s.t)||!Number.isInteger(s.seq)||!Array.isArray(s.accel)||!Array.isArray(s.gyro)||s.accel.length!==3||s.gyro.length!==3||![...s.accel,...s.gyro].every(Number.isFinite))return null;
    if(this.seq!==null){const advance=(s.seq-this.seq)&65535;if(!advance||advance>32767)return null;}
    const elapsed=this.previous===null?0:(s.t-this.previous)>>>0;
    this.seq=s.seq;this.previous=s.t;
    if(!s.ready||!s.imu||elapsed>120){this.recenter();return {calibrating:true};}
    const length=a=>Math.hypot(...a),dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
    const unit=a=>a.map(v=>v/(length(a)||1));
    if(!this.up){
      if(length(s.gyro)>8||length(s.accel)<.85||length(s.accel)>1.15)this.samples=[];
      else this.samples.push(s.accel);
      if(this.samples.length>=25){
        this.up=unit(this.samples.reduce((a,b)=>a.map((v,i)=>v+b[i]),[0,0,0]));
        let forward=Math.abs(this.up[2])>.9?[0,1,0]:[0,0,1];
        this.forward=unit(forward.map((v,i)=>v-dot(forward,this.up)*this.up[i]));
        const u=this.up,f=this.forward;this.right=[u[1]*f[2]-u[2]*f[1],u[2]*f[0]-u[0]*f[2],u[0]*f[1]-u[1]*f[0]];
      }
      return {calibrating:!this.up,pitch:0};
    }
    const dt=elapsed/1000,a=unit(s.accel),rate=-dot(s.gyro,this.right);
    const measured=Math.atan2(dot(a,this.forward),dot(a,this.up))*180/Math.PI;
    const blend=length(s.accel)>.8&&length(s.accel)<1.2?1-Math.exp(-dt/.18):0;
    this.pitch+=rate*dt;this.pitch+=blend*(measured-this.pitch);
    this.cooldown=Math.max(0,this.cooldown-elapsed);
    const pitch=Math.abs(this.pitch),speed=Math.abs(rate);
    if(!this.cooldown&&!this.nod&&pitch>this.options.minAngle*.7&&speed>=this.options.minSpeed){
      this.action({type:'begin'});
      this.nod={at:s.t,peak:pitch,speed};
    }
    if(this.nod){
      const n=this.nod,age=(s.t-n.at)>>>0;n.peak=Math.max(n.peak,pitch);n.speed=Math.max(n.speed,speed);
      if(age>1400){this.nod=null;this.cooldown=120;this.action({type:'cancel'});}
      else if(pitch<4.5&&age>=80){
        this.nod=null;
        if(n.peak>=this.options.minAngle&&n.speed>=this.options.minSpeed){
          this.cooldown=100;
          this.action({type:'nod'});
        }else this.action({type:'cancel'});
      }
    }
    return {calibrating:false,pitch:this.pitch,rate};
  }
}
class KanaModifierCycle {
  constructor(){this.reset();}
  reset(){this.target=null;this.count=0;}
  apply(doc,target){
    if(!target||!doc.composition.includes(target))return {changed:false,reason:'target-missing',count:0};
    if(this.target!==target){this.target=target;this.count=0;}
    this.count=this.count%3+1;
    return {...applyKanaModifier(doc,this.count,target),count:this.count};
  }
}
if(typeof module!=='undefined')module.exports={HeadModifierInput,KanaModifierCycle,applyKanaModifier,modifiedKana,MODIFIER_NAMES};
