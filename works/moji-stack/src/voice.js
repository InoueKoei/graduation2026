// 音声入力モジュール
// SpeechRecognition (Web Speech API) でテキスト認識、
// AnalyserNode (Web Audio API) でリアルタイム音量計測を行う。
//
// 話し始め〜認識確定までの「平均 RMS」を SIZE の範囲にマッピングして
// onResult コールバックへ渡す。onVolume は毎フレーム生の RMS を渡す。

import { SIZE, normalizeVolume } from './fonts.js';

// 平均に含めるかの無音ゲート（これ未満は無音とみなして平均に算入しない）
const NOISE_GATE = 0.01;

export function createVoiceInput({ onResult, onStatus, onVolume }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  let recognition = null;
  let audioCtx    = null;
  let analyser    = null;
  let stream      = null;
  let rafId       = null;
  let active      = false;
  let rmsSum      = 0; // 平均算出用の RMS 合計
  let rmsCount    = 0; // 平均算出用のサンプル数（ゲート超えのみ）

  // ---- 音量計測 -----------------------------------------------------------

  function getRms() {
    if (!analyser) return 0;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  }

  function volumeLoop() {
    const rms = getRms();
    // 無音を除いた、発話中フレームの平均を取る
    if (rms > NOISE_GATE) {
      rmsSum += rms;
      rmsCount++;
    }
    onVolume?.(rms);
    rafId = requestAnimationFrame(volumeLoop);
  }

  // 直近区間の平均 RMS を返してリセットする
  function takeAverageRms() {
    const avg = rmsCount > 0 ? rmsSum / rmsCount : 0;
    rmsSum = 0;
    rmsCount = 0;
    return avg;
  }

  // RMS → フォントサイズ変換（音量の正規化は fonts.js に集約）
  function rmsToSize(rms) {
    const t = normalizeVolume(rms);
    return Math.round(SIZE.min + t * (SIZE.max - SIZE.min));
  }

  // ---- 開始 ---------------------------------------------------------------

  async function start() {
    // マイク権限取得
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      onStatus('マイクへのアクセスが許可されませんでした。');
      return false;
    }

    // Web Audio 初期化
    audioCtx = new AudioContext();
    await audioCtx.resume(); // ユーザージェスチャ直後でも念のため
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    volumeLoop();

    // SpeechRecognition
    active      = true;
    recognition = new SR();
    recognition.lang            = 'ja-JP';
    recognition.continuous      = true;
    recognition.interimResults  = true;  // 認識途中もコールバックを受ける
    recognition.maxAlternatives = 1;

    recognition.addEventListener('result', (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim();
        if (!text) continue;

        if (e.results[i].isFinal) {
          const size = rmsToSize(takeAverageRms());
          onResult(text, size);
        } else {
          // 認識途中: ステータスに表示してフィードバック
          onStatus(`認識中… 「${text}」`);
        }
      }
    });

    recognition.addEventListener('error', (e) => {
      if (e.error === 'not-allowed') {
        onStatus('マイクへのアクセスが拒否されました。');
        stop();
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        onStatus(`音声認識エラー: ${e.error}`);
      }
    });

    // 継続認識のため自動再起動
    recognition.addEventListener('end', () => {
      if (active) {
        try { recognition.start(); } catch { /* すでに起動中 */ }
      }
    });

    recognition.start();
    onStatus('音声入力中… 話しかけてください');
    return true;
  }

  // ---- 停止 ---------------------------------------------------------------

  function stop() {
    active   = false;
    rmsSum   = 0;
    rmsCount = 0;

    if (recognition) { recognition.stop(); recognition = null; }
    if (rafId)       { cancelAnimationFrame(rafId); rafId = null; }
    if (stream)      { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (audioCtx)    { audioCtx.close(); audioCtx = null; }
    analyser = null;
    onVolume?.(0);
  }

  return { start, stop };
}
