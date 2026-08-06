// Web Serial トランスポート（有線モード）。
// USBのCP2102から「1行1JSON」を読み、最新値を serial.latest に置く。
// 画面に「⇄ USB」ボタンを自動で出し、クリックでポート選択→接続。
// Chrome/Edge のデスクトップ限定（Safari/Firefox非対応）。
class SerialSource {
  constructor() {
    this.latest = null;      // 直近のJSONオブジェクト（fetch応答と同じ形）
    this.active = false;
    this.port = null;
    this._injectButton();
  }

  get supported() { return 'serial' in navigator; }

  _injectButton() {
    const mount = () => {
      if (document.getElementById('serialBtn')) return;
      const b = document.createElement('button');
      b.id = 'serialBtn';
      b.type = 'button';
      b.textContent = '⇄ USB';
      b.title = 'USB(有線)でESP32に接続';
      Object.assign(b.style, {
        position: 'fixed', right: '12px', bottom: '12px', zIndex: '9999',
        font: '12px system-ui, sans-serif', padding: '6px 13px', borderRadius: '999px',
        border: '1px solid rgba(128,128,128,0.35)', background: 'rgba(255,255,255,0.6)',
        color: '#333', cursor: 'pointer', backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      });
      if (!this.supported) {
        b.disabled = true; b.style.opacity = '0.4';
        b.title = 'このブラウザはWeb Serial非対応（Chrome/Edge推奨）';
      }
      b.addEventListener('click', () => this.connect());
      document.body.appendChild(b);
      this._btn = b;
    };
    if (document.body) mount();
    else addEventListener('DOMContentLoaded', mount);
  }

  _setBtn(text, bg, fg) {
    if (!this._btn) return;
    this._btn.textContent = text;
    this._btn.style.background = bg;
    this._btn.style.color = fg;
  }

  async connect() {
    if (!this.supported || this.active) return;
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });
      this.active = true;
      this._setBtn('⇄ USB ●', '#2aa860', '#fff');
      this._readLoop();
    } catch (_) {
      // ユーザーがキャンセル、または開けなかった（他アプリがポート占有等）
      this._setBtn('⇄ USB ✕', 'rgba(212,64,79,0.15)', '#c0392b');
      setTimeout(() => { if (!this.active) this._setBtn('⇄ USB', 'rgba(255,255,255,0.6)', '#333'); }, 2000);
    }
  }

  async _readLoop() {
    const dec = new TextDecoderStream();
    const closed = this.port.readable.pipeTo(dec.writable).catch(() => {});
    const reader = dec.readable.getReader();
    let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line.startsWith('{')) {
            try { this.latest = JSON.parse(line); } catch (_) {}
          }
        }
        if (buf.length > 4096) buf = '';   // 化け対策
      }
    } catch (_) {
    } finally {
      reader.releaseLock();
      await closed;
      try { await this.port.close(); } catch (_) {}
      this.active = false;
      this.latest = null;
      this._setBtn('⇄ USB', 'rgba(255,255,255,0.6)', '#333');
    }
  }
}

export const serial = new SerialSource();
