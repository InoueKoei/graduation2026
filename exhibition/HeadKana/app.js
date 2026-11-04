'use strict';
const $=id=>document.getElementById(id);
const selected=$('selected'),text=$('text'),status=$('status'),statusLabel=$('status-label'),hint=$('hint'),count=$('count'),copy=$('copy');
const bleButton=$('ble-connect'),usbButton=$('usb-connect'),speechButton=$('speech-toggle');
const speechAvailable=!!window.speechSynthesis&&!!window.SpeechSynthesisUtterance;
const speaker=new KanaSpeaker(window.speechSynthesis,window.SpeechSynthesisUtterance,()=>{
  speechButton.textContent=!speechAvailable?'読み上げ非対応':speaker.lastError?'読み上げを再開':!speaker.activated?'読み上げを開始':speaker.enabled?'読み上げ ON':'読み上げ OFF';
  speechButton.setAttribute('aria-pressed',String(speaker.activated&&speaker.enabled&&!speaker.lastError));
  $('speech-status').textContent=speaker.message;
});
speechButton.disabled=!speechAvailable;$('speech-test').disabled=!speechAvailable;
speechButton.addEventListener('click',()=>speaker.toggle());
$('speech-test').addEventListener('click',()=>speaker.test());
$('speech-status').textContent=speechAvailable?'「音声テスト」で音を確認できます':'このブラウザは読み上げに対応していません';
if(!speechAvailable)speechButton.textContent='読み上げ非対応';
const SERVICE='9f6c0001-4b68-4b3a-9c87-df6f1da60001',NOTIFY='9f6c0002-4b68-4b3a-9c87-df6f1da60001',SNAPSHOT='9f6c0003-4b68-4b3a-9c87-df6f1da60001',SELECTION='9f6c0004-4b68-4b3a-9c87-df6f1da60001';
const decoder=new BleFrameDecoder(),usbDecoder=new DialSerialDecoder(),doc=new KanaDocument();
const lcdGlyphs=new LcdGlyphSender(data=>writeUSB(data));
let device=null,notification=null,selectionCharacteristic=null,selectionToSend=HOME_INDEX,selectionSent=-1,selectionSending=false,connected=false,ready=false,demo=false,lastSampleAt=0,lastTelemetryAt=0,lastEventId=0,legacy=false,deviceMode='dial',transport='none',serialPort=null,serialReader=null;
const RANGE_KEY='headkana-motion-range';
function savedRange(){
  try{const v=Number(localStorage.getItem(RANGE_KEY));return Number.isFinite(v)&&v>=60&&v<=360?Math.round(v/10)*10:120;}catch{return 120;}
}
const engine=new GestureInput(act,{range:savedRange()});
const dialState=new SplitDialState();
const dialWheels=[new DialWheel($('dial-rotor-0'),KANA.slice(0,25)),new DialWheel($('dial-rotor-1'),KANA.slice(25))];
const PATTERN_KEY='headkana-dial-pattern';
let savedPattern='auto';try{savedPattern=localStorage.getItem(PATTERN_KEY)||'auto';}catch{}
const dialPattern=new DialPatternState(savedPattern);
const typeControls=new TypeDialControls();
$('dial-pattern').value=dialPattern.choice;
$('dial-pattern').addEventListener('change',e=>{
  dialPattern.choose(e.target.value);try{localStorage.setItem(PATTERN_KEY,dialPattern.choice);}catch{}
  if(dialPattern.studio)applyTypeStyle();render();updateConnection();
});
const fontCatalog=new DialFontCatalog(),DIAL_OPTIONS_KEY='headkana-right-dial';
function savedDialOptions(){
  try{
    const o=JSON.parse(localStorage.getItem(DIAL_OPTIONS_KEY));if(!o)return {};
    const symbols=Array.isArray(o.symbols)?o.symbols.filter(s=>typeof s==='string'&&s.length&&Array.from(s).length<=16).slice(0,48):[];
    return {mode:o.mode,weights:parseDialNumbers(o.weights.join(','),100,900),sizes:parseDialNumbers(o.sizes.join(','),12,200),
      symbols:symbols.length?symbols:DEFAULT_DIAL_OPTIONS.symbols,
      fontIds:Array.isArray(o.fontIds)&&o.fontIds.length?o.fontIds:DEFAULT_DIAL_OPTIONS.fontIds};
  }catch{return {};}
}
const dialAssignments=new DialAssignments(fontCatalog.fonts,savedDialOptions());
let wheelSignature='',fontPreviewToken=0;
const rotationClock=new LetterRotation(),ROTATE_INPUT_KEY='headkana-rotate-input';
// When off, the letter being chosen stands still and is entered upright.
let rotateInput=true;try{rotateInput=localStorage.getItem(ROTATE_INPUT_KEY)!=='0';}catch{}
function rotatedRunStyle(run){return {...runStyle(run),...rotationStyle(run)};}
function inputStyle(){return {...committedStyle(),rotationDeg:rotateInput?rotationClock.angle():0};}
let candidateVisible=true,candidateSignature='';
function candidateRun(){
  const index=deviceMode==='dial'?(dialPattern.full?dialPattern.selected:dialAssignments.mode==='split'?dialState.positions[0]:dialAssignments.leftIndex):doc.selected;
  return {text:KANA[index],...committedStyle(),...(rotateInput?rotationClock.live():{rotationDeg:0}),size:1,pending:true};
}
function updateCandidatePreview(){
  const signature=JSON.stringify(candidateRun());
  if(signature!==candidateSignature){candidateSignature=signature;candidateVisible=true;}
}
function hideCandidatePreview(){candidateSignature=JSON.stringify(candidateRun());candidateVisible=false;}
function outputRuns(){return candidateVisible?[...doc.composition,candidateRun()]:doc.composition;}

