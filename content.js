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
const PINCH_DISTANCE_THRESHOLD = 0.016;
const PINCH_COOLDOWN_MS = 500;
let lastPinchTime = 0;
const ROI_X_START = 0.15; // 使用摄像头中央 70%
const ROI_Y_START = 0.30; // 使用摄像头中央 70%
const ROI_WIDTH = 0.7;
const ROI_HEIGHT = 0.7;
const REGION_SIZE = 0.6; // 每个区域覆盖 60% 的屏幕宽高
let activeRegion = { row: 1, col: 1 }; // 默认中心区域 (3x3)
let gazeBaseline = null;
let gazeCooldownUntil = 0;
const GAZE_MOVE_WINDOW_MS = 1000; // 1s 内的相对移动
const GAZE_COOLDOWN_MS = 1000; // 切换后 1s 冷却
const GAZE_MOVE_THRESHOLD = 0.04; // 归一化坐标的阈值

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

let lastHandLandmarks = null;
let lastGazePoint = null;
let indicatorText = null;
let indicatorTimer = null;

// 启动渲染循环
function renderLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制手势
    if (lastHandLandmarks) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#00FF00';
        
        CONNECTIONS.forEach(([i, j]) => {
            const p1 = mapToScreen(lastHandLandmarks[i]);
            const p2 = mapToScreen(lastHandLandmarks[j]);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        });

        ctx.fillStyle = 'red';
        lastHandLandmarks.forEach(point => {
            const mapped = mapToScreen(point);
            ctx.beginPath();
            ctx.arc(mapped.x, mapped.y, 4, 0, 2 * Math.PI);
            ctx.fill();
        });
    }

    // 绘制眼动注视点
    if (lastGazePoint) {
        updateActiveRegionFromGaze(lastGazePoint);
        const mappedGaze = mapToScreen(lastGazePoint);
        ctx.fillStyle = 'blue';
        ctx.beginPath();
        ctx.arc(mappedGaze.x, mappedGaze.y, 10, 0, 2 * Math.PI);
        ctx.fill();
        
        // 绘制十字准星
        ctx.strokeStyle = 'rgba(0, 0, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mappedGaze.x - 20, mappedGaze.y);
        ctx.lineTo(mappedGaze.x + 20, mappedGaze.y);
        ctx.moveTo(mappedGaze.x, mappedGaze.y - 20);
        ctx.lineTo(mappedGaze.x, mappedGaze.y + 20);
        ctx.stroke();
    }

    // 绘制当前激活区域边框
    drawActiveRegion();

    // 绘制指示文字
    if (indicatorText) {
        ctx.fillStyle = 'yellow';
        ctx.font = '40px Arial';
        ctx.fillText(indicatorText, window.innerWidth / 2 - 100, window.innerHeight / 2);
    }

    requestAnimationFrame(renderLoop);
}
renderLoop();

chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'HAND_DATA') {
        lastHandLandmarks = request.landmarks;
        // 逻辑处理仍在收到数据时触发
        handleScroll(request.landmarks);
        handlePinchClick(request.landmarks);
    } else if (request.type === 'GAZE_DATA') {
        lastGazePoint = request.gaze;
    }
});

function handleScroll(landmarks) {
    // 排除食指 (8, 5)，只检查中指、无名指、小指和大拇指是否握拳
    // 这样食指可以自由伸直用于控制方向
    const fingerPairs = [
        [12, 9], // middle
        [16, 13], // ring
        [20, 17]  // pinky
    ];

    const isFist = fingerPairs.every(([tip, mcp]) => landmarks[tip].y > landmarks[mcp].y);
    if (!isFist || !isThumbCurled(landmarks)) return;

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
        scrollAtFinger(landmarks, -scrollSpeed);
        drawIndicator(`⬆️ 向上滚动 ${scrollSpeed.toFixed(0)}`);
    } else if (directionY >= DIRECTION_THRESHOLD) {
        scrollAtFinger(landmarks, scrollSpeed);
        drawIndicator(`⬇️ 向下滚动 ${scrollSpeed.toFixed(0)}`);
    }
}

function scrollAtFinger(landmarks, deltaY) {
    const tip = mapToScreen(landmarks[8]);
    const screenX = tip.x;
    const screenY = tip.y;
    const target = document.elementFromPoint(screenX, screenY);
    if (!target) return;

    const scrollable = findScrollableAncestor(target);
    if (!scrollable) return;

    if (scrollable === document.body || scrollable === document.documentElement) {
        window.scrollBy({ top: deltaY, behavior: 'auto' });
    } else {
        scrollable.scrollTop += deltaY;
    }

    const wheelEvent = new WheelEvent('wheel', {
        deltaY,
        clientX: screenX,
        clientY: screenY,
        bubbles: true,
        cancelable: true
    });
    scrollable.dispatchEvent(wheelEvent);
}

function findScrollableAncestor(element) {
    let node = element;
    while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        const canScroll = /(auto|scroll)/.test(style.overflowY);
        if (canScroll && node.scrollHeight > node.clientHeight) {
            return node;
        }
        node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
}

