// background.js

let lastX = null;
let lastSwitchTime = 0;

// 1. 启动离屏文档
chrome.runtime.onInstalled.addListener(async () => {
  await createOffscreen();
});

async function createOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Testing hand gestures'
  });
}

// 2. 核心逻辑
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'HAND_DATA') {
    const landmarks = message.landmarks;
    
    // --- 逻辑 A: 处理 Tab 切换 (四指张开 + 左右挥动) ---
    handleTabSwitch(landmarks);

    // --- 逻辑 B: 转发给 Content (用于绘制和滚动) ---
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
      }
    });
  }
});

function handleTabSwitch(landmarks) {
    const now = Date.now();
    // 冷却时间 1秒，防止误触
    if (now - lastSwitchTime < 1000) return;

    // 1. 简单的姿态识别：判断四指是否张开 (指尖 y < 指根 y，注意坐标系 y 向下为大)
    // 8:食指, 12:中指, 16:无名指, 20:小指
    // 5, 9, 13, 17 分别是对应的指根关节
    const isFourFingersUp = 
        landmarks[8].y < landmarks[5].y &&
        landmarks[12].y < landmarks[9].y &&
        landmarks[16].y < landmarks[13].y &&
        landmarks[20].y < landmarks[17].y;

    if (isFourFingersUp) {
        // 使用手腕(0)的 x 坐标来判断移动
        const currentX = landmarks[0].x;

        if (lastX !== null) {
            const diff = currentX - lastX;
            // 灵敏度阈值：移动超过 0.05 (约屏幕宽度的5%)
            // 注意：摄像头是镜像的，手向右移，x 会变小(还是变大取决于镜像设置)，通常 x 变大是向左(屏幕视角)
            
            if (diff > 0.05) { 
                // 向左挥 (切换到左边的 Tab)
                switchTab(-1);
                lastSwitchTime = now;
            } else if (diff < -0.05) {
                // 向右挥 (切换到右边的 Tab)
                switchTab(1);
                lastSwitchTime = now;
            }
        }
        lastX = currentX;
    } else {
        // 如果手没张开，重置位置记录，防止瞬移误判
        lastX = null;
    }
}

function switchTab(direction) {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
        const activeTab = tabs.find(t => t.active);
        if (!activeTab) return;
        
        let newIndex = activeTab.index + direction;
        // 循环切换逻辑
        if (newIndex < 0) newIndex = tabs.length - 1;
        if (newIndex >= tabs.length) newIndex = 0;
        
        chrome.tabs.update(tabs[newIndex].id, { active: true });
    });
}