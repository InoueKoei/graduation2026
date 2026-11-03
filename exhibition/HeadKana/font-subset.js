'use strict';
// Cuts a local font down to the kana, symbols and ASCII HeadKana can type (harfbuzz hb-subset, vendor/harfbuzz-LICENSE.txt).
// A 13MB Japanese face becomes ~200KB: it loads in a millisecond and is cheap to hand to the text-only tab.
const SUBSET_RANGES=[[0x20,0x7e],[0x2010,0x2027],[0x3000,0x30ff],[0xff01,0xff5e]];
let harfbuzzSubset;
function loadHarfbuzzSubset(){
  harfbuzzSubset??=fetch('vendor/harfbuzz-subset.wasm').then(r=>{if(!r.ok)throw Error('harfbuzz-subset.wasm を読み込めませんでした');return r.arrayBuffer();})
    .then(bytes=>WebAssembly.instantiate(bytes)).then(m=>m.instance.exports).catch(error=>{harfbuzzSubset=null;throw error;});
  return harfbuzzSubset;
}
async function subsetFont(data,extraText=''){
  const hb=await loadHarfbuzzSubset(),bytes=new Uint8Array(data),ptr=hb.malloc(bytes.byteLength);
  new Uint8Array(hb.memory.buffer).set(bytes,ptr);
  const blob=hb.hb_blob_create(ptr,bytes.byteLength,1,0,0),face=hb.hb_face_create(blob,0);hb.hb_blob_destroy(blob);
  const input=hb.hb_subset_input_create_or_fail(),set=hb.hb_subset_input_unicode_set(input);
  for(const [from,to] of SUBSET_RANGES)for(let c=from;c<=to;c++)hb.hb_set_add(set,c);
  for(const c of extraText)hb.hb_set_add(set,c.codePointAt(0));
  const subset=hb.hb_subset_or_fail(face,input);hb.hb_subset_input_destroy(input);hb.hb_face_destroy(face);
  try{
    if(!subset)throw Error('書体を軽くできませんでした');
    const out=hb.hb_face_reference_blob(subset),length=hb.hb_blob_get_length(out),at=hb.hb_blob_get_data(out,0);
    const result=new Uint8Array(hb.memory.buffer).slice(at,at+length).buffer;
    hb.hb_blob_destroy(out);hb.hb_face_destroy(subset);
    if(!length)throw Error('書体を軽くできませんでした');
    return result;
  }finally{hb.free(ptr);}
}
if(typeof module!=='undefined')module.exports={subsetFont,SUBSET_RANGES};
