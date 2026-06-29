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
const suggestionsList = document.createElement("div");
const noteInput = document.querySelector("#noteInput");
const proximityToggle = document.querySelector("#proximityToggle");
const proximityRadius = document.querySelector("#proximityRadius");
const proximityStatus = document.querySelector("#proximityStatus");
const nearbyList = document.querySelector("#nearbyList");
const mapCanvas = document.querySelector("#mapCanvas");
const mapDetail = document.querySelector("#mapDetail");
const historyList = document.querySelector("#historyList");
const historySearch = document.querySelector("#historySearch");
const historyFrom = document.querySelector("#historyFrom");
const historyTo = document.querySelector("#historyTo");
const locatedOnly = document.querySelector("#locatedOnly");
const resetFiltersButton = document.querySelector("#resetFiltersButton");
const exportCsvButton = document.querySelector("#exportCsvButton");
const exportJsonButton = document.querySelector("#exportJsonButton");
const historySummary = document.querySelector("#historySummary");

const STORAGE_KEY = "flower-position-observations";
const DELETED_STORAGE_KEY = "flower-position-deleted-observations";
const PROXIMITY_STORAGE_KEY = "flower-position-proximity-settings";
const WRITE_TOKEN_STORAGE_KEY = "flower-position-write-token";
const API_URL = "/api/observations";
const CANONICAL_HOST = "flower.qinyibin.com";

if (["qinyibin.com", "www.qinyibin.com"].includes(window.location.hostname)) {
  window.location.replace(`https://${CANONICAL_HOST}${window.location.pathname}${window.location.search}${window.location.hash}`);
}

suggestionsList.className = "suggestions-list";
resultCard.append(suggestionsList);

let currentPhoto = "";
let currentLocation = null;
let currentResult = null;
let deferredInstallPrompt = null;
let selectedMapObservationId = "";
let proximityWatchId = null;
let lastProximityPosition = null;
let lastNearbyIds = new Set();
let lastNotificationTimes = new Map();

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

function loadDeletedObservationIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELETED_STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveDeletedObservationIds(ids) {
  localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify([...ids]));
}

function loadProximitySettings() {
  try {
    return {
      enabled: false,
      radius: 100,
      ...JSON.parse(localStorage.getItem(PROXIMITY_STORAGE_KEY) || "{}"),
    };
  } catch {
    return { enabled: false, radius: 100 };
  }
}

function saveProximitySettings(settings) {
  localStorage.setItem(PROXIMITY_STORAGE_KEY, JSON.stringify(settings));
}

function setupWriteTokenFromHash() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const token = hash.get("setup");
  if (!token) return;
  localStorage.setItem(WRITE_TOKEN_STORAGE_KEY, token.trim());
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

function writeToken() {
  return localStorage.getItem(WRITE_TOKEN_STORAGE_KEY) || "";
}

function canWriteCloud() {
  return Boolean(writeToken());
}

function writeHeaders(extraHeaders = {}) {
  const token = writeToken();
  return token ? { ...extraHeaders, "X-Write-Token": token } : extraHeaders;
}

function writeAccessErrorMessage(error) {
  return error.message === "write-forbidden" ? "此设备未授权保存" : "云端保存失败，本机已保留";
}

function createObservationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `observation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanObservation(observation) {
  const { pendingSync, ...cleanedObservation } = observation;
  return cleanedObservation;
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
      ...writeHeaders({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
    },
    body: JSON.stringify({ observation }),
  });
  if (response.status === 403) throw new Error("write-forbidden");
  if (!response.ok) throw new Error("Failed to save observation");
  return response.json();
}

async function identifyPlant(photo) {
  const response = await fetch("/api/identify", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ photo }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "识别失败");
  }
  return data.result;
}

async function updateCloudObservation(observation) {
  const response = await fetch(`${API_URL}/${encodeURIComponent(observation.id)}`, {
    method: "PUT",
    headers: {
      ...writeHeaders({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
    },
    body: JSON.stringify({ observation }),
  });
  if (response.status === 403) throw new Error("write-forbidden");
  if (!response.ok) throw new Error("Failed to update observation");
  return response.json();
}

async function deleteCloudObservation(observationId) {
  const response = await fetch(`${API_URL}/${encodeURIComponent(observationId)}`, {
    method: "DELETE",
    headers: writeHeaders(),
  });
  if (response.status === 403) throw new Error("write-forbidden");
  if (!response.ok) throw new Error("Failed to delete observation");
}

async function clearCloudObservations() {
  const response = await fetch(API_URL, { method: "DELETE", headers: writeHeaders() });
  if (response.status === 403) throw new Error("write-forbidden");
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

function historyFilters() {
  return {
    query: historySearch.value.trim().toLowerCase(),
    from: historyFrom.value ? new Date(`${historyFrom.value}T00:00:00`) : null,
    to: historyTo.value ? new Date(`${historyTo.value}T23:59:59.999`) : null,
    locatedOnly: locatedOnly.checked,
  };
}

function matchesHistoryFilters(item, filters = historyFilters()) {
  const createdAt = new Date(item.createdAt);
  if (filters.from && createdAt < filters.from) return false;
  if (filters.to && createdAt > filters.to) return false;
  if (filters.locatedOnly && !observationLocation(item)) return false;

  if (!filters.query) return true;
  const haystack = [
    item.name,
    item.latin,
    item.note,
    ...(item.traits || []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(filters.query);
}

function filteredObservations(items = loadLocalObservations()) {
  const filters = historyFilters();
  return items.filter((item) => matchesHistoryFilters(item, filters));
}

function updateHistorySummary(allItems, visibleItems) {
  const locatedCount = visibleItems.filter((item) => observationLocation(item)).length;
  const plantCount = new Set(visibleItems.map((item) => item.name).filter(Boolean)).size;
  historySummary.innerHTML = `
    <span><strong>${visibleItems.length}</strong> 条记录</span>
    <span><strong>${plantCount}</strong> 种名称</span>
    <span><strong>${locatedCount}</strong> 个位置</span>
    ${visibleItems.length !== allItems.length ? `<span>已从 ${allItems.length} 条中筛选</span>` : ""}
  `;
}

function updateNetworkStatus() {
  if (!navigator.onLine) {
    networkStatus.textContent = "离线可记录";
    return;
  }
  networkStatus.textContent = canWriteCloud() ? "已授权设备" : "只读设备";
}

function renderHistory(items = loadLocalObservations()) {
  const visibleItems = filteredObservations(items);
  updateHistorySummary(items, visibleItems);
  renderMap(visibleItems);

  if (!items.length) {
    historyList.innerHTML = '<div class="empty-state">还没有保存记录。</div>';
    return;
  }

  if (!visibleItems.length) {
    historyList.innerHTML = '<div class="empty-state">没有匹配当前筛选的记录。</div>';
    return;
  }

  historyList.innerHTML = visibleItems
    .map((item) => {
      const location = item.location
        ? `${item.location.latitude.toFixed(5)}, ${item.location.longitude.toFixed(5)}`
        : "未记录位置";
      const activeClass = item.id === selectedMapObservationId ? " is-active" : "";
      return `
        <article class="history-item${activeClass}" data-observation-id="${escapeHtml(item.id)}">
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

  if (proximityWatchId !== null && lastProximityPosition) {
    checkNearby({ coords: lastProximityPosition });
  }
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

function distanceMeters(a, b) {
  const earthRadius = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const deltaLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const deltaLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function mapUrl(location) {
  return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
}

function embeddedMapUrl(center, locations) {
  const lats = locations.map((location) => location.latitude);
  const lngs = locations.map((location) => location.longitude);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);
  const spread = Math.max(latSpan, lngSpan);
  const zoom = spread > 0.08 ? 12 : spread > 0.02 ? 14 : 16;
  return `https://maps.google.com/maps?q=${center.latitude},${center.longitude}&z=${zoom}&output=embed`;
}

