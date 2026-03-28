import { EmulatorSession } from "./emulator-session.js";
import { initializeTelegramMiniApp } from "./telegram-mini-app.js";

const socket = io({
  autoConnect: true,
});

const TOUCH_BITS = {
  A: 1 << 0,
  B: 1 << 1,
  SELECT: 1 << 2,
  START: 1 << 3,
  UP: 1 << 4,
  DOWN: 1 << 5,
  LEFT: 1 << 6,
  RIGHT: 1 << 7,
};

const MOBILE_DEVICE_RE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

const state = {
  games: [],
  currentRoom: null,
  participant: null,
  currentRoomId: null,
  nickname: localStorage.getItem("nes-switch-online:nickname") || "",
  inputDelayFrames: Number(localStorage.getItem("nes-switch-online:input-delay") || 4),
  isMobileDevice: false,
  fallbackFullscreen: false,
  fullscreenActive: false,
  telegram: null,
};

const refs = {
  libraryView: document.querySelector("#library-view"),
  roomView: document.querySelector("#room-view"),
  catalogCount: document.querySelector("#catalog-count"),
  catalogStatus: document.querySelector("#catalog-status"),
  gameGrid: document.querySelector("#game-grid"),
  emptyLibrary: document.querySelector("#empty-library"),
  refreshLibrary: document.querySelector("#refresh-library"),
  backToLibrary: document.querySelector("#back-to-library"),
  roomTitle: document.querySelector("#room-title"),
  roomSubtitle: document.querySelector("#room-subtitle"),
  copyLink: document.querySelector("#copy-link"),
  toggleFullscreen: document.querySelector("#toggle-fullscreen"),
  screenFullscreenButton: document.querySelector("#screen-fullscreen-button"),
  exitMobileFullscreen: document.querySelector("#exit-mobile-fullscreen"),
  roomCover: document.querySelector("#room-cover"),
  nicknameInput: document.querySelector("#nickname-input"),
  inputDelay: document.querySelector("#input-delay"),
  readySummary: document.querySelector("#ready-summary"),
  statusTitle: document.querySelector("#status-title"),
  playersList: document.querySelector("#players-list"),
  toggleReady: document.querySelector("#toggle-ready"),
  startSession: document.querySelector("#start-session"),
  pauseSession: document.querySelector("#pause-session"),
  resumeSession: document.querySelector("#resume-session"),
  stopSession: document.querySelector("#stop-session"),
  screenOverlay: document.querySelector("#screen-overlay"),
  emulatorMount: document.querySelector("#emulator-mount"),
  frameIndicator: document.querySelector("#frame-indicator"),
  syncIndicator: document.querySelector("#sync-indicator"),
  latencyIndicator: document.querySelector("#latency-indicator"),
  mobileHandheld: document.querySelector("#mobile-handheld"),
  mobileRoomBadge: document.querySelector("#mobile-room-badge"),
  touchDpad: document.querySelector("#touch-dpad"),
  touchButtons: Array.from(document.querySelectorAll("[data-touch-bit]")),
  fullscreenButtons: [
    document.querySelector("#toggle-fullscreen"),
    document.querySelector("#screen-fullscreen-button"),
  ].filter(Boolean),
};

const emulator = new EmulatorSession({
  mount: refs.emulatorMount,
  overlay: refs.screenOverlay,
  frameEl: refs.frameIndicator,
  syncEl: refs.syncIndicator,
  statusEl: refs.statusTitle,
  latencyEl: refs.latencyIndicator,
});

const touchBitCounts = new Map();
const touchButtonPointers = new WeakMap();
const dpadPointerMasks = new Map();

let latencyInterval = null;
let lastHapticAt = 0;

function parseRoute() {
  const match = window.location.pathname.match(/^\/room\/([A-Z0-9]+)$/i);
  return match
    ? { kind: "room", roomId: match[1].toUpperCase() }
    : { kind: "library" };
}

