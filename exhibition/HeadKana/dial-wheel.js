'use strict';
class DialWheel {
  constructor(element,characters){
    this.element=element;this.setCharacters(characters);
  }
  setCharacters(characters){
    this.element.replaceChildren?.();this.count=characters.length;this.index=0;this.rotation=0;
    this.labels=characters.map((character,index)=>{
      const angle=index*2*Math.PI/this.count,label=document.createElement('span');
      label.className='dial-letter';label.textContent=character;
      label.style.left=`${50+43*Math.sin(angle)}%`;
      label.style.top=`${50-43*Math.cos(angle)}%`;
      this.element.append(label);return label;
    });
    this.select(0);
  }
  select(index){
    // Keep the short path across the ん / あ seam, including repeated turns.
    let delta=index-this.index;
    if(delta>this.count/2)delta-=this.count;
    if(delta<-this.count/2)delta+=this.count;
    this.rotation-=delta*360/this.count;this.index=index;
    this.element.style.setProperty('--dial-rotation',`${this.rotation}deg`);
    this.labels.forEach((label,i)=>label.classList.toggle('selected',i===index));
  }
}
class SplitDialState {
  constructor(){this.positions=[0,25];this.pressedMask=0;}
  observe(index){
    if(!Number.isInteger(index)||index<0||index>=46)return;
    this.positions[index<25?0:1]=index;
  }
  sync(positions,pressedMask=0){
    if(!Array.isArray(positions)||positions.length!==2||!positions.every(Number.isInteger)||positions[0]<0||positions[0]>=25||positions[1]<25||positions[1]>=46)return false;
    this.positions=positions.slice();this.pressedMask=pressedMask&3;return true;
  }
  step(group,delta){
    const start=group===0?0:25,count=group===0?25:21;
    const index=start+((this.positions[group]-start+delta)%count+count)%count;
    this.observe(index);return index;
  }
}
if(typeof module!=='undefined')module.exports={DialWheel,SplitDialState};
