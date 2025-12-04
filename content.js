console.log("手势插件可视化层已加载");

// 1. 创建一个全屏 Canvas 用于调试显示
const canvas = document.createElement('canvas');
canvas.style.position = 'fixed';
canvas.style.top = '0';
canvas.style.left = '0';
canvas.style.width = '100%';
canvas.style.height = '100%';
canvas.style.pointerEvents = 'none'; // 让鼠标穿透，不影响你正常操作网页
canvas.style.zIndex = '999999'; // 保证在最上层
document.body.appendChild(canvas);

const ctx = canvas.getContext('2d');

// 调整画布分辨率以匹配屏幕
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// 2. 定义手部连接关系 (MediaPipe 的标准骨架连接)
const CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],   // 大拇指
    [0, 5], [5, 6], [6, 7], [7, 8],   // 食指
    [0, 9], [9, 10], [10, 11], [11, 12], // 中指
    [0, 13], [13, 14], [14, 15], [15, 16], // 无名指
    [0, 17], [17, 18], [18, 19], [19, 20], // 小指
    [5, 9], [9, 13], [13, 17] // 手掌横向连接
];


chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'HAND_DATA') {
        const landmarks = request.landmarks;
        
        // --- 绘制逻辑 (保持不变) ---
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#00FF00';
        
        CONNECTIONS.forEach(([i, j]) => {
            const p1 = landmarks[i];
            const p2 = landmarks[j];
            const x1 = (1 - p1.x) * window.innerWidth;
            const y1 = p1.y * window.innerHeight;
            const x2 = (1 - p2.x) * window.innerWidth;
            const y2 = p2.y * window.innerHeight;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        });

        ctx.fillStyle = 'red';
        landmarks.forEach(point => {
            const x = (1 - point.x) * window.innerWidth;
            const y = point.y * window.innerHeight;
            
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, 2 * Math.PI);
            ctx.fill();
        });
        // --- 新增逻辑: 食指单页上下滚动 ---
        handleScroll(landmarks);
    }
});

function handleScroll(landmarks) {
    // 排除食指 (8, 5)，只检查中指、无名指、小指是否握拳
    // 这样食指可以自由伸直用于控制方向
    const fingerPairs = [
        [12, 9], // middle
        [16, 13], // ring
        [20, 17]  // pinky
    ];

    const isFist = fingerPairs.every(([tip, mcp]) => landmarks[tip].y > landmarks[mcp].y);
    if (!isFist) return;

    const indexTip = landmarks[8];
    const indexDip = landmarks[7];
    const indexPip = landmarks[6];

    const vecX = indexTip.x - indexDip.x;
    const vecY = indexTip.y - indexDip.y;
    const magnitude = Math.hypot(vecX, vecY);
    if (magnitude < 0.02) return;

    const directionY = vecY / magnitude;
    const DIRECTION_THRESHOLD = 0.5;

    const vTip = { x: indexTip.x - indexDip.x, y: indexTip.y - indexDip.y };
    const vBase = { x: indexPip.x - indexDip.x, y: indexPip.y - indexDip.y };
    const magTip = Math.hypot(vTip.x, vTip.y);
    const magBase = Math.hypot(vBase.x, vBase.y);
    if (magTip === 0 || magBase === 0) return;

    const dot = vTip.x * vBase.x + vTip.y * vBase.y;
    const angle = Math.acos(Math.min(Math.max(dot / (magTip * magBase), -1), 1)); // radians

    const MAX_SCROLL_SPEED = 40;
    const scrollSpeed = (angle / Math.PI) * MAX_SCROLL_SPEED;

    if (directionY <= -DIRECTION_THRESHOLD) {
        window.scrollBy(0, -scrollSpeed);
        drawIndicator(`⬆️ 向上滚动 ${scrollSpeed.toFixed(0)}`);
    } else if (directionY >= DIRECTION_THRESHOLD) {
        window.scrollBy(0, scrollSpeed);
        drawIndicator(`⬇️ 向下滚动 ${scrollSpeed.toFixed(0)}`);
    }
}

// 辅助显示：让用户知道触发了滚动
function drawIndicator(text) {
    ctx.fillStyle = 'yellow';
    ctx.font = '40px Arial';
    ctx.fillText(text, window.innerWidth / 2 - 100, window.innerHeight / 2);
}
