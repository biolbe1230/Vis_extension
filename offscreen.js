import { FilesetResolver, HandLandmarker, FaceLandmarker } from "./vision_bundle.js";

let handLandmarker = undefined;
let faceLandmarker = undefined;
const video = document.getElementById("webcam");
let lastVideoTime = -1;

// 1. 初始化保持不变
async function createLandmarkers() {
  try {
    const vision = await FilesetResolver.forVisionTasks("./wasm");
    
    // 创建手部模型
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numHands: 1
    });

    // 创建面部模型 (用于眼动/头部追踪)
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
        delegate: "GPU"
      },
      outputFaceBlendshapes: false,
      runningMode: "VIDEO",
      numFaces: 1
    });

    console.log("模型加载成功");
    enableCam();
  } catch (error) {
    console.error("模型加载失败:", error);
  }
}

// 2. 开启摄像头
function enableCam() {
  if (!handLandmarker || !faceLandmarker) return;

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
      
      // 并行运行手部和面部检测
      const [handResults, faceResults] = await Promise.all([
          handLandmarker.detectForVideo(video, startTimeMs),
          faceLandmarker.detectForVideo(video, startTimeMs)
      ]);

      // 处理手部数据
      if (handResults.landmarks && handResults.landmarks.length > 0) {
          chrome.runtime.sendMessage({
              type: 'HAND_DATA',
              landmarks: handResults.landmarks[0]
          }).catch(() => {});
      }

      // 处理面部/眼动数据
      if (faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0) {
          const face = faceResults.faceLandmarks[0];
          // 取左右虹膜中心 (468: 左虹膜, 473: 右虹膜) 的平均值作为注视点
          const leftIris = face[468];
          const rightIris = face[473];
          const gazePoint = {
              x: (leftIris.x + rightIris.x) / 2,
              y: (leftIris.y + rightIris.y) / 2
          };

          chrome.runtime.sendMessage({
              type: 'GAZE_DATA',
              gaze: gazePoint
          }).catch(() => {});
      }

  } catch (e) {
      console.log("检测出错:", e);
  }
}

createLandmarkers();