function renderMap(items = []) {
  const locatedItems = items.filter((item) => observationLocation(item));
  const selectedItem = items.find((item) => item.id === selectedMapObservationId);

  if (!locatedItems.length) {
    mapCanvas.innerHTML = '<div class="map-empty">保存带定位的观察后，这里会出现点位分布。</div>';
    if (selectedItem) {
      renderMapDetail(selectedItem);
      return;
    }
    renderEmptyDetail();
    return;
  }

  const activeItem = locatedItems.find((item) => item.id === selectedMapObservationId) || locatedItems[0];
  const detailItem = selectedItem || activeItem;
  selectedMapObservationId = detailItem.id;

  const locations = locatedItems.map(observationLocation);
  const minLat = Math.min(...locations.map((location) => location.latitude));
  const maxLat = Math.max(...locations.map((location) => location.latitude));
  const minLng = Math.min(...locations.map((location) => location.longitude));
  const maxLng = Math.max(...locations.map((location) => location.longitude));
  const latSpan = Math.max(maxLat - minLat, 0.0008);
  const lngSpan = Math.max(maxLng - minLng, 0.0008);

  const activeLocation = observationLocation(detailItem) || observationLocation(activeItem);
  const pins = locatedItems
    .map((item) => {
      const location = observationLocation(item);
      const x = 8 + ((location.longitude - minLng) / lngSpan) * 84;
      const y = 92 - ((location.latitude - minLat) / latSpan) * 84;
      const activeClass = item.id === detailItem.id ? " is-active" : "";
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
  mapCanvas.className = `map-canvas ${navigator.onLine ? "is-loading" : "is-offline"}`;
  mapCanvas.innerHTML = `
    <iframe
      class="map-frame"
      src="${embeddedMapUrl(activeLocation, locations)}"
      title="观察地图底图"
      loading="lazy"
      referrerpolicy="no-referrer-when-downgrade"
    ></iframe>
    <div class="map-fallback">${navigator.onLine ? "地图加载中，点位仍可点击。" : "离线时显示点位网格，联网后会加载真实地图。"}</div>
    <div class="map-pin-layer">${pins}</div>
  `;
  const frame = mapCanvas.querySelector(".map-frame");
  frame.addEventListener("load", () => {
    mapCanvas.classList.remove("is-loading");
  });

  renderMapDetail(detailItem);
}

function csvValue(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function observationToCsvRow(item) {
  const location = observationLocation(item);
  return [
    item.id,
    item.createdAt,
    item.name,
    item.latin,
    item.confidence,
    item.note,
    location?.latitude ?? "",
    location?.longitude ?? "",
    location?.accuracy ?? "",
  ].map(csvValue).join(",");
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const items = filteredObservations();
  const header = ["id", "createdAt", "name", "latin", "confidence", "note", "latitude", "longitude", "accuracy"]
    .map(csvValue)
    .join(",");
  const rows = items.map(observationToCsvRow);
  downloadText(`flower-observations-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows].join("\n"), "text/csv;charset=utf-8");
}

function exportJson() {
  const items = filteredObservations().map(cleanObservation);
  downloadText(
    `flower-observations-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ exportedAt: new Date().toISOString(), observations: items }, null, 2),
    "application/json;charset=utf-8",
  );
}

function renderMapDetail(item) {
  const location = observationLocation(item);
  const accuracyText = location?.accuracy ? `精度约 ${Math.round(location.accuracy)} 米` : "未记录精度";
  const locationMarkup = location
    ? `
      <p>${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}</p>
      <p>${accuracyText}</p>
    `
    : "<p>未记录位置</p>";
  const mapLinkMarkup = location
    ? `<a class="map-link" href="${mapUrl(location)}" target="_blank" rel="noreferrer">打开地图</a>`
    : "";
  mapDetail.innerHTML = `
    <img src="${escapeHtml(item.photo || "assets/specimen.svg")}" alt="${escapeHtml(item.name)} 观察照片">
    <span class="history-meta">${new Date(item.createdAt).toLocaleString("zh-CN")}</span>
    <h3>${escapeHtml(item.name)}</h3>
    ${locationMarkup}
    <p>${escapeHtml(item.note || "无笔记")}</p>
    <form class="edit-form" data-observation-id="${escapeHtml(item.id)}">
      <label>
        <span class="history-meta">花名</span>
        <input name="name" value="${escapeHtml(item.name)}" autocomplete="off">
      </label>
      <label>
        <span class="history-meta">笔记</span>
        <textarea name="note" rows="3">${escapeHtml(item.note || "")}</textarea>
      </label>
      <div class="detail-actions">
        <button class="map-link" type="submit">保存修改</button>
        <button class="map-link danger-action" type="button" data-delete-observation="${escapeHtml(item.id)}">删除记录</button>
      </div>
    </form>
    ${mapLinkMarkup}
  `;
}

function renderEmptyDetail() {
  mapDetail.innerHTML = `
    <span class="history-meta">Map Detail</span>
    <h3>还没有记录</h3>
    <p>保存观察后，可以在这里编辑花名、笔记或删除单条记录。</p>
  `;
  selectedMapObservationId = "";
}

function renderNearby(items) {
  if (!items.length) {
    nearbyList.innerHTML = "";
    return;
  }

  nearbyList.innerHTML = items
    .map(
      (item) => `
        <button class="nearby-item" type="button" data-observation-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${Math.round(item.distance)} 米</span>
        </button>
      `,
    )
    .join("");
}

function checkNearby(position) {
  const settings = loadProximitySettings();
  const current = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
  lastProximityPosition = current;

  const nearbyItems = loadLocalObservations()
    .map((item) => {
      const location = observationLocation(item);
      if (!location) return null;
      return {
        ...item,
        distance: distanceMeters(current, location),
      };
    })
    .filter((item) => item && item.distance <= settings.radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 6);

  lastNearbyIds = new Set(nearbyItems.map((item) => item.id));
  proximityStatus.textContent = nearbyItems.length
    ? `附近 ${nearbyItems.length} 条`
    : `巡航中，${settings.radius} 米`;
  renderNearby(nearbyItems);
  notifyNearby(nearbyItems);
}

function notifyNearby(items) {
  if (!items.length || !("Notification" in window) || Notification.permission !== "granted") return;

  const now = Date.now();
  const freshItems = items.filter((item) => now - (lastNotificationTimes.get(item.id) || 0) > 30 * 60 * 1000);
  if (!freshItems.length) return;

  const closest = freshItems[0];
  lastNotificationTimes.set(closest.id, now);
  new Notification("附近有记录过的花", {
    body: `${closest.name}，约 ${Math.round(closest.distance)} 米`,
    tag: `flower-nearby-${closest.id}`,
  });
}

async function startProximityWatch() {
  if (!("geolocation" in navigator)) {
    proximityStatus.textContent = "此设备不支持定位";
    return;
  }

  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }

  stopProximityWatch();
  const settings = loadProximitySettings();
  proximityToggle.textContent = "关闭";
  proximityStatus.textContent = "定位中";
  saveProximitySettings({ ...settings, enabled: true, radius: Number(proximityRadius.value) });
  proximityWatchId = navigator.geolocation.watchPosition(
    checkNearby,
    () => {
      proximityStatus.textContent = "定位不可用";
    },
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 },
  );
}

