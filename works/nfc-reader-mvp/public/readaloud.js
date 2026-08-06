// ============================================================
// 【退避／現在オフ】読み上げ（詠み手）モジュール
// ------------------------------------------------------------
// 出題ごとに「詠みます。」→「な」→(0.5秒)→「書体名」を読み上げ、
// 「な」の発声と同時にお題を表示する機能。テンポ調整のため一旦オフにして
// ここへ切り出した。ロジックは保存してあるので、下記2手順で再有効化できる。
//
// ■ 再有効化の手順
//   1) public/display.html の display.js 読み込みの前に、この行を足す:
//        <script src="readaloud.js"></script>
//      （＋ヘッダーに 🔊 ボタンを戻すなら:
//        <button id="soundBtn" class="btn secondary" title="読み上げ ON/OFF">🔊</button>）
//   2) public/display.js の renderPrompt の末尾を、次のように差し替える:
//        if (body.classList.contains("phase-playing") && window.ReadAloud) {
//          window.ReadAloud.read(promptTitle, els.stage);   // 読み上げ＋同期表示
//        }
//      （合わせて display.css の #stage.prep 用ルールも戻す）
//
// このファイルは display.html から読み込まれていないため、現状は一切動作しない。
// ============================================================
(function () {
  let speechOn = true;
  let jaVoice = null;
  let readSeq = 0; // 出題が変わったら古い読み上げを打ち切る
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function pickVoice() {
    if (!window.speechSynthesis) return;
    const vs = speechSynthesis.getVoices();
    jaVoice = vs.find((v) => v.lang === "ja-JP") || vs.find((v) => /ja/i.test(v.lang)) || null;
  }
  if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  function speak(text) {
    return new Promise((res) => {
      if (!speechOn || !window.speechSynthesis) return res();
      let done = false;
      const finish = () => { if (!done) { done = true; res(); } };
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP";
      if (jaVoice) u.voice = jaVoice;
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
      // 安全弁：onend が来ない環境でも先へ進め、お題が伏せたままになるのを防ぐ
      setTimeout(finish, 1200 + text.length * 120);
    });
  }

  // 出題を読み上げつつ、「な」の発声と同時に stage を表示する
  async function read(title, stage) {
    const mySeq = ++readSeq;
    if (stage) stage.classList.add("prep");
    if (!speechOn || !window.speechSynthesis) { if (stage) stage.classList.remove("prep"); return; }
    try { speechSynthesis.cancel(); } catch (e) {}
    await speak("詠みます。");
    if (mySeq !== readSeq) return;
    if (stage) stage.classList.remove("prep"); // ← 「な」と同時に表示
    await speak("な");
    if (mySeq !== readSeq) return;
    await wait(500);
    if (mySeq !== readSeq) return;
    await speak(title);
  }

  function setEnabled(on) {
    speechOn = !!on;
    if (!speechOn && window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) {} }
    return speechOn;
  }

  window.ReadAloud = { read, setEnabled, toggle: () => setEnabled(!speechOn) };
})();