function navigate(pathName, { replace = false } = {}) {
  if (replace) {
    window.history.replaceState({}, "", pathName);
  } else {
    window.history.pushState({}, "", pathName);
  }
  void syncRoute();
}

function showToast(message) {
  refs.catalogStatus.textContent = message;
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function setView(kind) {
  refs.libraryView.classList.toggle("hidden", kind !== "library");
  refs.roomView.classList.toggle("hidden", kind !== "room");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function detectMobileDevice() {
  const telegramPlatform = window.Telegram?.WebApp?.platform;
  if (telegramPlatform === "android" || telegramPlatform === "android_x" || telegramPlatform === "ios") {
    return true;
  }

  if (typeof navigator.userAgentData?.mobile === "boolean") {
    return navigator.userAgentData.mobile;
  }

  if (MOBILE_DEVICE_RE.test(navigator.userAgent)) {
    return true;
  }

  return window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 1100;
}

function isFullscreenActive() {
  return (
    document.fullscreenElement === refs.roomView ||
    state.fallbackFullscreen ||
    Boolean(state.telegram?.isFullscreenActive?.())
  );
}

function buildShareUrl(room) {
  const fallbackUrl = `${window.location.origin}${room.sharePath}`;
  return state.telegram?.buildShareUrl?.(room.id, fallbackUrl) || fallbackUrl;
}

function mergeCurrentRoomGame() {
  if (!state.currentRoom?.game) {
    return;
  }

  const latest = state.games.find((game) => game.id === state.currentRoom.game.id);
  if (latest) {
    state.currentRoom.game = latest;
  }
}

function renderFullscreenButtons(fullscreenActive) {
  if (refs.toggleFullscreen) {
    refs.toggleFullscreen.textContent = fullscreenActive ? "Выйти из полноэкранного" : "Во весь экран";
  }

  if (refs.screenFullscreenButton) {
    refs.screenFullscreenButton.textContent = fullscreenActive ? "×" : "FS";
  }
}

function refreshEmulatorLayout() {
  window.requestAnimationFrame(() => {
    emulator.refreshLayout?.();
  });
}

function updateFullscreenUi() {
  const hasRoom = Boolean(state.currentRoom);
  const fullscreenActive = hasRoom && isFullscreenActive();
  const mobileControlsActive = state.isMobileDevice && hasRoom && fullscreenActive;
  const mobileOverlayActive = mobileControlsActive;
  state.fullscreenActive = fullscreenActive;

  document.body.classList.toggle("is-mobile-device", state.isMobileDevice);
  document.body.classList.toggle("is-mobile-fullscreen", mobileOverlayActive);
  refs.roomView.classList.toggle("room-view--fullscreen-active", fullscreenActive);
  refs.roomView.classList.toggle("room-view--mobile-controls", mobileControlsActive);
  refs.roomView.classList.toggle("room-view--mobile-fs", mobileOverlayActive);
  refs.mobileHandheld.classList.toggle("hidden", !mobileControlsActive);
  refs.mobileHandheld.setAttribute("aria-hidden", String(!mobileControlsActive));
  refs.exitMobileFullscreen.classList.toggle("hidden", !mobileOverlayActive);

  const showFullscreenButtons = hasRoom;
  for (const button of refs.fullscreenButtons) {
    button.classList.toggle("hidden", !showFullscreenButtons);
    button.setAttribute("aria-label", fullscreenActive ? "Выйти из полного экрана" : "Открыть на весь экран");
  }

  renderFullscreenButtons(fullscreenActive);
  syncFullscreenButtonLabels(fullscreenActive);
  state.telegram?.syncUi?.({
    inRoom: hasRoom,
    fullscreenActive,
    running: state.currentRoom?.status === "running",
  });
  refreshEmulatorLayout();
}

function refreshDeviceMode() {
  state.isMobileDevice = detectMobileDevice();
  updateFullscreenUi();
}

function vibrateTap(duration = 14) {
  if (!state.isMobileDevice || typeof navigator.vibrate !== "function") {
    return;
  }

  const now = performance.now();
  if (now - lastHapticAt < 45) {
    return;
  }

  lastHapticAt = now;
  navigator.vibrate(duration);
}

async function tryLockHandheldOrientation() {
  const lockedByTelegram = await state.telegram?.lockOrientation?.();
  if (lockedByTelegram) {
    return;
  }

  try {
    await screen.orientation?.lock?.("portrait-primary");
  } catch {
    try {
      await screen.orientation?.lock?.("portrait");
    } catch {
      // Optional browser feature.
    }
  }
}

async function tryUnlockOrientation() {
  const unlockByTelegram = await state.telegram?.unlockOrientation?.();
  if (unlockByTelegram) {
    return;
  }

  try {
    screen.orientation?.unlock?.();
  } catch {
    // Optional browser feature.
  }
}

async function enterFullscreenMode() {
  if (!state.currentRoomId) {
    return;
  }

  if (state.telegram?.isMiniApp) {
    const entered = await state.telegram.requestFullscreen?.();
    if (state.isMobileDevice) {
      await tryLockHandheldOrientation();
    }
    updateFullscreenUi();
    if (entered || state.telegram.isFullscreenActive?.()) {
      return;
    }
  }

  state.fallbackFullscreen = false;
  refs.roomView.classList.remove("room-view--fallback-fullscreen");

  if (document.fullscreenElement !== refs.roomView && typeof refs.roomView.requestFullscreen === "function") {
    try {
      await refs.roomView.requestFullscreen({ navigationUI: "hide" });
    } catch {
      state.fallbackFullscreen = true;
      refs.roomView.classList.add("room-view--fallback-fullscreen");
    }
  } else if (document.fullscreenElement !== refs.roomView) {
    state.fallbackFullscreen = true;
    refs.roomView.classList.add("room-view--fallback-fullscreen");
  }

  if (state.isMobileDevice) {
    await tryLockHandheldOrientation();
  }

  updateFullscreenUi();
}

async function exitFullscreenMode() {
  state.fallbackFullscreen = false;
  refs.roomView.classList.remove("room-view--fallback-fullscreen");

  if (state.telegram?.isMiniApp) {
    const exited = await state.telegram.exitFullscreen?.();
    if (state.isMobileDevice) {
      await tryUnlockOrientation();
    }
    updateFullscreenUi();
    if (exited || !state.telegram.isFullscreenActive?.()) {
      return;
    }
  }

  if (document.fullscreenElement === refs.roomView && typeof document.exitFullscreen === "function") {
    try {
      await document.exitFullscreen();
    } catch {
      // Ignore exit failures.
    }
  }

  if (state.isMobileDevice) {
    await tryUnlockOrientation();
  }

  updateFullscreenUi();
}

async function toggleFullscreenMode() {
  vibrateTap(18);
  if (state.fullscreenActive) {
    await exitFullscreenMode();
  } else {
    await enterFullscreenMode();
  }
}

function renderCatalog() {
  refs.catalogCount.textContent = `${state.games.length} игр`;
  refs.catalogStatus.textContent = state.games.length ? "Готово к игре" : "Библиотека пуста";

  refs.emptyLibrary.classList.toggle("hidden", state.games.length > 0);
  refs.gameGrid.innerHTML = "";

  for (const game of state.games) {
    const card = document.createElement("article");
    card.className = "game-card";
    card.innerHTML = `
      <div class="game-card__cover">
        <img src="${game.coverUrl}" alt="${escapeHtml(game.title)}" loading="lazy" />
      </div>
      <div class="game-card__meta">
        <h3 class="game-card__title">${escapeHtml(game.title)}</h3>
        <div class="game-card__tags">
          <span>Маппер ${game.mapper}</span>
          <span>${game.prgKb} KB</span>
        </div>
      </div>
      <div class="game-card__actions">
        <button class="primary-button" type="button">Играть</button>
      </div>
    `;

    card.querySelector("button").addEventListener("click", async () => {
      try {
        const payload = await fetchJson("/api/rooms", {
          method: "POST",
          body: JSON.stringify({ gameId: game.id }),
        });
        navigate(payload.room.sharePath);
      } catch (error) {
        showToast(error.message);
      }
    });

    refs.gameGrid.appendChild(card);
  }
}

function renderPlayers(room) {
  refs.playersList.innerHTML = "";

  if (!room?.players?.length) {
    refs.playersList.innerHTML = `<p class="control-line">Комната пустая.</p>`;
    return;
  }

  for (const player of room.players) {
    const card = document.createElement("div");
    const statusClass = player.ready ? "player-card__status--ready" : "player-card__status--waiting";
    card.className = "player-card";
    card.innerHTML = `
      <div>
        <p class="player-card__name">${escapeHtml(player.name)}${player.isHost ? " • Хост" : ""}</p>
        <p class="player-card__slot">${player.spectator ? "Наблюдатель" : `Игрок ${player.slot}`}</p>
      </div>
      <div class="player-card__status ${statusClass}">
        ${player.spectator ? "Смотрит" : player.ready ? "Готов" : "Ждёт"}
      </div>
    `;
    refs.playersList.appendChild(card);
  }
}

function renderRoom() {
  const room = state.currentRoom;
  const participant = state.participant;
  refs.copyLink.textContent = state.telegram?.botUsername ? "Скопировать TG-ссылку" : "Копировать ссылку";

  if (!room) {
    refs.roomTitle.textContent = "Комната не найдена";
    refs.roomSubtitle.textContent = "Создай новую комнату из библиотеки.";
    refs.playersList.innerHTML = "";
    refs.mobileRoomBadge.textContent = "КОМНАТА";
    updateFullscreenUi();
    return;
  }

  refs.roomTitle.textContent = room.game?.title || "Комната";
  refs.roomSubtitle.textContent = `Комната ${room.id} • ${room.status === "running" ? "игра идёт" : "лобби"}`;
  refs.roomCover.src = room.game?.coverUrl || "";
  refs.roomCover.alt = room.game?.title || "";
  refs.readySummary.textContent = room.canStart ? "Можно стартовать" : room.status === "running" ? "Сессия в игре" : "Не готово";
  refs.statusTitle.textContent =
    room.status === "running"
      ? room.session?.paused
        ? "Сессия на паузе"
        : "Сетевая сессия активна"
      : "Комната ждёт игроков";
  refs.mobileRoomBadge.textContent = `${room.id} • ${room.game?.title || "NES Room"}`;

  refs.roomSubtitle.textContent =
    room.status === "running"
      ? `Комната ${room.id} • идет игра`
      : `Комната ${room.id} • ждет игроков`;
  refs.mobileRoomBadge.textContent = room.id;

  const me = room.players.find((player) => player.socketId === socket.id) ?? participant;
  const isHost = Boolean(me?.isHost);
  const isSpectator = Boolean(me?.spectator);
  const canReady = room.status === "lobby" && !isSpectator;
  const amReady = Boolean(me?.ready);

  refs.toggleReady.disabled = !canReady;
  refs.toggleReady.textContent = amReady ? "Снять готовность" : "Готов";
  refs.startSession.disabled = !(isHost && room.canStart && room.status === "lobby");
  refs.pauseSession.disabled = !(isHost && room.status === "running" && !room.session?.paused);
  refs.resumeSession.disabled = !(isHost && room.status === "running" && room.session?.paused);
  refs.stopSession.disabled = !(isHost && room.status === "running");
  refs.nicknameInput.disabled = room.status === "running";
  refs.inputDelay.disabled = !isHost || room.status === "running";

  renderPlayers(room);
  updateFullscreenUi();
}

function adjustTouchBitCount(bit, delta) {
  const nextCount = Math.max(0, (touchBitCounts.get(bit) || 0) + delta);
  if (nextCount === 0) {
    touchBitCounts.delete(bit);
  } else {
    touchBitCounts.set(bit, nextCount);
  }
  emulator.setTouchBit(bit, nextCount > 0);
}

function releaseAllTouchControls() {
  touchBitCounts.clear();
  dpadPointerMasks.clear();
  emulator.clearTouchMask();
  refs.touchDpad.classList.remove("touch-dpad--active");

  for (const button of refs.touchButtons) {
    const pointers = touchButtonPointers.get(button);
    if (pointers) {
      pointers.clear();
    }
    button.classList.remove("touch-control--active");
  }
}

function applyDpadMaskForPointer(pointerId, nextMask) {
  const previousMask = dpadPointerMasks.get(pointerId) ?? 0;
  dpadPointerMasks.set(pointerId, nextMask);

  if (previousMask !== nextMask && nextMask !== 0) {
    vibrateTap(8);
  }

  applyCombinedDpadMask();
}

function computeDpadMask(clientX, clientY) {
  const rect = refs.touchDpad.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = ((clientY - rect.top) / rect.height) * 2 - 1;
  const deadZone = 0.22;

  let mask = 0;
  if (x <= -deadZone) mask |= TOUCH_BITS.LEFT;
  if (x >= deadZone) mask |= TOUCH_BITS.RIGHT;
  if (y <= -deadZone) mask |= TOUCH_BITS.UP;
  if (y >= deadZone) mask |= TOUCH_BITS.DOWN;
  return mask;
}

function applyCombinedDpadMask() {
  let mask = 0;
  for (const pointerMask of dpadPointerMasks.values()) {
    mask |= pointerMask;
  }

  emulator.setTouchBit(TOUCH_BITS.UP, Boolean(mask & TOUCH_BITS.UP));
  emulator.setTouchBit(TOUCH_BITS.DOWN, Boolean(mask & TOUCH_BITS.DOWN));
  emulator.setTouchBit(TOUCH_BITS.LEFT, Boolean(mask & TOUCH_BITS.LEFT));
  emulator.setTouchBit(TOUCH_BITS.RIGHT, Boolean(mask & TOUCH_BITS.RIGHT));
  refs.touchDpad.classList.toggle("touch-dpad--active", mask !== 0);
}

function bindTouchControls() {
  for (const button of refs.touchButtons) {
    const pointers = new Set();
    touchButtonPointers.set(button, pointers);
    const bit = Number(button.dataset.touchBit);

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    button.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      event.preventDefault();
      pointers.add(event.pointerId);
      button.classList.add("touch-control--active");
      adjustTouchBitCount(bit, 1);
      vibrateTap(14);
      button.setPointerCapture?.(event.pointerId);
    });

    const release = (event) => {
      if (!pointers.has(event.pointerId)) {
        return;
      }

      pointers.delete(event.pointerId);
      adjustTouchBitCount(bit, -1);
      button.classList.toggle("touch-control--active", pointers.size > 0);
    };

    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  }

  refs.touchDpad.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  refs.touchDpad.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.preventDefault();
    refs.touchDpad.setPointerCapture?.(event.pointerId);
    applyDpadMaskForPointer(event.pointerId, computeDpadMask(event.clientX, event.clientY));
  });

  refs.touchDpad.addEventListener("pointermove", (event) => {
    if (!dpadPointerMasks.has(event.pointerId)) {
      return;
    }

    applyDpadMaskForPointer(event.pointerId, computeDpadMask(event.clientX, event.clientY));
  });

  const releaseDpadPointer = (event) => {
    if (!dpadPointerMasks.has(event.pointerId)) {
      return;
    }

    dpadPointerMasks.delete(event.pointerId);
    applyCombinedDpadMask();
  };

  refs.touchDpad.addEventListener("pointerup", releaseDpadPointer);
  refs.touchDpad.addEventListener("pointercancel", releaseDpadPointer);
  refs.touchDpad.addEventListener("lostpointercapture", releaseDpadPointer);
}