const textOutput=new TextOutputPublisher(outputRuns,async (runs,sent)=>{
  const result=[];
  for(const font of fontCatalog.fonts.filter(f=>f.faces&&runs.some(r=>r.fontFamily===f.family))){
    for(const weight of new Set(runs.filter(r=>r.fontFamily===font.family).map(r=>r.fontWeight||400))){
      const face=fontCatalog.face(font,weight),faceWeight=fontWeightFromName(face.style+' '+face.postscriptName);
      if(sent.has(font.family+':'+faceWeight))continue;
      result.push({family:font.family,weight:faceWeight,data:await fontCatalog.fontData(face)});
    }
  }
  return result;
});
const OUTPUT_INVERT_KEY='headkana-output-invert';
$('rotate-input').checked=rotateInput;
$('rotate-input').addEventListener('change',e=>{rotateInput=e.target.checked;try{localStorage.setItem(ROTATE_INPUT_KEY,rotateInput?'1':'0');}catch{}render();});
function updateOutputLink(){$('open-output').href='output.html?source='+encodeURIComponent(textOutput.id)+($('output-invert').checked?'&invert=1':'');}
try{$('output-invert').checked=localStorage.getItem(OUTPUT_INVERT_KEY)==='1';}catch{}
$('output-invert').addEventListener('change',e=>{try{localStorage.setItem(OUTPUT_INVERT_KEY,e.target.checked?'1':'0');}catch{}updateOutputLink();});
updateOutputLink();