function stopProximityWatch() {
  if (proximityWatchId !== null) {
    navigator.geolocation.clearWatch(proximityWatchId);
    proximityWatchId = null;
  }
  lastNearbyIds = new Set();
  proximityToggle.textContent = "开启";
  proximityStatus.textContent = "未开启";
  renderNearby([]);
}

function updateProximityUi() {
  const settings = loadProximitySettings();
  proximityRadius.value = String(settings.radius || 100);
  if (settings.enabled) {
    startProximityWatch();
  } else {
    stopProximityWatch();
  }
}

function updateLocalObservation(updatedObservation) {
  const items = loadLocalObservations().map((item) =>
    item.id === updatedObservation.id ? updatedObservation : item,
  );
  saveLocalObservations(items);
  renderHistory(items);
}

function removeLocalObservation(observationId) {
  const items = loadLocalObservations().filter((item) => item.id !== observationId);
  if (selectedMapObservationId === observationId) {
    selectedMapObservationId = "";
  }
  saveLocalObservations(items);
  renderHistory(items);
}

async function refreshHistory() {
  const localItems = loadLocalObservations();
  const deletedIds = loadDeletedObservationIds();
  try {
    if (canWriteCloud()) {
      for (const observationId of [...deletedIds]) {
        try {
          await deleteCloudObservation(observationId);
          deletedIds.delete(observationId);
        } catch {
          break;
        }
      }
      saveDeletedObservationIds(deletedIds);
    }

    const activeLocalItems = localItems.filter((item) => !deletedIds.has(item.id));
    const cloudItems = (await fetchCloudObservations()).filter((item) => !deletedIds.has(item.id));
    const pendingItems = activeLocalItems.filter((item) => item.pendingSync);
    const syncedPendingItems = [];

    if (canWriteCloud()) {
      for (const item of pendingItems) {
        try {
          const syncedItem = cleanObservation(item);
          await updateCloudObservation(syncedItem);
          syncedPendingItems.push(syncedItem);
        } catch {
          break;
        }
      }
    }

    const syncedPendingIds = new Set(syncedPendingItems.map((item) => item.id));
    const unresolvedPendingItems = pendingItems.filter((item) => !syncedPendingIds.has(item.id));
    const cloudIds = new Set(cloudItems.map((item) => item.id));
    const localOnlyItems = activeLocalItems.filter((item) => item.id && !cloudIds.has(item.id) && !item.pendingSync);
    const syncedItems = [];

    if (canWriteCloud()) {
      for (const item of localOnlyItems) {
        try {
          const syncedItem = cleanObservation(item);
          await saveCloudObservation(syncedItem);
          syncedItems.push(syncedItem);
        } catch {
          break;
        }
      }
    }

    const mergedItems = mergeObservations(
      [...unresolvedPendingItems, ...syncedPendingItems, ...syncedItems, ...cloudItems],
      activeLocalItems,
    );
    saveLocalObservations(mergedItems);
    renderHistory(mergedItems);
    if (!canWriteCloud()) {
      networkStatus.textContent = "只读设备";
    } else {
      networkStatus.textContent =
        localOnlyItems.length === syncedItems.length && !unresolvedPendingItems.length ? "云端已同步" : "本机记录已保留";
    }
  } catch {
    renderHistory(localItems);
    networkStatus.textContent = navigator.onLine ? "云端连接失败" : "离线可记录";
  }
}

