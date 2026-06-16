const photoInput = document.querySelector("#photoInput");
const photoPreview = document.querySelector("#photoPreview");
const locateButton = document.querySelector("#locateButton");
const identifyButton = document.querySelector("#identifyButton");
const saveButton = document.querySelector("#saveButton");
const clearButton = document.querySelector("#clearButton");
const installButton = document.querySelector("#installButton");
const locationStatus = document.querySelector("#locationStatus");
const networkStatus = document.querySelector("#networkStatus");
const resultEmpty = document.querySelector("#resultEmpty");
const resultCard = document.querySelector("#resultCard");
const confidenceLabel = document.querySelector("#confidenceLabel");
const flowerName = document.querySelector("#flowerName");
const flowerLatin = document.querySelector("#flowerLatin");
const flowerTraits = document.querySelector("#flowerTraits");
const noteInput = document.querySelector("#noteInput");
const historyList = document.querySelector("#historyList");

const STORAGE_KEY = "flower-position-observations";

const candidates = [
  {
    name: "月季",
    latin: "Rosa chinensis",
    traits: ["花瓣层叠，常见红、粉、白色", "枝条可能有刺", "适合城市绿化和庭院观察"],
  },
  {
    name: "木槿",
    latin: "Hibiscus syriacus",
    traits: ["单花开放时间短", "花心颜色通常更深", "夏秋季常见"],
  },
  {
    name: "紫薇",
    latin: "Lagerstroemia indica",
    traits: ["花瓣皱缩像绉纸", "成簇开放", "树皮较光滑"],
  },
  {
    name: "鸢尾",
    latin: "Iris tectorum",
    traits: ["花被片外翻", "叶片剑形", "常见紫蓝色花"],
  },
];

let currentPhoto = "";
let currentLocation = null;
let currentResult = null;
let deferredInstallPrompt = null;

function loadObservations() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveObservations(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function updateNetworkStatus() {
  networkStatus.textContent = navigator.onLine ? "在线" : "离线可记录";
}

function renderHistory() {
  const items = loadObservations();
  if (!items.length) {
    historyList.innerHTML = '<div class="empty-state">还没有保存记录。</div>';
    return;
  }

  historyList.innerHTML = items
    .map((item) => {
      const location = item.location
        ? `${item.location.latitude.toFixed(5)}, ${item.location.longitude.toFixed(5)}`
        : "未记录位置";
      return `
        <article class="history-item">
          <img src="${item.photo || "assets/specimen.svg"}" alt="${item.name} 观察照片">
          <div>
            <span class="history-meta">${new Date(item.createdAt).toLocaleString("zh-CN")}</span>
            <h3>${item.name}</h3>
            <p>${location}</p>
            <p>${item.note || "无笔记"}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function setResult(result) {
  currentResult = result;
  resultEmpty.hidden = true;
  resultCard.hidden = false;
  confidenceLabel.textContent = `${Math.round(result.confidence * 100)}%`;
  flowerName.textContent = result.name;
  flowerLatin.textContent = result.latin;
  flowerTraits.innerHTML = result.traits.map((trait) => `<li>${trait}</li>`).join("");
}

photoInput.addEventListener("change", () => {
  const [file] = photoInput.files;
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    currentPhoto = reader.result;
    photoPreview.src = currentPhoto;
    resultEmpty.hidden = false;
    resultCard.hidden = true;
    currentResult = null;
  });
  reader.readAsDataURL(file);
});

locateButton.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    locationStatus.textContent = "此设备不支持定位";
    return;
  }

  locationStatus.textContent = "定位中...";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      currentLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      locationStatus.textContent = `${currentLocation.latitude.toFixed(5)}, ${currentLocation.longitude.toFixed(5)}`;
    },
    () => {
      locationStatus.textContent = "定位被拒绝";
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
  );
});

identifyButton.addEventListener("click", () => {
  if (!currentPhoto) {
    resultEmpty.textContent = "请先拍照或选择一张图片。";
    return;
  }

  const index = Math.abs(currentPhoto.length + Date.now()) % candidates.length;
  setResult({
    ...candidates[index],
    confidence: 0.72 + Math.random() * 0.2,
  });
});

saveButton.addEventListener("click", () => {
  const result = currentResult || {
    name: "待识别花卉",
    latin: "Pending identification",
    confidence: 0,
    traits: ["照片已保存，可稍后补充识别结果"],
  };

  const items = loadObservations();
  items.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    name: result.name,
    latin: result.latin,
    confidence: result.confidence,
    traits: result.traits,
    photo: currentPhoto,
    location: currentLocation,
    note: noteInput.value.trim(),
  });
  saveObservations(items.slice(0, 60));
  noteInput.value = "";
  renderHistory();
});

clearButton.addEventListener("click", () => {
  saveObservations([]);
  renderHistory();
});

window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js");
  });
}

updateNetworkStatus();
renderHistory();
