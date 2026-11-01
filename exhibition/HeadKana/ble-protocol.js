'use strict';
// Notifications fit the default BLE ATT MTU: [frame, index, count, ...17 bytes].
class BleFrameDecoder {
  constructor() { this.reset(); }
  reset() { this.frame = -1; this.count = 0; this.parts = []; }
  push(bytes) {
    if (bytes.length < 4 || bytes.length > 20) { this.reset(); return null; }
    const [frame, index, count] = bytes;
    if (!count || count > 32 || index >= count) { this.reset(); return null; }
    if (index === 0) { this.reset(); this.frame = frame; this.count = count; }
    if (frame !== this.frame || count !== this.count || index !== this.parts.length) {
      this.reset(); return null;
    }
    this.parts.push(bytes.slice(3));
    if (this.parts.length !== this.count) return null;
    const length = this.parts.reduce((total, part) => total + part.length, 0);
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const part of this.parts) { joined.set(part, offset); offset += part.length; }
    this.reset();
    try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(joined)); }
    catch { return null; }
  }
}
if (typeof module !== 'undefined') module.exports = {BleFrameDecoder};

// Protocol 2: complete sensor sample in one ATT notification.
function decodeSensorPacket(bytes) {
  if(bytes.length!==20 || bytes[0]!==0xA5 || (bytes[1]&0xF0))return null;
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),flags=bytes[1];
  return {type:'sensor',protocol:2,seq:v.getUint16(2,true),t:v.getUint32(4,true),
    ready:!!(flags&1),imu:!!(flags&2),red:!!(flags&4),blue:!!(flags&8),
    accel:[8,10,12].map(i=>v.getInt16(i,true)/1000),gyro:[14,16,18].map(i=>v.getInt16(i,true)/100)};
}
function decodeDialPacket(bytes) {
  if(![5,8].includes(bytes.length)||bytes[0]!==0xD3||(bytes[1]&0xF0)||bytes[2]>=46)return null;
  const flags=bytes[1];
  const result={type:'dial',protocol:3,ready:!!(flags&1),confirm:!!(flags&2),erase:!!(flags&4),pressed:!!(flags&8),selected:bytes[2],seq:bytes[3]|(bytes[4]<<8)};
  if(bytes.length===8){
    if(bytes[5]>=25||bytes[6]<25||bytes[6]>=46||bytes[7]>3)return null;
    result.positions=[bytes[5],bytes[6]];result.pressedMask=bytes[7];
  }
  return result;
}
class DialSerialDecoder {
  constructor(){this.reset();}
  reset(){this.buffer='';}
  push(chunk){
    this.buffer+=String(chunk);
    if(this.buffer.length>4096)this.buffer=this.buffer.slice(-1024);
    const lines=this.buffer.split(/\r?\n/);this.buffer=lines.pop();
    const messages=[];
    for(const line of lines){
      const type=/^@T,(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)$/.exec(line.trim());
      if(type){
        const [flags,selected,seq,fontCounter,sizeRaw,weightRaw,fontPressed]=type.slice(1).map(Number);
        if(flags<=31&&selected<46&&seq<=65535&&fontCounter<=65535&&sizeRaw<=4095&&weightRaw<=4095&&fontPressed<=1)
          messages.push({type:'dial',protocol:5,pattern:'type-lcd',ready:!!(flags&1),confirm:!!(flags&2),erase:!!(flags&4),pressed:!!(flags&8),fontConfirm:!!(flags&16),selected,seq,fontCounter,sizeRaw,weightRaw,fontPressed:!!fontPressed});
        continue;
      }
      const single=/^@S,(\d+),(\d+),(\d+)$/.exec(line.trim());
      if(single){
        const flags=Number(single[1]),selected=Number(single[2]),seq=Number(single[3]);
        if(flags<=15&&selected<46&&seq<=65535)messages.push({type:'dial',protocol:4,pattern:'single-lcd',ready:!!(flags&1),confirm:!!(flags&2),erase:!!(flags&4),pressed:!!(flags&8),selected,seq});
        continue;
      }
      const match=/^@D,(\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?$/.exec(line.trim());
      if(!match)continue;
      const flags=Number(match[1]),selected=Number(match[2]),seq=Number(match[3]);
      if(flags>15||selected>=46||seq>65535)continue;
      const bytes=[0xD3,flags,selected,seq&255,seq>>8];
      if(match[4]!==undefined){
        const extras=match.slice(4).map(Number);
        if(extras.some(n=>n>255))continue;
        bytes.push(...extras);
      }
      const state=decodeDialPacket(Uint8Array.from(bytes));
      if(state)messages.push(state);
    }
    return messages;
  }
}
if(typeof module!=='undefined')Object.assign(module.exports,{decodeSensorPacket,decodeDialPacket,DialSerialDecoder});
