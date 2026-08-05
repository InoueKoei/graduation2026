import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ==========================================
// ⚙️ アプリ全体の設定
// ==========================================
const APP_CONFIG = {
    videoWidth: 1280,
    videoHeight: 720,
    threshold: 0.35,      // 判定の厳しさ
    fontSize: 500,        // 判別時の文字サイズ
    lineColor: "#ffffff", // 線の色
    lineWidth: 15,        // 線の太さ
    dotColor: "#00FFCC"   // 関節ドットの色
};

// 🔤 ユーザー指定の略語マッピング辞書
const SHORTCUTS = {
    "H": "head",
    "W": "waist",
    "LH": "l_hand",
    "RH": "r_hand",
    "LE": "l_elbow",
    "RE": "r_elbow",
    "LK": "l_knee",
    "RK": "r_knee",
    "LL": "l_leg",
    "RL": "r_leg"
};
// ==========================================

const SUPABASE_URL = "https://aawkwvxyylioorbeyydx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhd2t3dnh5eWxpb29yYmV5eWR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0MzEzMTYsImV4cCI6MjA5NTAwNzMxNn0.WWdP8PD0fGA-kqidf4kLGilYAfGBTGVdnKc9w5oQ9gA";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const video = document.getElementById("webcam");
const canvas = document.getElementById("output_canvas");
const ctx = canvas.getContext("2d");
const resultDiv = document.getElementById("result");
const registerUi = document.getElementById("register-ui");
const container = document.getElementById("canvas-container"); 

video.width = APP_CONFIG.videoWidth;
video.height = APP_CONFIG.videoHeight;
canvas.width = APP_CONFIG.videoWidth;
canvas.height = APP_CONFIG.videoHeight;
container.style.width = `${APP_CONFIG.videoWidth}px`;
container.style.maxWidth = "100%";
container.style.aspectRatio = `${APP_CONFIG.videoWidth} / ${APP_CONFIG.videoHeight}`;

let poseLandmarker = undefined;
let lastVideoTime = -1;
let latestNormalizedPoints = null; 

let referencePoses = {};
let referenceLines = {};

// コード側のデフォルト設定
const DEFAULT_KANA_LINES = {
    "ア": ["LH-RH", "H-W", "W-LL"],
    "イ": ["H-W", "RE-W", "W-RL"],
    "サ": [
        "LH-RH",         
        "[LH_RH]-W",     
        "RE-RK-RL"       
    ]
};

// モード切り替え
document.querySelectorAll('input[name="app-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.value === 'register') {
            registerUi.style.display = 'block';
            resultDiv.innerText = "登録モード：ポーズをとってDBに登録してください";
        } else {
            registerUi.style.display = 'none';
            resultDiv.innerText = "判別モード：ポーズを探しています...";
        }
    });
});

// DBからデータ読み込み
async function loadReferencePoses() {
    const { data, error } = await supabase.from('poses').select('*');
    if (error) {
        console.error("DB読み込みエラー:", error);
        return;
    }
    data.forEach(row => { 
        referencePoses[row.letter] = row.points;
        referenceLines[row.letter] = row.lines || DEFAULT_KANA_LINES[row.letter] || [];
    });
    console.log("読み込んだポーズ:", referencePoses);
    console.log("読み込んだ線の引き方:", referenceLines);
}

async function initPose() {
    try {
        await loadReferencePoses(); 
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task", delegate: "GPU" },
            runningMode: "VIDEO"
        });
        startCamera();
    } catch (error) {
        console.error("MediaPipe初期化エラー:", error);
    }
}

function startCamera() {
    navigator.mediaDevices.getUserMedia({ video: { width: APP_CONFIG.videoWidth, height: APP_CONFIG.videoHeight } })
    .then((stream) => {
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
    });
}

function getNormalizedCustomPoints(landmarks) {
    const waistX = (landmarks[23].x + landmarks[24].x) / 2;
    const waistY = (landmarks[23].y + landmarks[24].y) / 2;
    const scale = Math.hypot(landmarks[11].x - landmarks[12].x, landmarks[11].y - landmarks[12].y);

    const targetIndices = { "head": 0, "r_hand": 16, "l_hand": 15, "r_elbow": 14, "l_elbow": 13, "r_knee": 26, "l_knee": 25, "r_leg": 28, "l_leg": 27 };
    const normalized = {};
    for (const [name, idx] of Object.entries(targetIndices)) {
        normalized[name] = {
            x: parseFloat(((landmarks[idx].x - waistX) / scale).toFixed(3)),
            y: parseFloat(((landmarks[idx].y - waistY) / scale).toFixed(3))
        };
    }
    normalized["waist"] = { x: 0, y: 0 };
    return normalized;
}

function detectLetter(currentPoints) {
    let bestMatch = null;
    let minError = Infinity;

    for (const [letter, refPoints] of Object.entries(referencePoses)) {
        let totalError = 0;
        let count = 0;
        for (const part in refPoints) {
            if (currentPoints[part] && refPoints[part]) {
                const dx = currentPoints[part].x - refPoints[part].x;
                const dy = currentPoints[part].y - refPoints[part].y;
                totalError += Math.hypot(dx, dy);
                count++;
            }
        }
        const avgError = totalError / count;
        if (avgError < minError) {
            minError = avgError;
            bestMatch = letter;
        }
    }
    return minError < APP_CONFIG.threshold ? bestMatch : null;
}