async function syncRoute() {
  const route = parseRoute();

  if (route.kind === "library") {
    state.currentRoomId = null;
    state.currentRoom = null;
    state.participant = null;
    socket.emit("room:leave");
    releaseAllTouchControls();
    await exitFullscreenMode();
    await emulator.stop();
    setView("library");
    renderCatalog();
    return;
  }

  setView("room");
  state.currentRoomId = route.roomId;

  try {
    const payload = await fetchJson(`/api/rooms/${route.roomId}`);
    state.currentRoom = payload.room;
    state.participant = null;
    renderRoom();
    if (socket.connected) {
      socket.emit("room:join", {
        roomId: route.roomId,
        name: state.nickname || "Игрок",
      });
    }
  } catch (error) {
    refs.roomTitle.textContent = "Комната не найдена";
    refs.roomSubtitle.textContent = error.message;
    state.currentRoom = null;
    state.participant = null;
    renderRoom();
  }
}

function startLatencyProbe() {
  clearInterval(latencyInterval);
  latencyInterval = setInterval(() => {
    if (!socket.connected || !state.currentRoomId) {
      return;
    }

    const started = performance.now();
    socket.timeout(1000).emit("net:ping", {}, (error) => {
      if (error) {
        return;
      }
      emulator.setLatency(Math.round(performance.now() - started));
    });
  }, 2000);
}

