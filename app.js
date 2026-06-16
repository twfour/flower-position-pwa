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
const mapCanvas = document.querySelector("#mapCanvas");
const mapDetail = document.querySelector("#mapDetail");
const historyList = document.querySelector("#historyList");

const STORAGE_KEY = "flower-position-observations";
const API_URL = "/api/observations";

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
let selectedMapObservationId = "";

function loadLocalObservations() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalObservations(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchCloudObservations() {
  const response = await fetch(API_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Failed to load observations");
  const data = await response.json();
  return data.observations || [];
}

async function saveCloudObservation(observation) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ observation }),
  });
  if (!response.ok) throw new Error("Failed to save observation");
  return response.json();
}

async function clearCloudObservations() {
  const response = await fetch(API_URL, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to clear observations");
}

function mergeObservations(primary, fallback) {
  const seen = new Set();
  return [...primary, ...fallback]
    .filter((item) => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100);
}

function updateNetworkStatus() {
  networkStatus.textContent = navigator.onLine ? "在线" : "离线可记录";
}

function renderHistory(items = loadLocalObservations()) {
  renderMap(items);

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
          <img src="${escapeHtml(item.photo || "assets/specimen.svg")}" alt="${escapeHtml(item.name)} 观察照片">
          <div>
            <span class="history-meta">${new Date(item.createdAt).toLocaleString("zh-CN")}</span>
            <h3>${escapeHtml(item.name)}</h3>
            <p>${location}</p>
            <p>${escapeHtml(item.note || "无笔记")}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function observationLocation(item) {
  const location = item?.location;
  if (!location || Number.isNaN(Number(location.latitude)) || Number.isNaN(Number(location.longitude))) {
    return null;
  }
  return {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    accuracy: Number(location.accuracy || 0),
  };
}

function mapUrl(location) {
  return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
}

function renderMap(items = []) {
  const locatedItems = items.filter((item) => observationLocation(item));

  if (!locatedItems.length) {
    mapCanvas.innerHTML = '<div class="map-empty">保存带定位的观察后，这里会出现点位分布。</div>';
    mapDetail.innerHTML = `
      <span class="history-meta">Map Detail</span>
      <h3>还没有定位记录</h3>
      <p>点击“获取位置”后保存观察，就能在地图里看到它。</p>
    `;
    selectedMapObservationId = "";
    return;
  }

  const activeItem =
    locatedItems.find((item) => item.id === selectedMapObservationId) || locatedItems[0];
  selectedMapObservationId = activeItem.id;

  const locations = locatedItems.map(observationLocation);
  const minLat = Math.min(...locations.map((location) => location.latitude));
  const maxLat = Math.max(...locations.map((location) => location.latitude));
  const minLng = Math.min(...locations.map((location) => location.longitude));
  const maxLng = Math.max(...locations.map((location) => location.longitude));
  const latSpan = Math.max(maxLat - minLat, 0.0008);
  const lngSpan = Math.max(maxLng - minLng, 0.0008);

  mapCanvas.innerHTML = locatedItems
    .map((item) => {
      const location = observationLocation(item);
      const x = 8 + ((location.longitude - minLng) / lngSpan) * 84;
      const y = 92 - ((location.latitude - minLat) / latSpan) * 84;
      const activeClass = item.id === activeItem.id ? " is-active" : "";
      return `
        <button
          class="map-pin${activeClass}"
          type="button"
          style="--x: ${x.toFixed(2)}%; --y: ${y.toFixed(2)}%;"
          data-observation-id="${escapeHtml(item.id)}"
          aria-label="查看 ${escapeHtml(item.name)} 的位置"
          title="${escapeHtml(item.name)}"
        ></button>
      `;
    })
    .join("");

  renderMapDetail(activeItem);
}

function renderMapDetail(item) {
  const location = observationLocation(item);
  const accuracyText = location.accuracy ? `精度约 ${Math.round(location.accuracy)} 米` : "未记录精度";
  mapDetail.innerHTML = `
    <img src="${escapeHtml(item.photo || "assets/specimen.svg")}" alt="${escapeHtml(item.name)} 观察照片">
    <span class="history-meta">${new Date(item.createdAt).toLocaleString("zh-CN")}</span>
    <h3>${escapeHtml(item.name)}</h3>
    <p>${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}</p>
    <p>${accuracyText}</p>
    <p>${escapeHtml(item.note || "无笔记")}</p>
    <a class="map-link" href="${mapUrl(location)}" target="_blank" rel="noreferrer">打开地图</a>
  `;
}

async function refreshHistory() {
  const localItems = loadLocalObservations();
  try {
    const cloudItems = await fetchCloudObservations();
    const cloudIds = new Set(cloudItems.map((item) => item.id));
    const localOnlyItems = localItems.filter((item) => item.id && !cloudIds.has(item.id));
    const syncedItems = [];

    for (const item of localOnlyItems) {
      try {
        await saveCloudObservation(item);
        syncedItems.push(item);
      } catch {
        break;
      }
    }

    const mergedItems = mergeObservations([...syncedItems, ...cloudItems], localItems);
    saveLocalObservations(mergedItems);
    renderHistory(mergedItems);
    networkStatus.textContent = localOnlyItems.length === syncedItems.length ? "云端已同步" : "本机记录已保留";
  } catch {
    renderHistory(localItems);
    networkStatus.textContent = navigator.onLine ? "云端连接失败" : "离线可记录";
  }
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

function resizeImage(file, maxSize = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", reject);
    reader.addEventListener("load", () => {
      const image = new Image();
      image.addEventListener("error", reject);
      image.addEventListener("load", () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      });
      image.src = reader.result;
    });
    reader.readAsDataURL(file);
  });
}

photoInput.addEventListener("change", async () => {
  const [file] = photoInput.files;
  if (!file) return;

  try {
    currentPhoto = await resizeImage(file);
    photoPreview.src = currentPhoto;
    resultEmpty.hidden = false;
    resultCard.hidden = true;
    currentResult = null;
  } catch {
    resultEmpty.textContent = "图片读取失败，请换一张照片。";
  }
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

saveButton.addEventListener("click", async () => {
  const result = currentResult || {
    name: "待识别花卉",
    latin: "Pending identification",
    confidence: 0,
    traits: ["照片已保存，可稍后补充识别结果"],
  };

  const observation = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    name: result.name,
    latin: result.latin,
    confidence: result.confidence,
    traits: result.traits,
    photo: currentPhoto,
    location: currentLocation,
    note: noteInput.value.trim(),
  };
  const items = loadLocalObservations();
  items.unshift(observation);
  saveLocalObservations(items.slice(0, 60));
  noteInput.value = "";
  renderHistory(items);

  try {
    await saveCloudObservation(observation);
    networkStatus.textContent = "云端已保存";
    await refreshHistory();
  } catch {
    networkStatus.textContent = "云端保存失败，本机已保留";
  }
});

clearButton.addEventListener("click", async () => {
  saveLocalObservations([]);
  renderHistory();
  try {
    await clearCloudObservations();
  } catch {
    networkStatus.textContent = "已清空本机";
  }
});

mapCanvas.addEventListener("click", (event) => {
  const pin = event.target.closest(".map-pin");
  if (!pin) return;
  selectedMapObservationId = pin.dataset.observationId;
  renderHistory(loadLocalObservations());
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
refreshHistory();