function setResult(result) {
  currentResult = {
    ...result,
    suggestions: result.suggestions || [],
  };
  resultEmpty.hidden = true;
  resultCard.hidden = false;
  confidenceLabel.textContent = `${Math.round(result.confidence * 100)}%`;
  flowerName.textContent = result.name;
  flowerLatin.textContent = result.latin;
  flowerTraits.innerHTML = result.traits.map((trait) => `<li>${trait}</li>`).join("");
  renderSuggestions(currentResult);
}

function renderSuggestions(result) {
  const suggestions = result.suggestions || [];
  if (suggestions.length <= 1) {
    suggestionsList.innerHTML = "";
    return;
  }

  suggestionsList.innerHTML = `
    <span class="history-meta">候选结果</span>
    ${suggestions
      .map((suggestion) => {
        const isActive = suggestion.name === result.name && suggestion.latin === result.latin;
        return `
          <button class="suggestion-option${isActive ? " is-active" : ""}" type="button" data-name="${escapeHtml(suggestion.name)}" data-latin="${escapeHtml(suggestion.latin)}" data-confidence="${suggestion.confidence}">
            <strong>${escapeHtml(suggestion.name)}</strong>
            <span>${escapeHtml(suggestion.latin || "Unknown species")}</span>
            <em>${Math.round((suggestion.confidence || 0) * 100)}%</em>
          </button>
        `;
      })
      .join("")}
  `;
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

identifyButton.addEventListener("click", async () => {
  if (!currentPhoto) {
    resultEmpty.textContent = "请先拍照或选择一张图片。";
    return;
  }

  identifyButton.disabled = true;
  identifyButton.textContent = "识别中";
  resultEmpty.hidden = false;
  resultEmpty.textContent = "正在识别植物...";

  try {
    const result = await identifyPlant(currentPhoto);
    setResult(result);
  } catch (error) {
    resultCard.hidden = true;
    resultEmpty.hidden = false;
    resultEmpty.textContent =
      error.message === "PlantNet API key is not configured"
        ? "还没有配置 PlantNet API key。可以先保存观察，稍后在 Render 环境变量里添加 PLANTNET_API_KEY。"
        : `识别失败：${error.message}`;
  } finally {
    identifyButton.disabled = false;
    identifyButton.textContent = "识别";
  }
});

suggestionsList.addEventListener("click", (event) => {
  const option = event.target.closest(".suggestion-option");
  if (!option || !currentResult) return;

  setResult({
    ...currentResult,
    name: option.dataset.name,
    latin: option.dataset.latin,
    confidence: Number(option.dataset.confidence || currentResult.confidence),
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
    id: createObservationId(),
    createdAt: new Date().toISOString(),
    name: result.name,
    latin: result.latin,
    confidence: result.confidence,
    traits: result.traits,
    suggestions: result.suggestions || [],
    photo: currentPhoto,
    location: currentLocation,
    note: noteInput.value.trim(),
  };
  const items = loadLocalObservations();
  items.unshift(observation);
  saveLocalObservations(items.slice(0, 60));
  noteInput.value = "";
  renderHistory(items);

  if (!canWriteCloud()) {
    networkStatus.textContent = "此设备未授权保存，本机已保留";
    return;
  }

  try {
    await saveCloudObservation(observation);
    networkStatus.textContent = "云端已保存";
    await refreshHistory();
  } catch (error) {
    networkStatus.textContent = writeAccessErrorMessage(error);
  }
});

clearButton.addEventListener("click", async () => {
  saveLocalObservations([]);
  renderHistory();
  if (!canWriteCloud()) {
    networkStatus.textContent = "此设备未授权清空云端";
    return;
  }
  try {
    await clearCloudObservations();
  } catch (error) {
    networkStatus.textContent = error.message === "write-forbidden" ? "此设备未授权清空云端" : "已清空本机";
  }
});

[historySearch, historyFrom, historyTo, locatedOnly].forEach((control) => {
  control.addEventListener("input", () => renderHistory(loadLocalObservations()));
  control.addEventListener("change", () => renderHistory(loadLocalObservations()));
});

resetFiltersButton.addEventListener("click", () => {
  historySearch.value = "";
  historyFrom.value = "";
  historyTo.value = "";
  locatedOnly.checked = false;
  renderHistory(loadLocalObservations());
});

exportCsvButton.addEventListener("click", exportCsv);
exportJsonButton.addEventListener("click", exportJson);

proximityToggle.addEventListener("click", () => {
  const settings = loadProximitySettings();
  if (settings.enabled) {
    saveProximitySettings({ ...settings, enabled: false });
    stopProximityWatch();
  } else {
    startProximityWatch();
  }
});

proximityRadius.addEventListener("change", () => {
  const settings = loadProximitySettings();
  saveProximitySettings({ ...settings, radius: Number(proximityRadius.value) });
  if (settings.enabled && lastProximityPosition) {
    checkNearby({ coords: lastProximityPosition });
  }
});

nearbyList.addEventListener("click", (event) => {
  const item = event.target.closest(".nearby-item");
  if (!item) return;
  selectedMapObservationId = item.dataset.observationId;
  renderHistory(loadLocalObservations());
  document.querySelector(".history-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

mapCanvas.addEventListener("click", (event) => {
  const pin = event.target.closest(".map-pin");
  if (!pin) return;
  selectedMapObservationId = pin.dataset.observationId;
  renderHistory(loadLocalObservations());
});

historyList.addEventListener("click", (event) => {
  const item = event.target.closest(".history-item");
  if (!item) return;
  selectedMapObservationId = item.dataset.observationId;
  renderHistory(loadLocalObservations());
});

mapDetail.addEventListener("submit", async (event) => {
  const form = event.target.closest(".edit-form");
  if (!form) return;
  event.preventDefault();

  const observation = loadLocalObservations().find((item) => item.id === form.dataset.observationId);
  if (!observation) return;

  const updatedObservation = {
    ...observation,
    name: form.elements.name.value.trim() || observation.name,
    note: form.elements.note.value.trim(),
    pendingSync: true,
  };

  updateLocalObservation(updatedObservation);
  if (!canWriteCloud()) {
    networkStatus.textContent = "此设备未授权同步修改";
    return;
  }

  try {
    await updateCloudObservation(cleanObservation(updatedObservation));
    updateLocalObservation(cleanObservation(updatedObservation));
    networkStatus.textContent = "修改已同步";
  } catch (error) {
    networkStatus.textContent = error.message === "write-forbidden" ? "此设备未授权同步修改" : "修改已本机保存";
  }
});

mapDetail.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-observation]");
  if (!deleteButton) return;

  const observationId = deleteButton.dataset.deleteObservation;
  const deletedIds = loadDeletedObservationIds();
  deletedIds.add(observationId);
  saveDeletedObservationIds(deletedIds);
  removeLocalObservation(observationId);
  if (!canWriteCloud()) {
    networkStatus.textContent = "此设备未授权删除云端记录";
    return;
  }

  try {
    await deleteCloudObservation(observationId);
    deletedIds.delete(observationId);
    saveDeletedObservationIds(deletedIds);
    networkStatus.textContent = "记录已删除";
  } catch (error) {
    networkStatus.textContent = error.message === "write-forbidden" ? "此设备未授权删除云端记录" : "已删除本机记录";
  }
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

setupWriteTokenFromHash();
updateNetworkStatus();
refreshHistory();
updateProximityUi();