refs.refreshLibrary.addEventListener("click", async () => {
  const payload = await fetchJson("/api/games");
  state.games = payload.games;
  renderCatalog();
});

refs.backToLibrary.addEventListener("click", () => {
  navigate("/");
});

refs.copyLink.addEventListener("click", async () => {
  if (!state.currentRoom) {
    return;
  }

  const shareUrl = buildShareUrl(state.currentRoom);
  await navigator.clipboard.writeText(shareUrl);
  showToast(state.telegram?.botUsername ? "TG-ссылка скопирована" : "Ссылка скопирована");
});

refs.toggleFullscreen.addEventListener("click", toggleFullscreenMode);
refs.screenFullscreenButton.addEventListener("click", toggleFullscreenMode);
refs.exitMobileFullscreen.addEventListener("click", async () => {
  vibrateTap(18);
  await exitFullscreenMode();
});

refs.nicknameInput.addEventListener("change", () => {
  state.nickname = refs.nicknameInput.value.trim();
  localStorage.setItem("nes-switch-online:nickname", state.nickname);
  if (state.currentRoomId) {
    socket.emit("room:rename", { name: state.nickname || "Игрок" });
  }
});

refs.inputDelay.addEventListener("change", () => {
  state.inputDelayFrames = Number(refs.inputDelay.value);
  localStorage.setItem("nes-switch-online:input-delay", String(state.inputDelayFrames));
});

