'use strict';
const KANA = Array.from('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん');
const HOME_INDEX=Math.round((KANA.length-1)/2);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const norm=a=>Math.hypot(...a);
const unit=a=>a.map(v=>v/(norm(a)||1));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const degrees=r=>r*180/Math.PI;
class GestureInput {
  constructor(onAction=()=>{},options={}) {
    this.action=onAction;
    this.options={range:120,hysteresis:.35,strong:150,shake:90,direction:-1,...options};
    this.recenter();
  }
  recenter(){this.yaw=0;this.selected=HOME_INDEX;this.up=null;this.neutralSamples=[];this.previous=null;this.seq=null;this.resetMotion();}
  resetMotion(){
    this.pitch=0;this.roll=0;this.nod=null;this.shake=null;
    this.nodCooldown=0;this.shakeCooldown=0;
    this.buttons=null;this.chord=false;this.clearDone=false;
  }
  feed(s){
    if(!s || !Number.isInteger(s.t) || !Number.isInteger(s.seq) || !Array.isArray(s.accel)||!Array.isArray(s.gyro)||s.accel.length!==3||s.gyro.length!==3||![...s.accel,...s.gyro].every(Number.isFinite))return null;
    const gap=this.previous===null?0:(s.t-this.previous)>>>0;
    if(this.seq!==null){const advance=(s.seq-this.seq)&65535;if(!advance||advance>32767)return null;}
    this.seq=s.seq;this.previous=s.t;
    if(!s.ready || !s.imu){this.recenter();return {calibrating:true};}
    if(gap>120)this.resetMotion();
    const dt=gap>0&&gap<=120?gap/1000:0;
    // Neutral posture defines vertical; screen normal defines forward.
    if(!this.up){
      if(norm(s.gyro)>8||norm(s.accel)<.85||norm(s.accel)>1.15)this.neutralSamples=[];
      else this.neutralSamples.push(s.accel);
      if(this.neutralSamples.length>=25){
        this.up=unit(this.neutralSamples.reduce((a,b)=>a.map((v,i)=>v+b[i]),[0,0,0]));
        let forward=[0,0,1];if(Math.abs(dot(forward,this.up))>.9)forward=[0,1,0];
        this.forward=unit(forward.map((v,i)=>v-dot(forward,this.up)*this.up[i]));
        this.right=unit(cross(this.up,this.forward));this.resetMotion();
        this.action({type:'select',index:this.selected,yaw:this.yaw});
      }
      this.buttons={red:s.red,blue:s.blue,blueAt:s.t};
      return {calibrating:!this.up,pitch:0,roll:0,yaw:0,yawRate:0,peak:0};
    }
    const a=unit(s.accel);
    const measuredPitch=degrees(Math.atan2(dot(a,this.forward),dot(a,this.up)));
    const measuredRoll=degrees(Math.atan2(dot(a,this.right),dot(a,this.up)));
    const pitchRate=-dot(s.gyro,this.right),rollRate=dot(s.gyro,this.forward);
    const goodGravity=norm(s.accel)>.8&&norm(s.accel)<1.2;
    const blend=goodGravity?1-Math.exp(-dt/.18):0;
    this.pitch+=pitchRate*dt;this.roll+=rollRate*dt;
    this.pitch+=blend*(measuredPitch-this.pitch);this.roll+=blend*(measuredRoll-this.roll);
    const yawRate=this.options.direction*dot(s.gyro,a);
    const origin=this.selected,originYaw=this.yaw;
    if(dt&&Math.abs(yawRate)>=2.5)this.yaw+=yawRate*dt;
    this.handleButtons(s);
    const state={calibrating:false,pitch:this.pitch,roll:this.roll,yaw:this.yaw,yawRate,peak:Math.abs(pitchRate)};
    if(!dt || s.red || s.blue || this.chord){this.nod=null;this.shake=null;return state;}
    // Selection is always live. Gesture candidates keep a snapshot so that
    // their meaning can be decided later without pausing or dropping yaw.
    this.nodCooldown=Math.max(0,this.nodCooldown-gap);
    this.shakeCooldown=Math.max(0,this.shakeCooldown-gap);
    this.updateSelection();
    const pitch=Math.abs(this.pitch);
    if(!this.nodCooldown&&!this.shake&&!this.nod&&pitch>7&&Math.abs(pitchRate)>=30){
      this.nod={at:s.t,peak:pitch,speed:Math.abs(pitchRate),origin};
    }
    if(this.nod){
      const n=this.nod,elapsed=(s.t-n.at)>>>0;
      n.peak=Math.max(n.peak,pitch);n.speed=Math.max(n.speed,Math.abs(pitchRate));
      if(elapsed>1200){this.nod=null;this.nodCooldown=300;}
      else if(pitch<4.5&&elapsed>=100){
        this.nod=null;
        if(n.peak>=10&&n.speed>=30){
          this.action({type:'confirm',strong:n.speed>=this.options.strong||n.peak>=28,peak:n.speed,selectionIndex:n.origin});
          this.nodCooldown=450;
        }
      }
    }
    if(!this.shakeCooldown&&!this.nod&&!this.nodCooldown&&!this.shake&&Math.abs(yawRate)>=this.options.shake){
      this.shake={at:s.t,lastMoving:s.t,sign:Math.sign(yawRate),area:0,lobes:0,qualified:false,origin,yaw:originYaw};
    }
    if(this.shake){
      const q=this.shake,elapsed=(s.t-q.at)>>>0;
      if(Math.abs(yawRate)>this.options.shake*.5){
        q.lastMoving=s.t;
        const sign=Math.sign(yawRate);
        if(sign!==q.sign){if(q.area>=8)q.lobes++;q.sign=sign;q.area=0;}
        q.area+=Math.abs(yawRate)*dt;
        if(elapsed<=1100&&q.lobes>=2&&q.area>=8)q.qualified=true;
      }
      if((elapsed>1100&&!q.qualified)||elapsed>2500){this.shake=null;}
      else if(((s.t-q.lastMoving)>>>0)>=160){
        this.shake=null;
        if(q.qualified){
          // Undo only this gesture's cursor movement after it is recognized.
          // Plain one-way turns keep their already-visible selection.
          this.yaw=q.yaw;this.selected=q.origin;
          this.action({type:'select',index:this.selected,yaw:this.yaw,correction:true});
          this.action({type:'erase'});this.shakeCooldown=650;
        }
      }
    }
    return state;
  }
  rotate(degrees){this.yaw+=degrees;this.updateSelection();}
  setHeading(degrees){this.yaw=degrees;this.updateSelection();}
  setRange(value){
    if(!Number.isFinite(Number(value)))return this.options.range;
    this.options.range=clamp(Math.round(Number(value)/10)*10,60,360);
    this.nod=null;this.shake=null;this.nodCooldown=0;this.shakeCooldown=0;
    this.updateSelection(true);
    return this.options.range;
  }
  updateSelection(force=false){
    const half=this.options.range/2,step=this.options.range/(KANA.length-1);
    const target=clamp(Math.round((this.yaw+half)/step),0,KANA.length-1);
    const center=-half+this.selected*step;
    if(target===this.selected)return;
    if(!force&&target>this.selected&&this.yaw<center+step/2+this.options.hysteresis)return;
    if(!force&&target<this.selected&&this.yaw>center-step/2-this.options.hysteresis)return;
    this.selected=target;
    this.action({type:'select',index:target,yaw:this.yaw});
  }
  handleButtons(s){
    const prev=this.buttons;
    if(!prev){this.buttons={red:s.red,blue:s.blue,blueAt:s.t};return;}
    if(this.chord){if(!s.red&&!s.blue){this.chord=false;this.clearDone=false;}}
    else if(s.red&&s.blue){this.chord=true;this.action({type:'read'});}
    else {
      if(prev.red&&!s.red){this.action({type:'confirm',strong:false});}
      if(s.blue&&!prev.blue){prev.blueAt=s.t;this.clearDone=false;}
      if(s.blue&&!s.red&&!this.clearDone&&((s.t-prev.blueAt)>>>0)>=1500){this.clearDone=true;this.action({type:'clear'});}
      if(prev.blue&&!s.blue){if(!this.clearDone)this.action({type:'erase'});this.clearDone=false;}
    }
    this.buttons={red:s.red,blue:s.blue,blueAt:prev.blueAt};
  }
}
class KanaDocument {
  constructor(){this.selected=HOME_INDEX;this.composition=[];}
  get text(){return this.composition.map(c=>c.text).join('');}
  get length(){return this.composition.length;}
  choose(index){this.selected=clamp(Math.round(index),0,KANA.length-1);}
  select(steps){this.choose(this.selected+steps);}
  confirm(strong=false,selectionIndex=this.selected,style={}){
    if(this.length>=96)return false;
    const index=clamp(Math.round(selectionIndex),0,KANA.length-1);
    this.composition.push({text:KANA[index],size:strong?2:1,...style});return true;
  }
  confirmText(value,style={}){
    const characters=Array.from(value);if(!characters.length||this.length+characters.length>96)return false;
    this.composition.push(...characters.map(text=>({text,size:1,...style})));return true;
  }
  erase(){if(!this.length)return false;this.composition.pop();return 'erase';}
  clear(){this.composition=[];}
}
if(typeof module!=='undefined')module.exports={GestureInput,KanaDocument,KANA,HOME_INDEX};