function getCoordinate(partStr, pixelPoints) {
    if (partStr.startsWith("[") && partStr.endsWith("]")) {
        const inside = partStr.slice(1, -1); 
        const [aliasA, aliasB] = inside.split("_"); 
        
        const realA = SHORTCUTS[aliasA] || aliasA;
        const realB = SHORTCUTS[aliasB] || aliasB;

        if (pixelPoints[realA] && pixelPoints[realB]) {
            return {
                x: (pixelPoints[realA].x + pixelPoints[realB].x) / 2,
                y: (pixelPoints[realA].y + pixelPoints[realB].y) / 2
            };
        }
    }

    const realPartName = SHORTCUTS[partStr] || partStr;
    return pixelPoints[realPartName];
}

async function predictWebcam() {
    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const results = poseLandmarker.detectForVideo(video, performance.now());

        if (results.landmarks && results.landmarks.length > 0) {
            const landmarks = results.landmarks[0]; 
            latestNormalizedPoints = getNormalizedCustomPoints(landmarks);

            const pixelPoints = {};
            const targetIndices = { "head": 0, "r_hand": 16, "l_hand": 15, "r_elbow": 14, "l_elbow": 13, "r_knee": 26, "l_knee": 25, "r_leg": 28, "l_leg": 27 };
            for (const [name, idx] of Object.entries(targetIndices)) {
                pixelPoints[name] = { x: landmarks[idx].x * canvas.width, y: landmarks[idx].y * canvas.height };
            }
            const waistX = (landmarks[23].x + landmarks[24].x) / 2;
            const waistY = (landmarks[23].y + landmarks[24].y) / 2;
            pixelPoints["waist"] = { x: waistX * canvas.width, y: waistY * canvas.height };

            // 関節ドット
            ctx.fillStyle = APP_CONFIG.dotColor; 
            Object.values(pixelPoints).forEach((point) => {
                ctx.beginPath();
                ctx.arc(point.x, point.y, 8, 0, 2 * Math.PI);
                ctx.fill();
            });

            const currentMode = document.querySelector('input[name="app-mode"]:checked').value;

            if (currentMode === "detect") {
                const detectedLetter = detectLetter(latestNormalizedPoints);

                if (detectedLetter) {
                    resultDiv.innerText = `判定結果: 「${detectedLetter}」`;
                    
                    const lines = referenceLines[detectedLetter];
                    
                    // 1. 線のデータが存在する場合のみ一筆書きラインを描画
                    if (lines && lines.length > 0) {
                        ctx.strokeStyle = APP_CONFIG.lineColor; 
                        ctx.lineWidth = APP_CONFIG.lineWidth;   
                        ctx.lineCap = "round";
                        ctx.lineJoin = "round";

                        lines.forEach(lineStr => {
                            const parts = lineStr.split("-"); 
                            const startPt = getCoordinate(parts[0], pixelPoints);
                            if (!startPt) return;

                            ctx.beginPath();
                            ctx.moveTo(startPt.x, startPt.y);
                            
                            for (let i = 1; i < parts.length; i++) {
                                const nextPt = getCoordinate(parts[i], pixelPoints);
                                if (nextPt) ctx.lineTo(nextPt.x, nextPt.y);
                            }
                            ctx.stroke();
                        });
                    } 
                    // 2. 👈【修正】線のデータが無い場合（空配列など）のみ、大きな半透明文字を表示
                    else {
                        ctx.fillStyle = "rgba(0, 0, 0, 0.5)"; 
                        ctx.font = `bold ${APP_CONFIG.fontSize}px sans-serif`; 
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.save();
                        ctx.translate(canvas.width / 2, canvas.height / 2);
                        ctx.scale(-1, 1);
                        ctx.fillText(detectedLetter, 0, 0);
                        ctx.restore();
                    }

                } else {
                    resultDiv.innerText = "ポーズを探しています...";
                }
            }
        }
    }
    window.requestAnimationFrame(predictWebcam);
}

// 送信ボタンの処理
document.getElementById("register-btn").addEventListener("click", async () => {
    try {
        const kanaInput = document.getElementById("kana-input");
        const letter = kanaInput.value.trim();
        if (!letter) { alert("文字を入力してください！"); return; }
        if (!latestNormalizedPoints) { alert("身体が検出されていません。"); return; }

        resultDiv.innerText = "Supabaseにデータを送信中...";
        
        const insertData = { 
            letter: letter, 
            points: latestNormalizedPoints 
        };

        if (DEFAULT_KANA_LINES[letter]) {
            insertData.lines = DEFAULT_KANA_LINES[letter];
        }

        const { error } = await supabase.from('poses').insert([insertData]);
        if (error) throw error; 

        resultDiv.innerText = `✅ 「${letter}」を登録しました！`;
        kanaInput.value = ""; 
        await loadReferencePoses(); 
    } catch (error) {
        console.error("エラー詳細:", error);
        resultDiv.innerText = `❌ エラー: ${error.message}`;
    }
});

initPose();