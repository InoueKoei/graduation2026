'use strict';
// Bakes commercial faces to PNG so the Raspberry Pi can show them without the font files.
// Rasterised glyphs only: outlines (SVG) and subset fonts count as font data under the LETS / Passport terms.
const $=id=>document.getElementById(id);
let curated=[],matched=[];

function bakeChars(){
  return [...new Set([...KANA,...VOICED_FORM,...HALF_FORM,...SMALL_FORM,...DEFAULT_DIAL_OPTIONS.symbols,...Array.from($('extra').value.replace(/\s/g,''))])];
}
function fontSlug(entry){return (entry.postscript||entry.family).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function glyphFile(char){return Array.from(char).map(c=>c.codePointAt(0).toString(16)).join('-')+'.png';}
function log(line){$('log').textContent+=line+'\n';$('log').scrollTop=$('log').scrollHeight;}

$('read').addEventListener('click',async()=>{
  $('read').disabled=true;$('status').textContent='';
  try{
    if(!window.queryLocalFonts||!window.showDirectoryPicker)throw Error('Mac の Chrome で開いてください');
    const available=await window.queryLocalFonts();
    curated=(await (await fetch('moji-fonts.json')).json()).fonts;
    matched=matchMojiFonts(curated,available);
    $('fonts').replaceChildren(...matched.map(font=>{
      const label=document.createElement('label'),input=document.createElement('input'),name=document.createElement('span'),weights=document.createElement('small');
      input.type='checkbox';input.value=font.id;name.textContent=font.label;weights.textContent=font.weights.join(' / ');
      label.append(input,name,weights);return label;
    }));
    $('bake').disabled=!matched.length;
    $('status').textContent=matched.length?`${matched.length}書体が見つかりました。焼くものを選んでください`:'Moji-stack の書体が見つかりませんでした';
  }catch(error){$('status').textContent=error.name==='NotAllowedError'?'フォントの読み込みが許可されませんでした':error.message;}
  finally{$('read').disabled=false;}
});

// A glyph the face lacks falls back to another font; measuring against two different fallbacks exposes it.
function hasGlyph(ctx,family,size,char){
  const measure=fallback=>{ctx.font=`${size}px "${family}",${fallback}`;const m=ctx.measureText(char);return [m.width,m.actualBoundingBoxLeft,m.actualBoundingBoxRight,m.actualBoundingBoxAscent,m.actualBoundingBoxDescent];};
  const a=measure('monospace'),b=measure('serif');return a.every((v,i)=>Math.abs(v-b[i])<0.5);
}
async function writeFile(dir,name,data){const file=await (await dir.getFileHandle(name,{create:true})).createWritable();await file.write(data);await file.close();}

async function bakeFace(root,face,family,size,pad,chars,weight){
  const loaded=await new FontFace(family,await (await face.blob()).arrayBuffer()).load();document.fonts.add(loaded);
  const dir=await root.getDirectoryHandle(String(weight),{create:true}),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),glyphs={},missing=[];
  for(const char of chars){
    if(!hasGlyph(ctx,family,size,char)){missing.push(char===' '?'空白':char);continue;}
    ctx.font=`${size}px "${family}",monospace`;
    const m=ctx.measureText(char),inkWidth=m.actualBoundingBoxLeft+m.actualBoundingBoxRight,inkHeight=m.actualBoundingBoxAscent+m.actualBoundingBoxDescent;
    // Blank glyphs (space) keep their advance and the em height, as the text path measures them.
    if(!(inkWidth>0&&inkHeight>0)){glyphs[char]={w:Math.round(m.width),h:size};continue;}
    canvas.width=Math.ceil(inkWidth+pad*2);canvas.height=Math.ceil(inkHeight+pad*2);
    ctx.font=`${size}px "${family}",monospace`;ctx.fillStyle='#000';ctx.fillText(char,pad+m.actualBoundingBoxLeft,pad+m.actualBoundingBoxAscent);
    const file=glyphFile(char);await writeFile(dir,file,await new Promise(r=>canvas.toBlob(r,'image/png')));
    glyphs[char]={file:`${weight}/${file}`,w:canvas.width,h:canvas.height};
  }
  document.fonts.delete(loaded);
  return {glyphs,missing};
}

$('bake').addEventListener('click',async()=>{
  const chosen=matched.filter(f=>document.querySelector(`#fonts input[value="${f.id}"]`)?.checked);
  if(!chosen.length){$('status').textContent='焼く書体を選んでください';return;}
  $('bake').disabled=true;$('log').textContent='';
  try{
    const out=await window.showDirectoryPicker({id:'headkana-baked',mode:'readwrite'}),size=Number($('size').value),pad=Math.ceil(size*0.03),chars=bakeChars();
    let index={fonts:[]};
    try{index=JSON.parse(await (await (await out.getFileHandle('index.json')).getFile()).text());}catch{}
    for(const font of chosen){
      const slug=fontSlug(curated[Number(font.id.slice('moji-'.length))]),set={label:font.label,size,pad,weights:{}};
      try{await out.removeEntry(slug,{recursive:true});}catch{}
      const root=await out.getDirectoryHandle(slug,{create:true});
      for(const face of font.faces){
        const weight=fontWeightFromName(face.style+' '+face.postscriptName);
        if(set.weights[weight]){log(`${font.label} ${face.postscriptName}：ウェイト ${weight} は焼き済みなので飛ばしました`);continue;}
        $('status').textContent=`${font.label} ${weight} を焼いています…`;
        const {glyphs,missing}=await bakeFace(root,face,`HeadKanaBake-${slug}-${weight}`,size,pad,chars,weight);
        set.weights[weight]=glyphs;
        log(`${font.label} ${weight}：${Object.keys(glyphs).length}字`+(missing.length?`（書体に無い字：${missing.join(' ')}）`:''));
      }
      await writeFile(root,'glyphs.json',JSON.stringify(set));
      index.fonts=index.fonts.filter(f=>f.slug!==slug).concat({slug,label:font.label,weights:Object.keys(set.weights).map(Number).sort((a,b)=>a-b)});
    }
    await writeFile(out,'index.json',JSON.stringify(index,null,1));
    $('status').textContent=`${chosen.length}書体を書き出しました。フォルダごとラズパイにコピーしてください`;
  }catch(error){$('status').textContent=error.name==='AbortError'?'書き出しをやめました':error.message;}
  finally{$('bake').disabled=false;}
});
