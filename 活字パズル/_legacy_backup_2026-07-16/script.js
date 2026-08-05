// ── Logging ────────────────────────────────────────────────
const logEl = document.getElementById('log');
function addLog(msg) {
    const s = document.createElement('div');
    s.textContent = msg;
    logEl.prepend(s);
    if (logEl.children.length > 60) logEl.removeChild(logEl.lastChild);
}

// ── Global State ───────────────────────────────────────────
let dictionary, detectorParams, refineParams, detector;
let currentWord = "";
let questionSet = [];
let questionIndex = 0;
let startTime = 0;
let timerInterval = null;

let isCamReady = false;
let isGameRunning = false;
let isFinished = false;

const setupCamBtn    = document.getElementById('setupCamBtn');
const startGameBtn   = document.getElementById('startGameBtn');
const restartBtn     = document.getElementById('restartBtn');
const toggleVidBtn   = document.getElementById('toggleVidBtn');
const checkBtn       = document.getElementById('checkBtn');
const viewContainer  = document.getElementById('viewContainer');
const targetDisplay  = document.getElementById('targetDisplay');
const targetWordText = document.getElementById('targetWordText');
const timerDisplay   = document.getElementById('timerDisplay');
const resultStatus   = document.getElementById('resultStatus');

// ── OpenCV Ready ───────────────────────────────────────────
window.onOpenCvReady = function() {
    cv['onRuntimeInitialized'] = () => {
        dictionary = cv.getPredefinedDictionary(cv.DICT_4X4_250);
        detectorParams = new cv.aruco_DetectorParameters();
        refineParams = new cv.aruco_RefineParameters(10, 3, true);
        detector = new cv.aruco_ArucoDetector(dictionary, detectorParams, refineParams);
        document.getElementById('cvStatus').textContent = 'opencv.js READY';
        setupCamBtn.disabled = false;
    };
};

// ── Functions ──────────────────────────────────────────────

function generateQuestionSet() {
    let set = [];
    [1, 2, 3].forEach(lv => {
        const count = CONFIG.COUNTS[lv];
        const pool = [...CONFIG.LEVELS[lv]];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        set.push(...pool.slice(0, count));
    });
    return set;
}

function updateQuestionDisplay() {
    const target = questionSet[questionIndex];
    if (target) {
        targetWordText.textContent = target;
    } else {
        finishGame();
    }
}

function startTimer() {
    startTime = Date.now();
    timerInterval = setInterval(() => {
        const diff = Date.now() - startTime;
        const m = Math.floor(diff / 60000).toString().padStart(2, '0');
        const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
        timerDisplay.textContent = `Time: ${m}:${s}`;
    }, 1000);
}

function finishGame() {
    clearInterval(timerInterval);
    isGameRunning = false;
    isFinished = true;
    checkBtn.disabled = true;
    viewContainer.style.display = 'none';
    targetDisplay.style.display = 'block';
    
    const finalTime = timerDisplay.textContent;
    targetWordText.textContent = "CLEAR!";
    addLog(`★全問クリア！ ${finalTime}`);
    restartBtn.style.display = 'inline-block';
}

function initGame() {
    questionSet = generateQuestionSet();
    questionIndex = 0;
    isFinished = false;
    isGameRunning = true;
    checkBtn.disabled = false;
    restartBtn.style.display = 'none';
    resultStatus.textContent = ""; 
    updateQuestionDisplay();
    startTimer();
}

// ── Event Listeners ────────────────────────────────────────
const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');

setupCamBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' }
        });
        video.srcObject = stream;
        await video.play();
        isCamReady = true;
        setupCamBtn.disabled = true;
        startGameBtn.disabled = false;
        toggleVidBtn.disabled = false;
        requestAnimationFrame(processFrame);
    } catch (e) { addLog('Camera Error: ' + e.message); }
});

startGameBtn.addEventListener('click', () => {
    startGameBtn.style.display = 'none';
    initGame();
});

restartBtn.addEventListener('click', () => {
    initGame();
});

toggleVidBtn.addEventListener('click', () => {
    if (isFinished) return;
    if (viewContainer.style.display === 'none') {
        viewContainer.style.display = 'block';
        targetDisplay.style.display = 'none';
    } else {
        viewContainer.style.display = 'none';
        targetDisplay.style.display = 'block';
        if (!isGameRunning) targetWordText.textContent = "READY?";
    }
});

checkBtn.addEventListener('click', () => {
    if (!isGameRunning) return;
    const target = questionSet[questionIndex];
    
    if (currentWord === target) {
        // 正解表示
        resultStatus.textContent = "正解";
        resultStatus.style.color = "#52c41a"; // 緑
        addLog(`OK: ${target}`);

        // 0.8秒だけ「正解」を出して次へ
        setTimeout(() => {
            resultStatus.textContent = "";
            questionIndex++;
            updateQuestionDisplay();
        }, 800);

    } else {
        // 不正解表示
        resultStatus.textContent = "不正解";
        resultStatus.style.color = "#ff4d4f"; // 赤
        addLog(`NG: [${currentWord || "空"}]`);

        // 不正解も0.8秒で消す（再チャレンジしやすく）
        setTimeout(() => {
            resultStatus.textContent = "";
        }, 800);
    }
});

// ── Main Process ───────────────────────────────────────────
function processFrame() {
    if (!isCamReady) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0) { requestAnimationFrame(processFrame); return; }
    canvas.width = w; canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    try {
        const rgba = cv.matFromImageData(ctx.getImageData(0, 0, w, h));
        const gray = new cv.Mat();
        cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
        const corners = new cv.MatVector();
        const ids = new cv.Mat();
        detector.detectMarkers(gray, corners, ids);
        let validMarkers = [];
        if (ids.rows > 0) {
            for (let i = 0; i < ids.rows; i++) {
                const markerCorners = corners.get(i);
                const centerX = (markerCorners.data32F[0] + markerCorners.data32F[2] + markerCorners.data32F[4] + markerCorners.data32F[6]) / 4;
                const angle = Math.atan2(markerCorners.data32F[3] - markerCorners.data32F[1], markerCorners.data32F[2] - markerCorners.data32F[0]) * (180 / Math.PI);
                const isStraight = Math.abs(angle) <= CONFIG.ANGLE_LIMIT;
                drawMarker(markerCorners, ids.intAt(i, 0), isStraight);
                if (isStraight) validMarkers.push({ char: CONFIG.CHARS[ids.intAt(i, 0)] || "?", x: centerX });
            }
        }
        validMarkers.sort((a, b) => a.x - b.x);
        currentWord = validMarkers.map(m => m.char).join('');
        document.getElementById('idsList').textContent = currentWord || '— none —';
        rgba.delete(); gray.delete(); corners.delete(); ids.delete();
    } catch (e) { console.error(e); }
    requestAnimationFrame(processFrame);
}

function drawMarker(corners, id, isStraight) {
    const color = isStraight ? "#00FF00" : "#FF0000";
    ctx.strokeStyle = color; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(corners.data32F[0], corners.data32F[1]);
    for (let j = 1; j < 4; j++) ctx.lineTo(corners.data32F[j*2], corners.data32F[j*2+1]);
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle = color; ctx.font = "bold 28px sans-serif";
    ctx.fillText(CONFIG.CHARS[id] || "?", corners.data32F[0], corners.data32F[1] - 10);
}