refs.toggleReady.addEventListener("click", () => {
  const me = state.currentRoom?.players?.find((player) => player.socketId === socket.id);
  socket.emit("room:ready", {
    ready: !(me?.ready ?? false),
  });
});

refs.startSession.addEventListener("click", () => {
  socket.emit("room:start", {
    inputDelayFrames: state.inputDelayFrames,
  });
});

refs.pauseSession.addEventListener("click", () => {
  socket.emit("session:pause");
});

refs.resumeSession.addEventListener("click", () => {
  socket.emit("session:resume");
});

refs.stopSession.addEventListener("click", async () => {
  socket.emit("session:stop");
  releaseAllTouchControls();
  await emulator.stop("Сессия остановлена");
});

window.addEventListener("popstate", () => {
  void syncRoute();
});

window.addEventListener("resize", refreshDeviceMode);
window.addEventListener("orientationchange", refreshDeviceMode);

document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement !== refs.roomView) {
    state.fallbackFullscreen = false;
    if (state.isMobileDevice) {
      void tryUnlockOrientation();
    }
  }
  updateFullscreenUi();
});

socket.on("connect", () => {
  startLatencyProbe();
  const route = parseRoute();
  if (route.kind === "room") {
    socket.emit("room:join", {
      roomId: route.roomId,
      name: state.nickname || "Игрок",
    });
  }
});

