const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const hiddenCanvas = document.getElementById('hiddenCanvas');
const hCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
const startBtn = document.getElementById('start-btn');
const startOverlay = document.getElementById('start-overlay');
const stringContainer = document.getElementById('current-string-container');

let detector, src, gray, corners, ids;

// ── 解像度・比率設定 ──
const FULL_W = 1280;
const FULL_H = 720;
const DISP_W = 1200;
const DISP_H = 600; // 2:1 スクリーン
const OFFSET_Y = FULL_H - DISP_H; // 下部切り取り用

startBtn.addEventListener('click', async () => {
    if (!cvReady) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: FULL_W, height: FULL_H, facingMode: 'environment' }
        });
        video.srcObject = stream;
        
        await new Promise((resolve) => {
            video.onloadedmetadata = () => { video.play().then(resolve); };
        });

        // ArUco 3パラメータ初期化
        const dictionary = cv.getPredefinedDictionary(cv.DICT_4X4_250);
        const detectorParams = new cv.aruco_DetectorParameters();
        const refineParams = new cv.aruco_RefineParameters(10, 3, true);
        detector = new cv.aruco_ArucoDetector(dictionary, detectorParams, refineParams);

        // メモリ確保
        src = new cv.Mat(FULL_H, FULL_W, cv.CV_8UC4);
        gray = new cv.Mat();
        corners = new cv.MatVector();
        ids = new cv.Mat();

        hiddenCanvas.width = FULL_W;
        hiddenCanvas.height = FULL_H;
        startOverlay.style.display = 'none';
        
        requestAnimationFrame(processFrame);
    } catch (err) { console.error(err); }
});

function processFrame() {
    if (!detector) return;
    canvas.width = DISP_W;
    canvas.height = DISP_H;

    // カメラ映像を下部2:1に合わせて描画
    hCtx.drawImage(video, 0, 0, FULL_W, FULL_H);
    const scale = DISP_W / FULL_W;
    ctx.drawImage(hiddenCanvas, 0, -OFFSET_Y * scale, DISP_W, FULL_H * scale);

    try {
        // 画像解析
        const imgData = hCtx.getImageData(0, 0, FULL_W, FULL_H);
        src.data.set(imgData.data);
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        detector.detectMarkers(gray, corners, ids);

        let detected = [];
        if (ids.rows > 0) {
            for (let i = 0; i < ids.rows; i++) {
                const c = corners.get(i).data32F;
                const char = CONFIG.CHARS[ids.intAt(i, 0)] || "?";

                // 中心点 (1280x720)
                const cx = (c[0] + c[2] + c[4] + c[6]) / 4;
                const cy = (c[1] + c[3] + c[5] + c[7]) / 4;
                
                // 角度 (物理的な傾き)
                const angle = Math.atan2(c[3] - c[1], c[2] - c[0]);

                // 表示座標系（ARウィンドウ内）の座標
                const renderX = cx * scale;
                const renderY = (cy - OFFSET_Y) * scale;

                // 描画 (角度補正なし、そのまま)
                drawArChar(char, renderX, renderY, angle);

                // 上部表示用のデータ保存
                detected.push({ char, x: renderX, angle: angle });
            }
        }

        // 上部テキストエリアの更新
        updateUpperText(detected);

    } catch (e) { console.error(e); }

    requestAnimationFrame(processFrame);
}

/**
 * 下部スクリーンへの描画：原点は「底辺中央」
 */
function drawArChar(text, x, y, angle) {
    ctx.save();
    
    // 【重要】座標原点を「中央下」にセット（ハード側都合）
    ctx.translate(DISP_W / 2, DISP_H);
    
    // キャンバス上の絶対座標を、原点(中央下)からの相対座標に変換
    const relX = x - DISP_W / 2;
    const relY = y - DISP_H;

    ctx.translate(relX, relY);
    ctx.rotate(angle); // ブロックの物理角度そのまま

    ctx.font = 'bold 160px "Hiragino Mincho ProN", "Hiragino Mincho Pro", serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 20;
    ctx.fillStyle = "white";
    ctx.fillText(text, 0, 0);

    ctx.restore();
}

/**
 * 上部エリアへの一文字ずつのレンダリング：角度をCSS Transformで同期
 */
function updateUpperText(detectedArray) {
    // 左から順に並べる
    detectedArray.sort((a, b) => a.x - b.x);

    if (detectedArray.length === 0) {
        // 何も検知されていない場合は案内を表示
        if (stringContainer.innerHTML !== '<span style="color:#444;">---</span>') {
            stringContainer.innerHTML = '<span style="color:#444;">---</span>';
        }
        return;
    }

    // HTMLを生成（差分更新ではなく全書き換えだがSpanなので高速）
    stringContainer.innerHTML = "";
    detectedArray.forEach(d => {
        const span = document.createElement("span");
        span.className = "sync-char-span";
        span.textContent = d.char;
        
        // OpenCVのラジアン角度をそのままCSSの回転に適用
        // transform: rotate(N rad)
        span.style.transform = `rotate(${d.angle}rad)`;
        
        stringContainer.appendChild(span);
    });
}