function handlePinchClick(landmarks) {
    if (isThumbCurled(landmarks)) return;

    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];
    const pinchDistance = distance2D(indexTip, thumbTip);
    if (pinchDistance > PINCH_DISTANCE_THRESHOLD) return;

    const now = performance.now();
    if (now - lastPinchTime < PINCH_COOLDOWN_MS) return;

    const mappedTip = mapToScreen(indexTip);
    const screenX = mappedTip.x;
    const screenY = mappedTip.y;
    const target = document.elementFromPoint(screenX, screenY);
    if (!target) return;

    dispatchClick(target, screenX, screenY);
    lastPinchTime = now;
    drawIndicator('🖱️ 轻点');
}

function dispatchClick(target, x, y) {
    const pointerInit = {
        pointerId: 1,
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y
    };

    const mouseInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y
    };

    target.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
    target.dispatchEvent(new MouseEvent('mousedown', mouseInit));
    target.dispatchEvent(new PointerEvent('pointerup', pointerInit));
    target.dispatchEvent(new MouseEvent('mouseup', mouseInit));
    target.dispatchEvent(new MouseEvent('click', mouseInit));
}

function isThumbCurled(landmarks) {
    // 水平方向：拇指末端(4)与手腕(0)必须在 MCP(2) 的同一侧
    const wrist = landmarks[0];
    const thumbMcp = landmarks[2];
    const thumbTip = landmarks[4];

    const wristSide = wrist.x - thumbMcp.x;
    const tipSide = thumbTip.x - thumbMcp.x;

    return isSameHorizontalSide(tipSide, wristSide);
}

function distance2D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

function isSameHorizontalSide(a, b) {
    if (Math.abs(b) < 0.005) return Math.abs(a) < 0.005;
    return (a >= 0) === (b >= 0);
}

function mapToScreen(point) {
    const { x: normX, y: normY } = normalizePoint(point);

    const regionCenter = getRegionCenter(activeRegion.row, activeRegion.col);
    const regionWidth = window.innerWidth * REGION_SIZE;
    const regionHeight = window.innerHeight * REGION_SIZE;

    const mappedX = regionCenter.x + (normX - 0.5) * regionWidth;
    const mappedY = regionCenter.y + (normY - 0.5) * regionHeight;

    return {
        x: clamp(mappedX, 0, window.innerWidth),
        y: clamp(mappedY, 0, window.innerHeight)
    };
}

function normalizePoint(point) {
    const mirroredX = 1 - point.x;
    const roiX = clamp((mirroredX - ROI_X_START) / ROI_WIDTH, 0, 1);
    const roiY = clamp((point.y - ROI_Y_START) / ROI_HEIGHT, 0, 1);
    return { x: roiX, y: roiY };
}

function getRegionCenter(row, col) {
    const cellWidth = window.innerWidth / 3;
    const cellHeight = window.innerHeight / 3;
    return {
        x: (col + 0.5) * cellWidth,
        y: (row + 0.5) * cellHeight
    };
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function updateActiveRegionFromGaze(gazePoint) {
    const now = performance.now();
    if (now < gazeCooldownUntil) return;

    const { x, y } = normalizePoint(gazePoint);

    if (!gazeBaseline || now - gazeBaseline.time > GAZE_MOVE_WINDOW_MS) {
        gazeBaseline = { x, y, time: now };
        return;
    }

    const dx = x - gazeBaseline.x;
    const dy = y - gazeBaseline.y;

    let moved = false;
    if (dx > GAZE_MOVE_THRESHOLD && activeRegion.col < 2) {
        activeRegion = { row: activeRegion.row, col: activeRegion.col + 1 };
        moved = true;
    } else if (dx < -GAZE_MOVE_THRESHOLD && activeRegion.col > 0) {
        activeRegion = { row: activeRegion.row, col: activeRegion.col - 1 };
        moved = true;
    } else if (dy > GAZE_MOVE_THRESHOLD && activeRegion.row < 2) {
        activeRegion = { row: activeRegion.row + 1, col: activeRegion.col };
        moved = true;
    } else if (dy < -GAZE_MOVE_THRESHOLD && activeRegion.row > 0) {
        activeRegion = { row: activeRegion.row - 1, col: activeRegion.col };
        moved = true;
    }

    if (moved) {
        gazeCooldownUntil = now + GAZE_COOLDOWN_MS;
        gazeBaseline = null;
    }
}

function drawActiveRegion() {
    const center = getRegionCenter(activeRegion.row, activeRegion.col);
    const regionWidth = window.innerWidth * REGION_SIZE;
    const regionHeight = window.innerHeight * REGION_SIZE;
    const x = center.x - regionWidth / 2;
    const y = center.y - regionHeight / 2;

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.6)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(x, y, regionWidth, regionHeight);
    ctx.restore();
}

// 辅助显示：让用户知道触发了滚动
function drawIndicator(text) {
    indicatorText = text;
    if (indicatorTimer) clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => {
        indicatorText = null;
    }, 1000);
}

// 在 renderLoop 中添加绘制文字的逻辑
// (需要手动把这段逻辑加回 renderLoop，或者我再次编辑 renderLoop)

