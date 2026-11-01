'use strict';
class KanaSpeaker {
  constructor(synth, Utterance, onChange=()=>{}, timers={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)}) {
    this.synth=synth;this.Utterance=Utterance;this.onChange=onChange;this.timers=timers;
    this.enabled=true;this.activated=false;this.current='';this.ready=false;
    this.utterance=null;this.selectionTimer=null;this.lastError='';
    this.message='「音声テスト」で音を確認できます';
  }
  clearSelection(){
    if(this.selectionTimer!==null)this.timers.clearTimeout(this.selectionTimer);
    this.selectionTimer=null;
  }
  stop(){this.clearSelection();this.utterance=null;this.synth?.cancel();}
  observe(state){
    const changed=this.current!==state.selected,wasReady=this.ready;
    this.current=state.selected||'';this.ready=!!(state.connected&&state.ready);
    if(!this.ready){if(wasReady)this.stop();return;}
    if(!wasReady){this.speak();return;}
    if(changed){
      // The cursor stays immediate; speech waits briefly for the selected
      // letter to settle so fast turns do not cancel every utterance at start.
      this.clearSelection();
      if(this.enabled&&this.activated)this.selectionTimer=this.timers.setTimeout(()=>{this.selectionTimer=null;this.speak();},100);
    }
  }
  activate(){
    if(this.activated)return;
    this.activated=true;this.enabled=true;
    // Call speak while still inside the click event, before the BLE chooser.
    this.say('読み上げを開始します',false,false);
  }
  toggle(){
    if(!this.activated||this.lastError){this.activated=true;this.enabled=true;}
    else this.enabled=!this.enabled;
    if(this.enabled)this.say(this.current||'読み上げを開始します',!!this.current,false);
    else{this.stop();this.message='読み上げ OFF';this.onChange();}
  }
  test(){this.activated=true;this.enabled=true;this.say('あいうえお',false,false,true);}
  speak(){this.say(this.current,true);}
  confirm(character){this.say(character,true);}
  read(text){this.say(text||'入力された文字はありません',false);}
  say(text,character,requireReady=true,test=false){
    if(!this.synth||!this.Utterance||!this.enabled||!this.activated||(requireReady&&!this.ready)||!text)return;
    this.stop();this.lastError='';this.message='音声を準備しています…';
    const spoken=character?text.replace(/[ぁ-ゖ]/g,c=>String.fromCharCode(c.charCodeAt(0)+0x60)):text;
    let utterance;
    const fail=error=>{
      if(this.utterance!==utterance)return;
      if(error==='canceled'||error==='interrupted')return;
      this.lastError=error;
      const reason={
        'not-allowed':'音声の開始が許可されませんでした。「音声テスト」を押してください',
        'audio-busy':'音声出力が使用中です。もう一度「音声テスト」を押してください',
        'audio-hardware':'音声出力先を確認してください',
        'voice-unavailable':'日本語の音声を利用できません。音声設定を確認してください',
        'language-unavailable':'日本語の音声を利用できません。音声設定を確認してください',
        'synthesis-unavailable':'このブラウザで音声合成を開始できませんでした'
      }[error];
      this.message=reason||`読み上げを開始できませんでした（${error}）。「音声テスト」で再試行できます`;
      this.onChange();
    };
    try{
      utterance=new this.Utterance(spoken);this.utterance=utterance;
      utterance.lang='ja-JP';utterance.rate=1.15;
      const voices=this.synth.getVoices().filter(v=>/^ja(?:-|_)/i.test(v.lang));
      utterance.voice=voices.find(v=>v.localService)||voices[0]||null;
      utterance.onstart=()=>{if(this.utterance===utterance){this.message=test?'音声テストを再生中':'読み上げ中';this.onChange();}};
      utterance.onend=()=>{if(this.utterance===utterance){this.message=test?'音声テスト完了 · あいうえお':'読み上げ ON';this.onChange();}};
      utterance.onerror=e=>fail(e.error||'unknown');
      this.synth.resume();this.synth.speak(utterance);this.onChange();
    }catch(e){fail(e.name||'synthesis-unavailable');}
  }
}
if(typeof module!=='undefined')module.exports={KanaSpeaker};
