// 配線。データ源 → Track → View。

const track = new Track();
const view  = new View(document.getElementById('stage'), track);

const $ = id => document.getElementById(id);
const state = { L: '未接続', R: '未接続' };

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 2200);
}

function onEvent(ev) {
  if (ev.t === 'step') {
    track.addStep(ev);
    if (ev.foot) state[ev.foot] = `${ev.seq} 歩`;
  } else if (ev.t === 'pose') {
    track.addPose(ev);
    if (ev.foot) state[ev.foot] = `${ev.state === 'stance' ? '立脚' : '遊脚'} ${ev.hz?.toFixed?.(0) ?? '—'}Hz`;
  } else if (ev.t === 'origin') {
    track.resetOrigin(ev.foot);
  } else if (ev.t === 'hello') {
    toast(`${ev.foot} 足がつながりました`);
  } else if (ev.t === 'error') {
    toast(`装置からエラー: ${ev.msg}`);
  }
}

function onState(label, st, detail) {
  const msg = { connecting: '接続中', connected: 'つながりました', closed: '切断しました', failed: '失敗' }[st] || st;
  toast(`${label}: ${msg}${detail ? ` — ${detail}` : ''}`);
  const btn = { USB: $('bSerial'), WS: $('bWs'), DEMO: $('bDemo'), FILE: $('bFile') }[label];
  if (btn) btn.classList.toggle('on', st === 'connected');
}

// --- データ源 -----------------------------------------------------------
const serial  = new SerialPool(onEvent, onState);
const ws      = new WsSource(onEvent, onState);
const file    = new FileSource(onEvent, onState);
const demo    = new DemoSource(onEvent, onState);

if (!SerialPool.supported) {
  const b = $('bSerial');
  b.disabled = true;
  b.title = 'このブラウザは Web Serial 非対応（Chrome / Edge を使ってください）';
}

// 押すたびにポートを1つ足す。両足なら2回押してそれぞれのポートを選ぶ。
$('bSerial').onclick = async () => {
  await serial.add();
  $('bSerialOff').disabled = serial.count === 0;
  $('bSerial').textContent = serial.count ? `USB を追加（${serial.count}）` : 'USB を追加';
};
$('bSerialOff').onclick = async () => {
  await serial.closeAll();
  $('bSerialOff').disabled = true;
  $('bSerial').textContent = 'USB を追加';
};
$('bWs').onclick = () => {
  if (ws.ws) { ws.disconnect(); return; }
  const url = prompt('WebSocket の URL', localStorage.wsUrl || 'ws://192.168.4.1/ws');
  if (!url) return;
  localStorage.wsUrl = url;
  ws.connect(url);
};
$('bFile').onclick = () => $('fileIn').click();
$('fileIn').onchange = e => { if (e.target.files[0]) file.play(e.target.files[0]); };

let demoOn = false;
$('bDemo').onclick = () => {
  demoOn = !demoOn;
  if (demoOn) {
    track.clear();
    demo.start(demo._shape = (demo._shape === 'square' ? 'circle' : 'square'));
  } else demo.stop();
};

// --- 操作 ---------------------------------------------------------------
// 「構え」は装置にも送る。足に付けた状態では本体のボタンを押せないため。
// 両足へ同時に届くので、ここで左右のヨー原点と位置原点が揃う。
$('bOrigin').onclick = async () => {
  const n = serial.count;
  if (n) await serial.send({ cmd: 'origin' });
  if (ws.ws) ws.ws.send(JSON.stringify({ cmd: 'origin' }));
  track.resetOrigin();
  view.fit();
  toast(n ? `構えました（装置 ${n} 台に送信）` : '表示だけリセットしました（装置は未接続）');
};

$('bRec').onclick = () => {
  track.recording = !track.recording;
  if (track.recording) track.recorded = [];
  $('bRec').classList.toggle('on', track.recording);
  $('bRec').textContent = track.recording ? '記録停止' : '記録開始';
  $('rec').classList.toggle('on', track.recording);
};

$('bFit').onclick = () => view.fit();
$('bClear').onclick = () => {
  // デモやファイル再生が回ったままだと、消した直後から書き戻されて消えたように見えない
  if (demoOn) { demo.stop(); demoOn = false; $('bDemo').classList.remove('on'); }
  file.stop();
  track.clear();
  if (!serial.count && !ws.ws) { state.L = '未接続'; state.R = '未接続'; }
  $('bRec').classList.remove('on');
  $('bRec').textContent = '記録開始';
  $('rec').classList.remove('on');
  toast('消しました');
};

// --- 書き出し -----------------------------------------------------------
function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

$('bSvg').onclick = () => {
  const svg = track.toSVG();
  if (!svg) { toast('線がまだありません'); return; }
  download(`footsteps-${stamp()}.svg`, svg, 'image/svg+xml');
};
$('bJson').onclick = () => {
  if (!track.contacts.length) { toast('記録がありません'); return; }
  download(`footsteps-${stamp()}.json`, track.toJSON(), 'application/json');
};
$('bCsv').onclick = () => {
  if (!track.contacts.length) { toast('記録がありません'); return; }
  download(`footsteps-${stamp()}.csv`, track.toCSV(), 'text/csv');
};

// --- 描画ループ ---------------------------------------------------------
function frame() {
  view.draw();
  $('rSteps').textContent = track.contacts.length;
  $('rLen').textContent = track.lineLength().toFixed(2);
  $('rL').textContent = state.L;
  $('rR').textContent = state.R;
  $('rRecN').textContent = track.recorded.length;
  requestAnimationFrame(frame);
}
frame();
