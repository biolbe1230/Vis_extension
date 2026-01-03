// background.js

let lastSwitchTime = 0;
const injectedTabs = new Set();

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

function ensureContentScript(tabId, callback = () => {}) {
  if (injectedTabs.has(tabId)) {
    callback(true);
    return;
  }

  chrome.scripting.executeScript(
    {
      target: { tabId },
      files: ['content.js']
    },
    () => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.warn('Content injection failed:', err.message);
        injectedTabs.delete(tabId);
        callback(false);
        return;
      }

      injectedTabs.add(tabId);
      callback(true);
    }
  );
}

function sendHandMessage(tabId, payload) {
  chrome.tabs.sendMessage(tabId, payload).catch(() => {
    injectedTabs.delete(tabId);
  });
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  ensureContentScript(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    injectedTabs.delete(tabId);
  }

  if (changeInfo.status === 'complete') {
    ensureContentScript(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

// 2. 核心逻辑
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'HAND_DATA') {
    const landmarks = message.landmarks;
    
    // --- 逻辑 A: 处理 Tab 切换 (剪刀手摆动) ---
    handleTabSwitch(landmarks);

    // --- 逻辑 B: 转发给 Content (用于绘制和滚动) ---
    forwardToContent(message);
  } else if (message.type === 'GAZE_DATA') {
    // --- 逻辑 C: 转发眼动数据给 Content ---
    forwardToContent(message);
  }
});

function forwardToContent(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) return;

      const tabId = tabs[0].id;
      ensureContentScript(tabId, () => {
        sendHandMessage(tabId, message);
      });
    });
}

function handleTabSwitch(landmarks) {
  const now = Date.now();
  // 冷却时间 1秒，防止误触
  if (now - lastSwitchTime < 1000) return;

  // 要求：食指、中指伸直；无名指、小指、大拇指收回
  const indexExtended = landmarks[8].y < landmarks[6].y;
  const middleExtended = landmarks[12].y < landmarks[10].y;
  const ringCurled = landmarks[16].y > landmarks[14].y;
  const pinkyCurled = landmarks[20].y > landmarks[18].y;
  const thumbCurled = isThumbCurled(landmarks);

  if (!(indexExtended && middleExtended && ringCurled && pinkyCurled && thumbCurled)) return;

  // 利用食指、中指的水平朝向决定切换方向
  const indexDir = landmarks[8].x - landmarks[6].x;
  const middleDir = landmarks[12].x - landmarks[10].x;
  const avgDir = (indexDir + middleDir) / 2;
  const DIRECTION_THRESHOLD = 0.02;

  if (avgDir > DIRECTION_THRESHOLD) {
    // 摄像头镜像下，x 增大通常意味着屏幕视角向左
    switchTab(-1);
    lastSwitchTime = now;
  } else if (avgDir < -DIRECTION_THRESHOLD) {
    switchTab(1);
    lastSwitchTime = now;
  }
}

function isThumbCurled(landmarks) {
  // 水平判断：拇指末端(4)与手腕要在 MCP(2) 同一侧
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