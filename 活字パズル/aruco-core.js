// ============================================================
//  aruco-core.js — 活字パズル 共通コア
//  ・OpenCV.js の読み込み
//  ・背面カメラの起動
//  ・ArUco(4x4) マーカーの検出とかな文字への変換
//  ゲーム版 (script.js) と投影用シンプル版 (シンプル版/script.js) の
//  両方から import して使う、ただ一つの「検出ロジックの真実」。
// ============================================================

/**
 * マーカー ID → かな文字の対応表。
 * 物理ブロック裏面の ArUco ID とプリントされた活字を紐づける唯一の定義。
 * ここを直せばゲーム版・シンプル版の双方に反映される。
 */
export const KANA_BY_MARKER_ID = Object.freeze({
  0: 'さ', 1: 'ち', 2: 'い', 3: 'こ', 4: 'く',
  5: 'へ', 6: 'し', 7: 'つ', 8: 'て', 9: 'り',
  10: 'ん', 11: 'ろ', 12: 'る', 13: 'め', 14: 'ぬ', 15: 'き',
});

/**
 * 既定の OpenCV.js CDN（ArUco 対応の 4.10.0 ビルド）。
 * docs.opencv.org の直リンクは 403 を返すため、jsdelivr の
 * @techstark/opencv-js（ArUco 同梱・実績あり）を既定にしている。
 */
export const DEFAULT_OPENCV_URL =
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';

/**
 * OpenCV.js を動的に読み込み、WASM ランタイムの初期化完了を待つ。
 * 二重読み込み・初期化タイミングのズレ・ビルドごとの差（Promise 型 / onRuntimeInitialized 型）・
 * ネットワーク失敗をすべて吸収する。
 * @param {string} [scriptUrl]
 * @returns {Promise<object>} 初期化済みの `cv` オブジェクト
 */
export function loadOpenCv(scriptUrl = DEFAULT_OPENCV_URL) {
  return new Promise((resolve, reject) => {
    // 既に初期化済みなら即座に返す
    if (window.cv?.Mat) {
      resolve(window.cv);
      return;
    }
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.onload = async () => {
      let cv = window.cv;
      if (!cv) {
        reject(new Error('OpenCV.js を読み込みましたが cv が見つかりません'));
        return;
      }
      // techstark ビルドは window.cv に Promise を載せることがある
      if (typeof cv.then === 'function') {
        try {
          cv = await cv;
        } catch (err) {
          reject(err);
          return;
        }
      }
      // スクリプト実行直後は WASM ランタイム未初期化のことがある
      if (cv.Mat) {
        resolve(cv);
      } else {
        cv.onRuntimeInitialized = () => resolve(cv);
      }
    };
    script.onerror = () =>
      reject(new Error('OpenCV.js の読み込みに失敗しました（ネットワーク接続を確認してください）'));
    document.head.appendChild(script);
  });
}

/**
 * 背面カメラ (environment) を起動して video 要素に流し込む。
 * @param {HTMLVideoElement} video
 * @param {{width?:number, height?:number}} [opts]
 * @returns {Promise<MediaStream>}
 */
export async function startEnvironmentCamera(video, { width = 1280, height = 720 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: width },
      height: { ideal: height },
      facingMode: 'environment',
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

/**
 * @typedef {Object} DetectedMarker
 * @property {number} id        マーカー ID
 * @property {string} char      対応するかな文字（未定義は '?'）
 * @property {number} cx        中心 X（入力画像のピクセル座標）
 * @property {number} cy        中心 Y（入力画像のピクセル座標）
 * @property {number} angleRad  上辺(左上→右上)の傾き [rad]
 * @property {Float32Array} corners 4隅の座標 [x0,y0,x1,y1,x2,y2,x3,y3]
 */

/**
 * ArUco(DICT_4X4_250) マーカー検出器。
 * cv.Mat をフレームごとに作らず内部で使い回すことで GC 圧とメモリリークを避ける。
 * 使い終わったら必ず {@link ArucoScanner#dispose} を呼ぶこと。
 */
export class ArucoScanner {
  #cv;
  #dictionary;
  #detectorParams;
  #refineParams;
  #detector;
  #src = null;
  #gray;
  #corners;
  #ids;
  #width = 0;
  #height = 0;

  /** @param {object} cv 初期化済みの OpenCV.js */
  constructor(cv) {
    this.#cv = cv;
    this.#dictionary = cv.getPredefinedDictionary(cv.DICT_4X4_250);
    this.#detectorParams = new cv.aruco_DetectorParameters();
    // RefineParameters(minRepDistance=10, errorCorrectionRate=3, checkAllOrders=true)
    this.#refineParams = new cv.aruco_RefineParameters(10, 3, true);
    this.#detector = new cv.aruco_ArucoDetector(
      this.#dictionary,
      this.#detectorParams,
      this.#refineParams,
    );
    this.#gray = new cv.Mat();
    this.#corners = new cv.MatVector();
    this.#ids = new cv.Mat();
  }

  /** 入力解像度に合わせて RGBA バッファを確保（解像度が変わった時だけ再確保） */
  #ensureBuffer(width, height) {
    if (this.#src && this.#width === width && this.#height === height) return;
    this.#src?.delete();
    this.#src = new this.#cv.Mat(height, width, this.#cv.CV_8UC4);
    this.#width = width;
    this.#height = height;
  }

  /**
   * 1フレーム分の ImageData からマーカーを検出する。
   * @param {ImageData} imageData
   * @returns {DetectedMarker[]}
   */
  detect(imageData) {
    const cv = this.#cv;
    this.#ensureBuffer(imageData.width, imageData.height);
    this.#src.data.set(imageData.data);
    cv.cvtColor(this.#src, this.#gray, cv.COLOR_RGBA2GRAY);
    this.#detector.detectMarkers(this.#gray, this.#corners, this.#ids);

    const markers = [];
    for (let i = 0; i < this.#ids.rows; i++) {
      const id = this.#ids.intAt(i, 0);
      const cornerMat = this.#corners.get(i);
      // data32F は WASM ヒープへのビュー。次フレームで無効化されるためコピーを取る
      const c = cornerMat.data32F.slice(0, 8);
      cornerMat.delete();

      const cx = (c[0] + c[2] + c[4] + c[6]) / 4;
      const cy = (c[1] + c[3] + c[5] + c[7]) / 4;
      const angleRad = Math.atan2(c[3] - c[1], c[2] - c[0]);

      markers.push({ id, char: KANA_BY_MARKER_ID[id] ?? '?', cx, cy, angleRad, corners: c });
    }
    return markers;
  }

  /** 確保した cv.Mat / 検出器をすべて解放する */
  dispose() {
    this.#src?.delete();
    this.#gray?.delete();
    this.#corners?.delete();
    this.#ids?.delete();
    this.#detector?.delete?.();
    this.#dictionary?.delete?.();
    this.#detectorParams?.delete?.();
    this.#refineParams?.delete?.();
    this.#src = this.#gray = this.#corners = this.#ids = null;
  }
}

/** ラジアン → 度 */
export const toDegrees = (rad) => (rad * 180) / Math.PI;
