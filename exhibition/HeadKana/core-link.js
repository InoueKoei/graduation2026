'use strict';
// A dedicated CoreS3 connection; the dial's BLE/USB session stays independent.
class CoreSensorLink {
  constructor(onSample,onState){this.onSample=onSample;this.onState=onState;this.device=null;this.notification=null;this.port=null;this.reader=null;this.connected=false;this.kind='';this.busy=false;this.lastAt=0;}
  state(message){if(message!==undefined)this.message=message;this.onState({connected:this.connected,busy:this.busy,kind:this.kind,message:this.message||''});}
  accept(sample){if(sample?.type==='sensor'&&sample.protocol===2){this.lastAt=performance.now();this.onSample(sample);}}
  async disconnect(){
    const port=this.port,reader=this.reader;this.port=null;this.reader=null;
    try{await reader?.cancel();}catch{}try{reader?.releaseLock();}catch{}try{await port?.close();}catch{}
    if(this.notification&&this.receive)this.notification.removeEventListener('characteristicvaluechanged',this.receive);
    this.notification=null;
    if(this.device){this.device.removeEventListener('gattserverdisconnected',this.onDisconnect);if(this.device.gatt.connected)this.device.gatt.disconnect();}
    this.device=null;this.connected=false;this.kind='';this.state('');
  }
  async connectBLE(){
    if(this.connected){await this.disconnect();return;}
    this.busy=true;this.state('CoreS3を選んでください');
    try{
      const device=await navigator.bluetooth.requestDevice({filters:[{name:'M5-Kana'}],optionalServices:['9f6c0001-4b68-4b3a-9c87-df6f1da60001']});
      this.device=device;this.onDisconnect=()=>{if(this.device===device)void this.disconnect();};device.addEventListener('gattserverdisconnected',this.onDisconnect);
      const server=await device.gatt.connect(),service=await server.getPrimaryService('9f6c0001-4b68-4b3a-9c87-df6f1da60001');
      const snapshot=await service.getCharacteristic('9f6c0003-4b68-4b3a-9c87-df6f1da60001');
      const sample=JSON.parse(new TextDecoder().decode(await snapshot.readValue()));
      if(sample.protocol!==2)throw new Error('CoreS3のセンサー版ファームウェアが必要です');
      this.notification=await service.getCharacteristic('9f6c0002-4b68-4b3a-9c87-df6f1da60001');
      this.receive=e=>{const v=e.target.value;this.accept(decodeSensorPacket(new Uint8Array(v.buffer,v.byteOffset,v.byteLength)));};
      this.notification.addEventListener('characteristicvaluechanged',this.receive);
      await this.notification.startNotifications();this.kind='BLE';this.connected=true;this.message='';this.lastAt=performance.now();this.accept(sample);
    }catch(error){await this.disconnect();this.state(error.name==='NotFoundError'?'接続をキャンセルしました':`CoreS3に接続できませんでした：${error.message}`);return;}
    finally{this.busy=false;this.state();}
  }
  async connectUSB(){
    if(this.connected){await this.disconnect();return;}
    this.busy=true;this.state('USB接続中のCoreS3を選んでください');
    let port;
    try{
      port=await navigator.serial.requestPort({filters:[{usbVendorId:0x303A,usbProductId:0x1001}]});
      await port.open({baudRate:115200});this.port=port;this.kind='USB';this.connected=true;this.message='';this.lastAt=performance.now();
      void this.readUSB(port);
    }catch(error){try{await port?.close();}catch{}await this.disconnect();this.state(error.name==='NotFoundError'?'接続をキャンセルしました':`CoreS3のUSB接続に失敗しました：${error.message}`);return;}
    finally{this.busy=false;this.state();}
  }
  async readUSB(port){
    const reader=port.readable.getReader();this.reader=reader;
    const decoder=new TextDecoder();let buffer='';
    try{
      while(this.port===port){
        const {value,done}=await reader.read();if(done)break;
        buffer+=decoder.decode(value,{stream:true});if(buffer.length>8192)buffer=buffer.slice(-2048);
        const lines=buffer.split(/\r?\n/);buffer=lines.pop();
        for(const line of lines)try{if(line.startsWith('{'))this.accept(JSON.parse(line));}catch{}
      }
    }catch(error){if(this.port===port)this.state(`CoreS3 USB受信：${error.message}`);}
    finally{
      try{reader.releaseLock();}catch{}
      if(this.reader===reader)this.reader=null;
      if(this.port===port){this.port=null;try{await port.close();}catch{}this.connected=false;this.kind='';this.state('CoreS3のUSB接続が終了しました');}
    }
  }
}
if(typeof module!=='undefined')module.exports={CoreSensorLink};
