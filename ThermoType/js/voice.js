// 音声入力(Web Speech API)。キーボードと併用できる。
// 確定した言葉はエディタ末尾に流し込み、認識中の未確定テキストは
// 半透明の<span>としてインラインに見せる（喋りの揺らぎがそのまま見える）。
export class VoiceInput {
  constructor(editor, button, onState) {
    this.editor = editor;
    this.button = button;
    this.onState = onState;      // 'idle' | 'listening' | 'unsupported' | 'denied'
    this.listening = false;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      this.rec = null;
      onState?.('unsupported');
      return;
    }
    this.rec = new SR();
    this.rec.lang = 'ja-JP';
    this.rec.continuous = true;
    this.rec.interimResults = true;

    this.rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this._commit(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      this._showInterim(interim);
    };
    // 無音で勝手に切れるので、ONの間は自動で繋ぎ直す
    this.rec.onend = () => {
      if (this.listening) { try { this.rec.start(); } catch (_) {} }
      else this._showInterim('');
    };
    this.rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.listening = false;
        this.onState?.('denied');
      }
    };
  }

  toggle() {
    if (!this.rec) return;
    this.listening ? this.stop() : this.start();
  }

  start() {
    if (!this.rec || this.listening) return;
    this.listening = true;
    try { this.rec.start(); } catch (_) {}
    this.onState?.('listening');
  }

  stop() {
    if (!this.rec) return;
    this.listening = false;
    this.rec.stop();
    this._showInterim('');
    this.onState?.('idle');
  }

  // 確定テキストをエディタ末尾へ（未確定spanの手前）
  _commit(text) {
    if (!text) return;
    const node = document.createTextNode(text);
    const interim = this._interimEl(false);
    if (interim) this.editor.insertBefore(node, interim);
    else this.editor.appendChild(node);
    this._caretToEnd();
  }

  // 未確定テキストの表示・更新・削除
  _showInterim(text) {
    let el = this._interimEl(false);
    if (!text) { el?.remove(); return; }
    if (!el) el = this._interimEl(true);
    el.textContent = text;
  }

  _interimEl(create) {
    let el = this.editor.querySelector('#interim');
    if (!el && create) {
      el = document.createElement('span');
      el.id = 'interim';
      el.contentEditable = 'false';
      this.editor.appendChild(el);
    }
    return el;
  }

  _caretToEnd() {
    const sel = getSelection();
    const range = document.createRange();
    const interim = this._interimEl(false);
    if (interim) range.setStartBefore(interim);
    else range.selectNodeContents(this.editor), range.collapse(false);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