socket.on("disconnect", () => {
  showToast("Соединение с сервером потеряно");
});

socket.on("catalog:updated", (games) => {
  state.games = games;
  mergeCurrentRoomGame();
  renderCatalog();
  renderRoom();
});

socket.on("room:joined", ({ room, participant }) => {
  state.currentRoom = room;
  state.participant = participant;
  renderRoom();
});

socket.on("room:state", (room) => {
  if (room.id !== state.currentRoomId) {
    return;
  }
  state.currentRoom = room;
  renderRoom();
});

socket.on("room:error", ({ message }) => {
  showToast(message || "Ошибка комнаты");
});

socket.on("session:starting", async ({ roomId, startedAt, inputDelayFrames, requiredSlots }) => {
  if (roomId !== state.currentRoomId || !state.currentRoom?.game) {
    return;
  }

  const player = state.currentRoom.players.find((entry) => entry.socketId === socket.id);
  if (player?.spectator) {
    refs.screenOverlay.textContent = "Наблюдатель не участвует в текущей сессии";
    refs.screenOverlay.classList.remove("hidden");
    return;
  }

  try {
    await emulator.start({
      roomId,
      slot: player?.slot ?? state.participant?.slot ?? 1,
      socket,
      startedAt,
      inputDelayFrames,
      requiredSlots,
      romUrl: `/api/roms/${state.currentRoom.game.id}/file`,
    });
    refs.statusTitle.textContent = "Синхронизация перед стартом";
  } catch (error) {
    releaseAllTouchControls();
    await emulator.stop(error.message);
    console.error(error);
  }
});

