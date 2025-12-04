import { FilesetResolver, HandLandmarker } from "./vision_bundle.js";

let handLandmarker = undefined;
const video = document.getElementById("webcam");
let lastVideoTime = -1;

// 1. 初始化保持不变
async function createHandLandmarker() {
  try {
    const vision = await FilesetResolver.forVisionTasks("./wasm");
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numHands: 1
    });
    console.log("模型加载成功");
    enableCam();
  } catch (error) {
    console.error("模型加载失败:", error);
  }
}

// 2. 开启摄像头
function enableCam() {
  if (!handLandmarker) return;

  navigator.mediaDevices.getUserMedia({ 
      video: { 
          width: 640, 
          height: 480,
          frameRate: { ideal: 30 }
      } 
  }).then((stream) => {
    video.srcObject = stream;
    // 等待视频元数据加载完成
    video.onloadedmetadata = () => {
        video.play();
        console.log(`摄像头已启动: ${video.videoWidth}x${video.videoHeight}`);
        // 改用 setInterval 启动检测循环
        setInterval(predictWebcam, 100); // 每100ms检测一次 (即10FPS，节省性能且足够流畅)
    };
  }).catch(err => {
      console.error("摄像头启动失败:", err);
  });
}

// 3. 检测逻辑
async function predictWebcam() {
  // 确保视频有数据
  if (video.videoWidth === 0 || video.paused) return;

  // 确保时间戳在前进
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  
  try {
      // 使用 performance.now() 作为时间戳
      const startTimeMs = performance.now();
      const results = handLandmarker.detectForVideo(video, startTimeMs);

      // 如果检测到了手
      if (results.landmarks && results.landmarks.length > 0) {
          console.log("🖐️ 抓到了！发送数据..."); // 这一行出现说明成功了
          
          chrome.runtime.sendMessage({
              type: 'HAND_DATA',
              landmarks: results.landmarks[0]
          }).catch(() => {});
      } else {
          // 如果数组是空的，打印个简单的点，证明还在跑，只是没看到手
          console.log("."); 
      }
  } catch (e) {
      console.log("检测出错:", e);
  }
}

createHandLandmarker();