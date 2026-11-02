'use strict';
class LetterRotation {
  constructor(startedAt=Date.now(),duration=6000){this.startedAt=startedAt;this.duration=duration;}
  angle(now=Date.now()){return (((now-this.startedAt)%this.duration+this.duration)%this.duration)*360/this.duration;}
  live(){return {rotationStartedAt:this.startedAt,rotationDuration:this.duration};}
}
function rotationStyle(run,now=Date.now()){
  const base={display:'inline-block',transformOrigin:'50% 50%',whiteSpace:'pre'};
  if(run.pending&&Number.isFinite(run.rotationStartedAt)){
    const duration=run.rotationDuration||6000,phase=((now-run.rotationStartedAt)%duration+duration)%duration;
    return {...base,animation:`headkana-spin ${duration}ms linear infinite`,animationDelay:`${-phase}ms`,transform:'rotate(0deg)'};
  }
  return {...base,animation:'none',animationDelay:'0ms',transform:`rotate(${Number.isFinite(run.rotationDeg)?run.rotationDeg:0}deg)`};
}
if(typeof module!=='undefined')module.exports={LetterRotation,rotationStyle};

// Locate the centre of the painted glyph, excluding the line box and descender space.
function glyphBodyOrigin(metrics,baseline,width,height){
  const x=(metrics.actualBoundingBoxRight-metrics.actualBoundingBoxLeft)/2;
  const y=baseline+(metrics.actualBoundingBoxDescent-metrics.actualBoundingBoxAscent)/2;
  return {x:Number.isFinite(x)?x:width/2,y:Number.isFinite(y)?y:height/2};
}
let rotationMeasureCanvas;
function centerRotationBody(element){
  if(!element?.isConnected)return;
  const text=element.textContent;
  element.style.position='relative';
  let marker=element.querySelector('.rotation-baseline');
  if(!marker){
    marker=document.createElement('span');marker.className='rotation-baseline';marker.setAttribute('aria-hidden','true');
    marker.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline;';element.append(marker);
  }
  rotationMeasureCanvas??=document.createElement('canvas');
  const context=rotationMeasureCanvas.getContext('2d'),style=getComputedStyle(element);
  context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const origin=glyphBodyOrigin(context.measureText(text),marker.offsetTop,element.offsetWidth,element.offsetHeight);
  element.style.transformOrigin=`${origin.x}px ${origin.y}px`;
  const metrics=context.measureText(text);
  return {...origin,width:Math.max(1,metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight||metrics.width),height:Math.max(1,metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent||parseFloat(style.fontSize))};
}
function centerRotationBodies(elements){for(const element of elements)centerRotationBody(element);}
if(typeof module!=='undefined')Object.assign(module.exports,{glyphBodyOrigin});

function rotationFootprint(width,height,angle=0,moving=false){
  if(moving){const side=Math.hypot(width,height);return {width:side,height:side};}
  const radians=angle*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));
  return {width:width*c+height*s,height:width*s+height*c};
}
if(typeof module!=='undefined')Object.assign(module.exports,{rotationFootprint});