function saveDialOptions(){try{localStorage.setItem(DIAL_OPTIONS_KEY,JSON.stringify({...dialAssignments.options,mode:dialAssignments.mode}));}catch{}}
function committedStyle(){const s=dialAssignments.style,f=dialAssignments.font();return {fontFamily:f.family,fontLabel:f.label,fontWeight:s.fontWeight,fontSize:s.fontSize};}
function typeFonts(){const f=fontCatalog.fonts.filter(f=>dialAssignments.options.fontIds.includes(f.id));return f.length?f:[fontCatalog.fonts[0]];}
function applyTypeStyle(){
  // Each confirmed run owns its style; controls only change the pending selection.
  dialAssignments.style=typeControls.style(typeFonts());
}
function renderTypeControls(){
  const style=committedStyle();$('type-preview').hidden=false;
  $('type-preview-letter').textContent=KANA[dialPattern.selected];
  Object.assign($('type-preview-letter').style,rotatedRunStyle({...candidateRun(),...style,size:1}));
  $('type-preview-label').textContent=`${style.fontLabel} / ${style.fontWeight} / ${style.fontSize}px`;
  $('type-current').textContent='選択中の文字へ即反映 · 入力済みの文字は入力時の見た目を保持';
  $('size-readout').textContent=style.fontSize+'px';$('weight-readout').textContent=style.fontWeight;
  $('type-size').value=typeControls.sizeRaw;$('type-weight').value=typeControls.weightRaw;
  $('type-size').disabled=$('type-weight').disabled=connected&&!demo;
  void fontCatalog.load(dialAssignments.style.fontId,style.fontWeight).then(refreshRotationBodies).catch(()=>{$('type-current').textContent='書体の読み込みに失敗しました';});
}
const SIZE_RANGE_KEY='headkana-size-range';
try{const r=JSON.parse(localStorage.getItem(SIZE_RANGE_KEY));if(Number.isInteger(r?.min)&&Number.isInteger(r?.max)&&r.min>=4&&r.max<=2000&&r.min<r.max){typeControls.sizeMin=r.min;typeControls.sizeMax=r.max;}}catch{}
function showSizeRange(){
  $('size-min').value=typeControls.sizeMin;$('size-max').value=typeControls.sizeMax;
  const {sizeMin:min,sizeMax:max}=typeControls;$('size-range-hint').textContent=`${min}〜${max}px（中央で約${Math.round(min+(max-min)*0.75)}px）`;
}
showSizeRange();
// Smallest and largest size the slider reaches; the two never cross.
for(const id of ['size-min','size-max'])$(id).addEventListener('change',()=>{
  let min=Math.round(Number($('size-min').value))||typeControls.sizeMin,max=Math.round(Number($('size-max').value))||typeControls.sizeMax;
  min=Math.min(1999,Math.max(4,min));max=Math.min(2000,Math.max(5,max));
  if(min>=max){if(id==='size-min')max=Math.min(2000,min+1);else min=Math.max(4,max-1);}
  typeControls.sizeMin=min;typeControls.sizeMax=max;try{localStorage.setItem(SIZE_RANGE_KEY,JSON.stringify({min,max}));}catch{}
  showSizeRange();applyTypeStyle();render();
});
for(const [id,key] of [['type-size','sizeRaw'],['type-weight','weightRaw']])$(id).addEventListener('input',e=>{typeControls[key]=Number(e.target.value);applyTypeStyle();render();});
function renderFontOptions(){
  $('dial-font-options').replaceChildren(...fontCatalog.fonts.map(font=>{
    const label=document.createElement('label'),input=document.createElement('input'),name=document.createElement('span');
    input.type='checkbox';input.value=font.id;input.checked=dialAssignments.options.fontIds.includes(font.id);name.textContent=font.label;
    label.append(input,name);return label;
  }));
}
function setupDialControls(){
  $('right-role').value=dialAssignments.mode;
  $('dial-weights').value=dialAssignments.options.weights.join(',');$('dial-sizes').value=dialAssignments.options.sizes.join(',');
  $('dial-symbols').value=dialAssignments.options.symbols.map(s=>s===' '?'␣':s).join('\n');renderFontOptions();
}
function updateCustomWheels(){
  const studio=dialPattern.studio,single=dialPattern.single,custom=!single&&(studio||dialAssignments.mode!=='split'),choices=studio?typeFonts().map(f=>({label:f.label})):dialAssignments.choices();
  const left=single||custom?KANA:KANA.slice(0,25),right=single?['—']:custom?choices.map((c,i)=>studio||dialAssignments.mode==='font'?String(i+1):c.label):KANA.slice(25);
  const signature=JSON.stringify([left,right]);if(signature!==wheelSignature){dialWheels[0].setCharacters(left);dialWheels[1].setCharacters(right.length?right:['—']);wheelSignature=signature;}
  $('dial-title-0').textContent=single?'丸型LCD · あ〜ん・46文字':custom?'あ〜ん・46文字':'あ・か・さ・た・な行';
  $('dial-title-1').textContent=studio?'フォント':custom?DIAL_ROLES[dialAssignments.mode]:'は・ま・や・ら・わ行＋ん';
  $('dial-panel-0').setAttribute('aria-label',single?'1ダイヤルと丸型LCD あ〜んの文字入力':custom?'1個目 あ〜んの文字入力':'1個目 あ・か・さ・た・な行');
  $('dial-panel-1').setAttribute('aria-label',studio?'2個目 フォント':custom?`2個目 ${DIAL_ROLES[dialAssignments.mode]}`:'2個目 は・ま・や・ら・わ行とん');
  $('dial-panel-1').classList.toggle('control-dial',custom);
  $('dial-panel-0').classList.toggle('full-kana',single||custom);
  const rightConfirm=document.querySelector('[data-action="confirm"][data-dial="1"]');
  rightConfirm.textContent=studio?'再適用':custom&&dialAssignments.mode!=='symbols'?'確定':'入力';
  rightConfirm.setAttribute('aria-label',studio?'フォント設定を再適用':custom&&dialAssignments.mode!=='symbols'?'右の設定を確定':'右の文字を入力');
}
function renderTypePreview(){
  if(dialPattern.studio){renderTypeControls();return;}
  const custom=deviceMode==='dial'&&!dialPattern.single&&dialAssignments.mode!=='split';$('type-preview').hidden=!custom;
  if(!custom)return;
  const draft=dialAssignments.draft(),font=dialAssignments.font(draft.fontId),choice=dialAssignments.choices()[dialAssignments.rightIndex];
  const letter=$('type-preview-letter');letter.textContent=dialAssignments.mode==='symbols'?choice?.value||' ':KANA[dialAssignments.leftIndex];
  Object.assign(letter.style,runStyle({...draft,fontFamily:font.family,size:1}));
  $('type-preview-label').textContent=`プレビュー · ${font.label} / ${draft.fontWeight} / ${draft.fontSize}px · 右KEYで確定`;
  const current=committedStyle();$('type-current').textContent=`適用中：${current.fontLabel} / ${current.fontWeight} / ${current.fontSize}px`;
  const token=++fontPreviewToken;
  void fontCatalog.load(draft.fontId,draft.fontWeight).then(refreshRotationBodies).catch(()=>{if(token===fontPreviewToken)$('type-preview-label').textContent='この書体を読み込めませんでした。別の書体を選んでください';});
}
// Pushing the font knob jumps to another dial candidate at random.
function randomFont(){
  const count=typeFonts().length;if(count<2)return;
  const current=((typeControls.fontIndex%count)+count)%count;
  typeControls.fontIndex=(current+1+Math.floor(Math.random()*(count-1)))%count;
  applyTypeStyle();render();
}
function confirmDial(group){
  if(dialPattern.studio){if(group===0)act({type:'confirm',selectionIndex:dialPattern.selected});else randomFont();return;}
  if(dialPattern.single){if(group===0)act({type:'confirm',selectionIndex:dialPattern.selected});return;}
  if(dialAssignments.mode==='split'){act({type:'confirm',selectionIndex:dialState.positions[group]});return;}
  if(group===0){act({type:'confirm',selectionIndex:dialAssignments.leftIndex});return;}
  if(dialAssignments.mode==='symbols'){
    const value=dialAssignments.choices()[dialAssignments.rightIndex]?.value||'';
    if(!doc.confirmText(value,inputStyle())){log('96文字まで入力できます');return;}
    render();log(`右KEY：「${value===' '?'空白':value}」を入力`);speaker.confirm(value);return;
  }
  const style=dialAssignments.commit(),applied=committedStyle();
  render();saveDialOptions();log(`右KEY：${DIAL_ROLES[dialAssignments.mode]}を確定 · ${applied.fontLabel} / ${style.fontWeight} / ${style.fontSize}px`);
}
$('right-role').addEventListener('change',e=>{
  const wasSplit=dialAssignments.mode==='split';
  dialAssignments.setMode(e.target.value);if(wasSplit)dialAssignments.leftIndex=dialState.positions[0];
  dialAssignments.previous=dialState.positions.slice();saveDialOptions();render();
});
$('save-dial-options').addEventListener('click',()=>{
  try{
    const weights=parseDialNumbers($('dial-weights').value,100,900),sizes=parseDialNumbers($('dial-sizes').value,12,200);
    const symbols=$('dial-symbols').value.split('\n').filter(s=>s.length).map(s=>s==='␣'?' ':s);
    if(!symbols.length||symbols.length>48||symbols.some(s=>Array.from(s).length>16))throw Error('文字・記号は1〜48候補、各16文字以内にしてください');
    const fontIds=[...document.querySelectorAll('#dial-font-options input:checked')].map(input=>input.value);
    if(!fontIds.length)throw Error('フォントを1つ以上選んでください');
    dialAssignments.options={weights,sizes,symbols,fontIds};dialAssignments.alignChoice();saveDialOptions();render();
    fontCatalog.extraText=symbols.join('');preloadDialFonts();
    $('dial-options-feedback').textContent='右ダイヤルの候補を保存しました';
  }catch(error){$('dial-options-feedback').textContent=error.message;}
});
fontCatalog.extraText=dialAssignments.options.symbols.join('');
function preloadDialFonts(){void fontCatalog.preload(dialAssignments.options.fontIds,dialAssignments.style.fontWeight);}
// The button adds every Moji-stack face to the dial; the automatic read on a later visit keeps the saved choice.
async function readLocalFonts(addToDial){
  $('read-local-fonts').disabled=true;
  try{
    const count=await fontCatalog.readLocalFonts();dialAssignments.fonts=fontCatalog.fonts;
    if(addToDial)for(const font of fontCatalog.fonts.filter(f=>f.faces))if(!dialAssignments.options.fontIds.includes(font.id))dialAssignments.options.fontIds.push(font.id);
    renderFontOptions();dialAssignments.alignChoice();render();if(addToDial)saveDialOptions();
    $('font-load-status').textContent=count?`Moji-stackの書体が${count}種類使えます。下で候補を選んでください`:'Moji-stackの書体は見つかりませんでした。標準書体とゼン丸ゴシックを使えます';
    preloadDialFonts();
  }catch(error){$('font-load-status').textContent=error.name==='NotAllowedError'?'フォントの読み込みは許可されませんでした。標準書体を使えます':error.message;}
  finally{$('read-local-fonts').disabled=false;}
}
$('read-local-fonts').addEventListener('click',()=>readLocalFonts(true));
// Once Chrome has allowed local fonts, read them on every visit so the dial is ready without a click.
navigator.permissions?.query({name:'local-fonts'}).then(status=>{if(status.state==='granted')void readLocalFonts(false);}).catch(()=>{});
setupDialControls();
void fontCatalog.readBakedFonts().then(count=>{
  if(!count)return;dialAssignments.fonts=fontCatalog.fonts;
  // First run on a fresh machine (the Pi): put the baked faces on the dial without a trip to the settings.
  let saved=true;try{saved=!!localStorage.getItem(DIAL_OPTIONS_KEY);}catch{}
  if(!saved)for(const font of fontCatalog.fonts.filter(f=>f.baked))if(!dialAssignments.options.fontIds.includes(font.id))dialAssignments.options.fontIds.push(font.id);
  renderFontOptions();dialAssignments.alignChoice();render();
}).catch(()=>{});
let coreTarget=null,coreReady=false;
const coreCycle=new KanaModifierCycle(),NOD_ROLE_KEY='headkana-nod-role';
// A nod either enters the kana being chosen (default) or cycles 濁点 → 半濁点 → 小文字 on the last one.
let nodRole='confirm';try{if(localStorage.getItem(NOD_ROLE_KEY)==='modifier')nodRole='modifier';}catch{}
const NOD_ROLE_HINTS={confirm:'頷くと、選択中の文字を入力します。',modifier:'頷くたびに即反映。濁点 → 半濁点 → 小文字の順で切り替わります。'};
$('nod-role').value=nodRole;$('modifier-feedback').textContent=NOD_ROLE_HINTS[nodRole];
$('nod-role').addEventListener('change',e=>{
  nodRole=e.target.value==='modifier'?'modifier':'confirm';try{localStorage.setItem(NOD_ROLE_KEY,nodRole);}catch{}
  coreTarget=null;coreCycle.reset();$('nod-progress').textContent='—';$('modifier-feedback').textContent=NOD_ROLE_HINTS[nodRole];
});
function nodConfirm(){
  const before=doc.composition.length;
  if(deviceMode==='dial')confirmDial(0);else act({type:'confirm'});
  const added=doc.composition.length>before?doc.composition.at(-1).text:'';
  $('nod-progress').textContent=added?`入力 · ${added}`:'—';
  $('modifier-feedback').textContent=added?`頷きで「${added}」を入力しました`:'入力できませんでした（96文字まで）';
}
function coreAction(event){
  if(event.type==='reset'){coreTarget=null;coreCycle.reset();$('nod-progress').textContent='—';return;}
  if(event.type==='begin'){coreTarget=doc.composition.at(-1)||null;$('nod-progress').textContent='検出中';return;}
  if(event.type==='cancel'){$('nod-progress').textContent='—';coreTarget=null;return;}
  if(event.type==='nod'){
    if(nodRole==='confirm')nodConfirm();else applyHeadNod(coreTarget);
    coreTarget=null;
  }
}
const headModifier=new HeadModifierInput(coreAction);
const coreLink=new CoreSensorLink(acceptCoreSensor,updateCoreLinkState);
function applyHeadNod(target){
  const result=coreCycle.apply(doc,target),count=result.count,name=MODIFIER_NAMES[count-1];
  $('nod-progress').textContent=count?`${count}回目 · ${name}`:'—';
  const message=result.reason==='target-missing'?'まずダイヤルで文字を入力してください':result.reason==='unsupported'?`「${result.from}」は${name}に対応していません`:`${count}回 · ${name}：「${result.from}」→「${result.to}」`;
  $('modifier-feedback').textContent=message;log(message);render();
  if(result.changed)speaker.confirm(result.to);
}
function updateCoreLinkState(state){
  $('core-ble-connect').disabled=state.busy||!navigator.bluetooth;
  $('core-usb-connect').disabled=state.busy||!navigator.serial;
  $('core-ble-connect').textContent=state.connected&&state.kind==='BLE'?'CoreS3を切断':'CoreS3 BLEで接続';
  $('core-usb-connect').textContent=state.connected&&state.kind==='USB'?'CoreS3を切断':'CoreS3 USBで接続';
  if(state.connected){$('core-ble-connect').disabled=state.kind!=='BLE';$('core-usb-connect').disabled=state.kind!=='USB';}
  $('core-status').textContent=state.busy?'接続中…':state.connected?`${state.kind} · ${coreReady?'準備OK':'正面で静止してください'}`:'未接続';
  $('core-recenter').disabled=!state.connected;
  if(state.message)$('modifier-feedback').textContent=state.message;
  if(!state.connected&&!state.busy){coreReady=false;headModifier.recenter();}
}
function acceptCoreSensor(sample){
  if(demo)return;
  const metrics=headModifier.feed(sample);if(!metrics)return;
  coreReady=!metrics.calibrating;
  $('core-status').textContent=`${coreLink.kind||'BLE'} · ${coreReady?'準備OK':'正面で静止してください'}`;
  $('core-pitch').textContent=`${(metrics.pitch||0).toFixed(1)}°`;
}
$('core-ble-connect').addEventListener('click',()=>coreLink.connectBLE());
$('core-usb-connect').addEventListener('click',()=>coreLink.connectUSB());
$('core-recenter').addEventListener('click',()=>{headModifier.recenter();coreReady=false;$('core-status').textContent='正面で約0.5秒静止してください';});
$('nod-test').addEventListener('click',()=>{if(nodRole==='confirm')nodConfirm();else applyHeadNod(doc.composition.at(-1));});
setInterval(()=>{
  if(coreLink.connected&&performance.now()-coreLink.lastAt>800&&coreReady){coreReady=false;headModifier.recenter();$('core-status').textContent='CoreS3の受信待ち';}
},250);
function renderDials(){
  if(deviceMode!=='dial')return;
  document.querySelector('.selection').classList.toggle('single-lcd',dialPattern.single);
  document.querySelector('.selection').classList.toggle('type-lcd',dialPattern.studio);
  $('type-sliders').hidden=!dialPattern.studio;
  updateCustomWheels();
  document.querySelector('[data-action=confirm][data-dial="0"]').setAttribute('aria-label',dialPattern.single?'選択中の文字を入力':'左の文字を入力');
  if(dialPattern.full){
    dialWheels[0].select(dialPattern.selected);
    $('dial-character-0').textContent=KANA[dialPattern.selected];
    Object.assign($('dial-character-0').style,dialPattern.studio?rotatedRunStyle(candidateRun()):{...rotationStyle(candidateRun()),fontFamily:'"HeadKanaZenMaru",sans-serif',fontWeight:'700',fontSize:''});
    $('dial-position-0').textContent=`${dialPattern.selected+1} / 46`;
    $('dial-panel-0').classList.toggle('is-pressed',dialPattern.pressed);
    $('dial-status-0').textContent=dialPattern.pressed?'KEY 押下中':'短押しで入力 · 長押しで削除';
    if(dialPattern.studio){
      const fonts=typeFonts(),font=fonts[typeControls.fontIndex%fonts.length];
      dialWheels[1].select(typeControls.fontIndex%fonts.length);
      $('dial-character-1').textContent=font.label;
      $('dial-position-1').textContent=`${typeControls.fontIndex%fonts.length+1} / ${fonts.length}`;
      $('dial-status-1').textContent='回すと即反映 · KEYで再適用';
      $('dial-panel-1').classList.toggle('is-pressed',!!dialPattern.fontPressed);
    }
    renderTypePreview();return;
  }
  for(let i=0;i<2;i++){
    const custom=dialAssignments.mode!=='split';
    const start=i===0?0:25,index=custom?(i===0?dialAssignments.leftIndex:dialAssignments.rightIndex):dialState.positions[i]-start;
    const choices=dialAssignments.choices(),choice=choices[index];
    dialWheels[i].select(index);
    $('dial-character-'+i).textContent=custom?(i===0?KANA[index]:choice?.label||'—'):KANA[dialState.positions[i]];
    $('dial-position-'+i).textContent=`${index+1} / ${custom?(i===0?46:choices.length):i===0?25:21}${custom&&i===1&&choice?.detail?' · '+choice.detail:''}`;
    if(i===0)Object.assign($('dial-character-0').style,rotatedRunStyle(candidateRun()));
    $('dial-panel-'+i).classList.toggle('is-pressed',!!(dialState.pressedMask&(1<<i)));
    $('dial-status-'+i).textContent=dialState.pressedMask&(1<<i)?'KEY 押下中':custom&&i===1&&dialAssignments.mode!=='symbols'?'このKEYで設定を確定':'このKEYで入力';
  }
  renderTypePreview();
}
let demoMode='head';
function updateModeView(){
  const dial=deviceMode==='dial';
  $('dial-pattern').disabled=connected&&!demo;
  $('pattern-status').textContent=dialPattern.detected?`接続機器：${DIAL_PATTERN_NAMES[dialPattern.detected]}を自動認識`:
    dialPattern.choice==='auto'?'接続すると自動認識します':`${DIAL_PATTERN_NAMES[dialPattern.choice]}の表示 · 接続すると機器を自動認識します`;
  document.querySelector('.selection').classList.toggle('dial-mode',dial);
  $('dial-demo-actions').hidden=!(demo&&dial);
  for(const controls of document.querySelectorAll('.dial-turn-actions'))controls.hidden=!(demo&&dial);
  $('dial-preview').hidden=connected&&!demo;
  $('dial-preview').textContent=demo&&dial?'ダイヤル体験を終了':'ダイヤル表示を試す';
  $('range-description').textContent=dial?(dialPattern.studio?'左で文字を選択し短押しで入力。右でフォント、GP29でサイズ、GP28でウェイトを調整。装飾は選択中の文字へ即反映し、入力時に1文字ずつ固定します。LCDは選択中のかなを固定書体で表示します。':dialPattern.single?'1つのダイヤルで「あ〜ん」を選択。中央のLCDにも同じ文字を表示します。短押しで入力、長押しで1文字削除。':dialAssignments.mode==='split'?'左KEYで左の文字、右KEYで右の文字を入力。両方を回したり押したりできます。同時確定は左→右の順に入力します。':'左で「あ〜ん」すべてを入力。右は回して選び、KEYで確定。装飾は次に入力する文字に適用し、入力済みの文字は変えません。'):`あ〜んの46文字を左右合計${engine.options.range}°に配置。左端が「あ」、右端が「ん」です。`;
  $('recenter').disabled=dial||!(demo||connected);
}
const logs=[];
function log(message){
  $('feedback').textContent=message;
  logs.unshift(message);logs.length=Math.min(logs.length,5);
  $('gesture-log').replaceChildren(...logs.map(s=>{const li=document.createElement('li');li.textContent=s;return li;}));
}
function speakSelection(){speaker.observe({selected:deviceMode==='dial'?(dialPattern.full?KANA[dialPattern.selected]:dialAssignments.mode==='split'?dialState.positions.map(i=>KANA[i]).join('、'):KANA[dialAssignments.leftIndex]):KANA[doc.selected],connected:connected||demo,ready});}
async function flushM5Selection(){
  if(selectionSending||!selectionCharacteristic)return;
  selectionSending=true;let failed=false;
  try{
    while(selectionCharacteristic&&selectionSent!==selectionToSend){
      const characteristic=selectionCharacteristic,index=selectionToSend,value=Uint8Array.of(index);
      if(characteristic.properties.writeWithoutResponse)await characteristic.writeValueWithoutResponse(value);
      else await characteristic.writeValue(value);
      if(characteristic!==selectionCharacteristic)break;
      selectionSent=index;
    }
  }catch(error){failed=true;console.warn('BLE display:',error.message);}
  finally{
    selectionSending=false;
    if(!failed&&selectionCharacteristic&&selectionSent!==selectionToSend)void flushM5Selection();
  }
}
function syncM5Selection(index){selectionToSend=index;void flushM5Selection();}
function render(){
  selected.textContent=KANA[doc.selected];
  Object.assign(selected.style,rotatedRunStyle(candidateRun()));
  renderDials();updateModeView();
  $('selection-position').textContent=`${doc.selected+1} / ${KANA.length}`;
  const runs=doc.composition;
  updateCandidatePreview();textOutput.publish();updateLcdGlyph();
  text.replaceChildren(...runs.map(r=>{const span=document.createElement('span');span.textContent=r.text;span.className=r.size>1?'emphasis':'';Object.assign(span.style,rotatedRunStyle(r));return span;}));
  if(!runs.length){const p=document.createElement('span');p.id='placeholder';p.textContent=deviceMode==='dial'?'ダイヤルを短押しして文字を追加':'頷くか、赤ボタンで文字を追加';text.append(p);}
  count.textContent=`${doc.length} / 96文字`;
  copy.disabled=!doc.text;
  $('clear-text').disabled=!doc.text;
  copy.textContent='コピー';
  centerRotationBodies([selected,$('dial-character-0'),$('type-preview-letter'),...document.querySelectorAll('#text > span:not(#placeholder)')]);
  speakSelection();
}
function updateConnection(){
  status.className=(connected||demo)?(ready?'connected':'calibrating'):'';
  const connectionName=transport==='usb'?'USB':'BLE';
  statusLabel.textContent=demo?'体験デモ':connected?(deviceMode==='dial'?`${connectionName} · ダイヤル接続済み`:ready?'BLE · 接続済み':'BLE · 姿勢を調整中'):'未接続';
  hint.textContent=demo?(deviceMode==='dial'?'ダイヤル体験中 · ← → で回して、短押しで入力':'デモ中 · 下のボタンで動作を試せます'):!connected?'ダイヤルをBLEまたはUSBで接続してください':deviceMode==='dial'?'ダイヤルで入力 · CoreS3の頷きで濁点・半濁点・小文字':!ready?'正面を向き、頭を動かさずに待ってください':'左右であ〜んを選択 · 頷くか赤ボタンで入力';
  if(legacy)hint.textContent='旧ファームウェアです。v2.0を書き込むとジェスチャーを使えます';
  $('demo-controls').hidden=!demo||deviceMode==='dial';
  $('demo-toggle').textContent=demo?'体験デモを終了':'接続せずに体験デモ';
  updateModeView();
}
function act(event){
  if(event.type==='select'){if(Number.isInteger(event.index))doc.choose(event.index);else doc.select(event.steps);if(deviceMode==='dial')dialState.observe(doc.selected);syncM5Selection(doc.selected);render();return;}
  if(event.type==='read'){speaker.read(doc.text);log('全文を読み上げ');return;}
  if(event.type==='confirm'){
    const index=Number.isInteger(event.selectionIndex)?event.selectionIndex:doc.selected;
    const character=KANA[index];
    if(!doc.confirm(event.strong,index,inputStyle())){log('96文字まで入力できます');return;}
    hideCandidatePreview();render();speaker.confirm(character);
    log(deviceMode==='dial'?`短押し：「${character}」を入力`:event.strong?'強い頷き：大きく入力':'頷き：文字を入力');
  }
  if(event.type==='erase'){const result=doc.erase();render();log(result?(deviceMode==='dial'?'長押し：1文字削除':'横振り：1文字削除'):'消す文字がありません');}
  if(event.type==='clear'){
    doc.clear();hideCandidatePreview();coreTarget=null;coreCycle.reset();$('nod-progress').textContent='—';
    $('modifier-feedback').textContent=nodRole==='modifier'?'次の文字は濁点から始まります':NOD_ROLE_HINTS.confirm;
    render();log('すべての文字を消去');
  }
}
function showHeading(degrees){
  const half=engine.options.range/2;
  const bounded=Math.max(-half,Math.min(half,degrees));
  $('yaw-angle').textContent=`${degrees.toFixed(1)}°`;
  $('yaw-marker').style.left=`${(bounded+half)/engine.options.range*100}%`;
}
function acceptSensor(s){
  if(demo||s.protocol!==2)return;
  legacy=false;connected=true;lastSampleAt=performance.now();
  const metrics=engine.feed(s);if(!metrics)return;
  const wasReady=ready;ready=!metrics.calibrating;
  if(wasReady!==ready){updateConnection();speakSelection();}
  if(performance.now()-lastTelemetryAt>100){
    lastTelemetryAt=performance.now();
    $('pitch-value').textContent=`${(metrics.pitch||0).toFixed(1)}°`;
    $('roll-value').textContent=`${(metrics.roll||0).toFixed(1)}°`;
    showHeading(metrics.yaw||0);
    $('yaw-value').textContent=`${(metrics.yawRate||0).toFixed(0)}°/s`;
    $('speed-value').textContent=`${(metrics.peak||0).toFixed(0)}°/s`;
    $('red-value').textContent=s.red?'押下':'OFF';$('blue-value').textContent=s.blue?'押下':'OFF';
  }
}
function acceptDial(s){
  if(demo||![3,4,5].includes(s.protocol))return;
  legacy=false;deviceMode='dial';connected=true;ready=!!s.ready;lastSampleAt=performance.now();
  dialPattern.accept(s);
  if(dialPattern.full){
    if(dialPattern.studio){typeControls.feed(s,typeFonts().length);applyTypeStyle();}
    doc.choose(s.selected);
    if(s.confirm)confirmDial(0);
    if(s.fontConfirm)confirmDial(1);
  }else{
    if(!dialState.sync(s.positions,s.pressedMask))dialState.observe(s.selected);
    dialAssignments.sync(dialState.positions);
    if(s.confirm)confirmDial(s.selected<25?0:1);
  }
  if(s.erase)act({type:'erase'});
  render();
  $('pitch-value').textContent='—';$('roll-value').textContent='—';$('yaw-value').textContent='—';$('speed-value').textContent='—';
  $('red-value').textContent=s.pressed?'押下':'OFF';$('blue-value').textContent='—';
  updateConnection();
}
function acceptBLE(state){
  if(demo)return;
  if(state.type==='sensor'){acceptSensor(state);return;}
  if(state.type==='dial'){acceptDial(state);return;}
  if(state.type==='state'&&typeof state.selected==='string'&&typeof state.text==='string'){
    legacy=true;connected=true;ready=state.ready;lastSampleAt=performance.now();
    selected.textContent=state.selected;text.textContent=state.text;count.textContent=`${Array.from(state.text).length} / 96文字`;
    speaker.observe({...state,connected:true});updateConnection();return;
  }
  if(state.type==='event'&&Number.isSafeInteger(state.id)&&state.id>lastEventId){
    lastEventId=state.id;if(state.event==='confirm')speaker.confirm(state.character);if(state.event==='read')speaker.read(state.text);
  }
}
function receiveNotification(event){
  const v=event.target.value,bytes=new Uint8Array(v.buffer,v.byteOffset,v.byteLength);
  // A legacy frame ID can equal A5. Its chunk count cannot be zero, whereas
  // protocol-2 seq high-byte can; protocol-2 is selected after the snapshot.
  const message=protocol===2?decodeSensorPacket(bytes):protocol===3?decodeDialPacket(bytes):decoder.push(bytes);
  if(message)acceptBLE(message);
}
let protocol=0;
function disconnected(){
  $('encoder-swap-control').hidden=true;lcdGlyphs.disable();
  dialAssignments.rebase();
  if(transport==='usb')return;
  transport='none';
  notification?.removeEventListener('characteristicvaluechanged',receiveNotification);notification=null;
  selectionCharacteristic=null;selectionSent=-1;
  connected=false;ready=demo;protocol=0;deviceMode=demo?demoMode:'head';decoder.reset();engine.recenter();
  speaker.ready=false;speaker.synth?.cancel();bleButton.disabled=!navigator.bluetooth;bleButton.textContent='ダイヤル BLEで接続';
  usbButton.disabled=!navigator.serial;usbButton.textContent='ダイヤル USBで接続';
  updateConnection();render();
}
bleButton.addEventListener('click',async()=>{
  speaker.activate();
  if(device?.gatt.connected){device.gatt.disconnect();return;}
  if(demo){demo=false;ready=false;updateConnection();}
  bleButton.disabled=true;statusLabel.textContent='BLE · 接続中';hint.textContent='M5-Kana-Dial を選んでください';
  try{
    device?.removeEventListener('gattserverdisconnected',disconnected);
    device=await navigator.bluetooth.requestDevice({filters:[{namePrefix:'M5-Kana-Dial'}],optionalServices:[SERVICE]});
    device.addEventListener('gattserverdisconnected',disconnected);
    const server=await device.gatt.connect();const service=await server.getPrimaryService(SERVICE);
    notification=await service.getCharacteristic(NOTIFY);
    try{selectionCharacteristic=await service.getCharacteristic(SELECTION);}catch{selectionCharacteristic=null;}
    selectionSent=-1;selectionToSend=doc.selected;
    // Read protocol before subscribing, so binary sensor packets and legacy
    // fragmented JSON cannot be confused (the marker is not globally unique).
    const snapshot=await service.getCharacteristic(SNAPSHOT);
    const value=await snapshot.readValue();const state=JSON.parse(new TextDecoder().decode(value));
    protocol=state.protocol===3?3:state.protocol===2?2:1;deviceMode=protocol===3?'dial':'head';decoder.reset();engine.recenter();lastEventId=0;
    notification.addEventListener('characteristicvaluechanged',receiveNotification);
    await notification.startNotifications();connected=true;lastSampleAt=performance.now();acceptBLE(state);syncM5Selection(doc.selected);
    transport='ble';bleButton.textContent='BLEを切断';usbButton.disabled=true;updateConnection();render();
  }catch(error){
    if(device?.gatt.connected)device.gatt.disconnect();else disconnected();
    hint.textContent=error.name==='NotFoundError'?'接続をキャンセルしました。もう一度接続できます':'接続できませんでした。M5-Kanaの電源とBluetoothの許可を確認してください';
    console.warn('BLE:',error.message);
  }finally{bleButton.disabled=!navigator.bluetooth;}
});
async function readUSB(port){
  const reader=port.readable.getReader(),textDecoder=new TextDecoder();serialReader=reader;
  try{
    while(serialPort===port){
      const {value,done}=await reader.read();if(done)break;
      for(const state of usbDecoder.push(textDecoder.decode(value,{stream:true}))){
        if(state.type==='encoder-swap')showEncoderSwap(state.swapped);
        else if(state.type==='lcd-glyph'){if(state.size>0&&state.size<=240){lcdGlyphs.enable(state.size);render();}}
        else acceptDial(state);
      }
    }
  }catch(error){if(serialPort===port)console.warn('USB serial:',error.message);}
  finally{
    try{reader.releaseLock();}catch{}
    if(serialReader===reader)serialReader=null;
    if(serialPort===port){
      serialPort=null;try{await port.close();}catch{}
      if(transport==='usb'){transport='none';disconnected();hint.textContent='USB接続が終了しました。もう一度接続できます';}
    }
  }
}
// Dial boards from v2.5 report @SWAP and take 'E' / 'e'; older boards never report, so the control stays hidden.
// Writes go out one at a time so a command never lands inside an LCD image.
let usbWriteChain=Promise.resolve();
function writeUSB(data){
  const job=usbWriteChain.then(async()=>{
    const writer=serialPort?.writable?.getWriter();if(!writer)return;
    try{await writer.write(typeof data==='string'?new TextEncoder().encode(data):data);}finally{writer.releaseLock();}
  });
  usbWriteChain=job.catch(()=>{});return job;
}
// From v2.7 the board reports @GLYPHSET and keeps the 46 kana in the input's font and weight.
function updateLcdGlyph(){
  if(transport!=='usb'||!dialPattern.studio)return;
  const run=candidateRun(),fontId=dialAssignments.style.fontId;
  lcdGlyphs.update(dialPattern.selected,run,()=>Promise.all([fontCatalog.load(fontId,run.fontWeight),document.fonts.load(`${run.fontWeight} 100px ${run.fontFamily}`,run.text)]));
}
function showEncoderSwap(swapped){$('encoder-swap-control').hidden=false;$('encoder-swap').checked=swapped;$('encoder-swap').disabled=false;}
$('encoder-swap').addEventListener('change',e=>{
  $('encoder-swap').disabled=true;
  void writeUSB(e.target.checked?'E':'e').catch(()=>{$('encoder-swap').disabled=false;$('encoder-swap-status').textContent='ダイヤル基板に送れませんでした';});
});
async function stopUSB(reset=true){
  const port=serialPort,reader=serialReader;serialPort=null;serialReader=null;
  try{await reader?.cancel();}catch{}try{reader?.releaseLock();}catch{}try{await port?.close();}catch{}
  if(reset&&transport==='usb'){transport='none';disconnected();}
}
usbButton.addEventListener('click',async()=>{
  speaker.activate();
  if(serialPort){await stopUSB();return;}
  if(demo){demo=false;ready=false;updateConnection();}
  usbButton.disabled=true;statusLabel.textContent='USB · 接続中';hint.textContent='RP2040 Zero または M5StampS3 を選んでください';
  let port=null;
  try{
    port=await navigator.serial.requestPort({filters:[{usbVendorId:0x303A,usbProductId:0x1001},{usbVendorId:0x2E8A,usbProductId:0x0003}]});
    await port.open({baudRate:115200});
    serialPort=port;usbDecoder.reset();dialAssignments.rebase();dialPattern.beginConnection();typeControls.reset();transport='usb';protocol=3;deviceMode='dial';legacy=false;connected=true;ready=true;lastSampleAt=performance.now();
    usbButton.textContent='USBを切断';usbButton.disabled=false;bleButton.disabled=true;updateConnection();render();void readUSB(port);
    void writeUSB('?').catch(()=>{});
  }catch(error){
    if(port&&port!==serialPort)try{await port.close();}catch{}
    transport='none';disconnected();
    hint.textContent=error.name==='NotFoundError'?'接続をキャンセルしました。もう一度接続できます':'USB接続に失敗しました。ケーブルとダイヤル基板を確認してください';
    console.warn('USB:',error.message);
  }
});
setInterval(()=>{
  const staleAfter=deviceMode==='dial'?1500:800;
  if(connected&&!demo&&performance.now()-lastSampleAt>staleAfter&&ready){
    ready=false;engine.recenter();speaker.ready=false;speaker.synth?.cancel();updateConnection();hint.textContent='センサーの受信が止まっています。再接続してください';
  }
},250);
$('recenter').addEventListener('click',()=>{engine.recenter();if(!demo)ready=false;updateConnection();log('正面で静止すると基準姿勢を合わせます');});
copy.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(doc.text);copy.textContent='コピーしました';}catch{copy.textContent='文字を選択してコピーしてください';}
});
$('clear-text').addEventListener('click',()=>act({type:'clear'}));
$('copy-styled').addEventListener('click',async()=>{
  try{
    const div=document.createElement('div');
    for(const run of doc.composition){const span=document.createElement('span');span.textContent=run.text;Object.assign(span.style,rotatedRunStyle(run));div.append(span);}
    await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([doc.text],{type:'text/plain'}),'text/html':new Blob([div.outerHTML],{type:'text/html'})})]);
    log('文字サイズ付きでコピーしました');
  }catch{log('サイズ付きコピーに非対応です。通常のコピーを使ってください');}
});
for(const [id,key] of [['strong-threshold','strong'],['shake-threshold','shake']]){
  const control=$(id);control.addEventListener('input',()=>{engine.options[key]=Number(control.value);$(id+'-output').value=control.value;});
}
function updateRange(value,persist=false){
  const range=engine.setRange(value),half=range/2;
  $('motion-range').value=range;$('motion-range-output').value=`${range}°`;
  $('motion-range-hint').textContent=`左右${half}°ずつ · 1文字あたり約${(range/(KANA.length-1)).toFixed(1)}°。狭くすると小さな動きで選べます。`;
  $('range-left-label').textContent=`左${half}° · あ`;$('range-right-label').textContent=`右${half}° · ん`;
  updateModeView();
  for(const span of document.querySelectorAll('.half-range'))span.textContent=half;
  const control=$('demo-angle');control.min=-half;control.max=half;
  control.value=Math.max(-half,Math.min(half,Number(control.value)));
  if(demo&&deviceMode==='head')engine.setHeading(Number(control.value));
  showHeading(engine.yaw);
  if(persist)try{localStorage.setItem(RANGE_KEY,String(range));}catch{}
}
$('motion-range').addEventListener('input',e=>updateRange(Number(e.target.value),true));
$('range-reset').addEventListener('click',()=>updateRange(120,true));
$('reverse-selection').addEventListener('change',e=>{engine.options.direction=e.target.checked?1:-1;engine.recenter();ready=demo;updateConnection();});
$('demo-toggle').addEventListener('click',async()=>{
  if(serialPort)await stopUSB();
  demoMode='head';deviceMode='head';
  demo=!demo;if(demo&&device?.gatt.connected)device.gatt.disconnect();
  ready=demo;engine.recenter();updateConnection();render();log(demo?'体験デモを開始しました。実機の動作確認とは別です':'体験デモを終了しました');
});
$('dial-preview').addEventListener('click',async()=>{
  if(serialPort)await stopUSB();
  if(demo&&deviceMode==='dial'){demo=false;demoMode='dial';deviceMode='dial';ready=false;}
  else{
    demoMode='dial';demo=true;deviceMode='dial';ready=true;
    dialState.pressedMask=0;
    dialAssignments.previous=dialState.positions.slice();
    doc.choose(dialState.positions[0]);
    if(device?.gatt.connected)device.gatt.disconnect();
  }
  updateConnection();render();
});
$('demo-angle').addEventListener('input',e=>{if(demo&&deviceMode==='head'){engine.setHeading(Number(e.target.value));showHeading(Number(e.target.value));}});
$('demo-reading').addEventListener('input',e=>{
  doc.clear();
  doc.composition=Array.from(e.target.value).filter(c=>KANA.includes(c)).slice(0,96).map(text=>({text,size:1}));render();
});
for(const button of document.querySelectorAll('[data-action]'))button.addEventListener('click',()=>{
  if(!demo)return;
  const type=button.dataset.action;
  if(type==='next'||type==='previous'){
    if(deviceMode==='dial'){
      if(dialPattern.studio&&Number(button.dataset.dial)===1){typeControls.fontIndex+=type==='next'?1:-1;applyTypeStyle();render();return;}
      if(dialPattern.full){dialPattern.step(type==='next'?1:-1);doc.choose(dialPattern.selected);render();return;}
      const group=button.dataset.dial===undefined?0:Number(button.dataset.dial);
      dialState.step(group,type==='next'?1:-1);dialAssignments.sync(dialState.positions);
      doc.choose(dialAssignments.mode==='split'?dialState.positions[group]:dialAssignments.leftIndex);render();return;
    }
    const index=Math.max(0,Math.min(KANA.length-1,doc.selected+(type==='next'?1:-1)));
    const degrees=-engine.options.range/2+index*engine.options.range/(KANA.length-1);
    engine.setHeading(degrees);$('demo-angle').value=degrees;showHeading(degrees);return;
  }
  if(deviceMode==='dial'&&type==='confirm'){
    confirmDial(Number(button.dataset.dial||0));return;
  }
  if(deviceMode==='dial'&&type==='both'){
    confirmDial(0);confirmDial(1);return;
  }
  act(type==='strong'?{type:'confirm',strong:true}:{type});
});
bleButton.disabled=!navigator.bluetooth;usbButton.disabled=!navigator.serial;usbButton.hidden=!navigator.serial;
if(!navigator.bluetooth&&!navigator.serial)$('browser-note').hidden=false;
updateRange(engine.options.range);render();updateConnection();
updateCoreLinkState({connected:false,busy:false,kind:'',message:''});
$('core-usb-connect').hidden=!navigator.serial;

function refreshRotationBodies(){centerRotationBodies([selected,$('dial-character-0'),$('type-preview-letter'),...document.querySelectorAll('#text > span:not(#placeholder)')]);}
document.fonts?.addEventListener('loadingdone',refreshRotationBodies);
window.addEventListener?.('resize',refreshRotationBodies);