socket.on("session:input", (payload) => {
  if (payload.roomId !== state.currentRoomId) {
    return;
  }
  emulator.receiveInput(payload);
});

socket.on("session:paused", ({ roomId }) => {
  if (roomId !== state.currentRoomId) {
    return;
  }
  emulator.receivePause();
});

socket.on("session:resumed", ({ roomId, startedAt }) => {
  if (roomId !== state.currentRoomId) {
    return;
  }
  emulator.receiveResume(startedAt);
});

socket.on("session:request-snapshot", ({ roomId }) => {
  if (roomId !== state.currentRoomId) {
    return;
  }
  emulator.handleSnapshotRequest();
});

socket.on("session:snapshot", (payload) => {
  if (payload.roomId !== state.currentRoomId) {
    return;
  }
  emulator.applySnapshot(payload);
});

socket.on("session:ended", async ({ roomId, reason }) => {
  if (roomId !== state.currentRoomId) {
    return;
  }

  const messages = {
    "player-left": "Игрок вышел. Сессия остановлена.",
    "host-ended": "Хост завершил сессию.",
  };

  releaseAllTouchControls();
  await emulator.stop(messages[reason] || "Сессия завершена");
});

function syncFullscreenButtonLabels(fullscreenActive) {
  if (refs.toggleFullscreen) {
    refs.toggleFullscreen.textContent = fullscreenActive ? "Свернуть экран" : "Во весь экран";
  }

  if (refs.screenFullscreenButton) {
    refs.screenFullscreenButton.textContent = fullscreenActive ? "×" : "FS";
  }
}

state.telegram = await initializeTelegramMiniApp();
state.telegram.setBackHandler?.(() => {
  if (state.fullscreenActive) {
    void exitFullscreenMode();
    return;
  }

  if (state.currentRoomId) {
    navigate("/");
  }
});
state.telegram.setFullscreenChangedHandler?.(() => {
  updateFullscreenUi();
});

if (!state.nickname && state.telegram.user?.firstName) {
  state.nickname = state.telegram.user.firstName.slice(0, 20);
  localStorage.setItem("nes-switch-online:nickname", state.nickname);
}

if (parseRoute().kind === "library" && state.telegram.startRoomId) {
  window.history.replaceState({}, "", `/room/${state.telegram.startRoomId}`);
}

refs.nicknameInput.value = state.nickname;
refs.inputDelay.value = String(state.inputDelayFrames);

bindTouchControls();
refreshDeviceMode();

const initialCatalog = await fetchJson("/api/games");
state.games = initialCatalog.games;
renderCatalog();
renderRoom();
await syncRoute();
