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
const SELECTED_CONSOLE_STORAGE_KEY = "nes-switch-online:selected-console";
const SELECTED_GAME_STORAGE_KEY = "nes-switch-online:selected-game";
const CONSOLE_OPTIONS = [
  {
    id: "nes",
    label: "NES",
    subtitle: "Nintendo",
    available: true,
  },
  {
    id: "snes",
    label: "SNES",
    subtitle: "Soon",
    available: false,
  },
  {
    id: "gb",
    label: "GB",
    subtitle: "Soon",
    available: false,
  },
  {
    id: "gba",
    label: "GBA",
    subtitle: "Soon",
    available: false,
  },
  {
    id: "gamecube",
    label: "GC",
    subtitle: "Soon",
    available: false,
  },
  {
    id: "ds",
    label: "DS",
    subtitle: "Soon",
    available: false,
  },
];
const PIXEL_AVATAR_ASSETS = [
  "/assets/pixel-ui/avatars/avatar-cap-red-large.png",
  "/assets/pixel-ui/avatars/avatar-bob-brown-large.png",
  "/assets/pixel-ui/avatars/avatar-goggles-blond-large.png",
  "/assets/pixel-ui/avatars/avatar-hood-blue-large.png",
  "/assets/pixel-ui/avatars/avatar-cap-blue-large.png",
  "/assets/pixel-ui/avatars/avatar-glasses-dark-large.png",
  "/assets/pixel-ui/avatars/avatar-headband-white-large.png",
  "/assets/pixel-ui/avatars/avatar-pigtails-blonde-large.png",
  "/assets/pixel-ui/avatars/avatar-headband-red-large.png",
  "/assets/pixel-ui/avatars/avatar-glasses-brown-large.png",
  "/assets/pixel-ui/avatars/avatar-cap-redblue-large.png",
  "/assets/pixel-ui/avatars/avatar-cap-green-large.png",
];

const state = {
  games: [],
  currentRoom: null,
  participant: null,
  currentRoomId: null,
  roomUiMode: null,
  roomLoadError: "",
  nickname: localStorage.getItem("nes-switch-online:nickname") || "",
  inputDelayFrames: Number(localStorage.getItem("nes-switch-online:input-delay") || 4),
  selectedConsoleId: localStorage.getItem(SELECTED_CONSOLE_STORAGE_KEY) || "",
  selectedGameId: localStorage.getItem(SELECTED_GAME_STORAGE_KEY) || "",
  librarySearchQuery: "",
  isMobileDevice: false,
  fallbackFullscreen: false,
  fullscreenActive: false,
  telegram: null,
  pendingRoomLaunch: null,
};

const refs = {
  libraryView: document.querySelector("#library-view"),
  roomView: document.querySelector("#room-view"),
  roomHead: document.querySelector(".room-head"),
  nesRoom: document.querySelector(".nes-room"),
  deckPanel: document.querySelector(".deck-panel"),
  catalogCount: document.querySelector("#catalog-count"),
  catalogStatus: document.querySelector("#catalog-status"),
  gameGrid: document.querySelector("#game-grid"),
  emptyLibrary: document.querySelector("#empty-library"),
  refreshLibrary: document.querySelector("#refresh-library"),
  miniLibraryScreen: document.querySelector("#mini-library-screen"),
  miniProfileButton: document.querySelector("#mini-profile-button"),
  miniProfileInitials: document.querySelector("#mini-profile-initials"),
  miniConsoleBack: document.querySelector("#mini-console-back"),
  miniLibrarySearchWrap: document.querySelector("#mini-library-search-wrap"),
  miniLibrarySearch: document.querySelector("#mini-library-search"),
  miniConsoleView: document.querySelector("#mini-console-view"),
  miniConsoleGrid: document.querySelector("#mini-console-grid"),
  miniRomView: document.querySelector("#mini-rom-view"),
  miniRomGrid: document.querySelector("#mini-rom-grid"),
  miniLibraryActions: document.querySelector("#mini-library-actions"),
  miniLibraryPlay: document.querySelector("#mini-library-play"),
  miniLibraryHost: document.querySelector("#mini-library-host"),
  backToLibrary: document.querySelector("#back-to-library"),
  roomTitle: document.querySelector("#room-title"),
  roomSubtitle: document.querySelector("#room-subtitle"),
  copyLink: document.querySelector("#copy-link"),
  partyLobby: document.querySelector("#party-lobby"),
  partyLobbyTitle: document.querySelector("#party-lobby-title"),
  partyLobbySubtitle: document.querySelector("#party-lobby-subtitle"),
  partyRoomCode: document.querySelector("#party-room-code"),
  partyPlayerCount: document.querySelector("#party-player-count"),
  partyGameCover: document.querySelector("#party-game-cover"),
  partyGameTitle: document.querySelector("#party-game-title"),
  partyGameMeta: document.querySelector("#party-game-meta"),
  partyStatusCopy: document.querySelector("#party-status-copy"),
  partyPlayersList: document.querySelector("#party-players-list"),
  partyNicknameInput: document.querySelector("#party-nickname-input"),
  partyBackButton: document.querySelector("#party-back-button"),
  partyCopyIconButton: document.querySelector("#party-copy-icon"),
  partyMenuButton: document.querySelector("#party-menu-button"),
  partyInviteButton: document.querySelector("#party-invite-button"),
  partyCopyButton: document.querySelector("#party-copy-button"),
  partyReadyButton: document.querySelector("#party-ready-button"),
  partyPlayButton: document.querySelector("#party-play-button"),
  toggleFullscreen: document.querySelector("#toggle-fullscreen"),
  screenFullscreenButton: document.querySelector("#screen-fullscreen-button"),
  exitMobileFullscreen: document.querySelector("#exit-mobile-fullscreen"),
  screenShell: document.querySelector(".screen-shell"),
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
  mobileScreenShell: document.querySelector("#mobile-screen-shell"),
  mobileRoomBadge: document.querySelector("#mobile-room-badge"),
  mobileBackButton: document.querySelector("#mobile-back-button"),
  mobileMenuButton: document.querySelector("#mobile-menu-button"),
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

function shouldUsePixelMiniUi() {
  return Boolean(state.telegram?.isMiniApp && state.isMobileDevice);
}

function hashString(value) {
  let hash = 0;
  for (const char of String(value || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function pluralizeEn(count, singular, plural) {
  return count === 1 ? singular : plural;
}

function getSelectedGame(games = state.games) {
  if (!games.length) {
    state.selectedGameId = "";
    localStorage.removeItem(SELECTED_GAME_STORAGE_KEY);
    return null;
  }

  const selected = games.find((game) => game.id === state.selectedGameId) ?? games[0];

  if (selected && selected.id !== state.selectedGameId) {
    setSelectedGame(selected.id);
  }

  return selected;
}

function setSelectedGame(gameId) {
  state.selectedGameId = gameId;
  if (gameId) {
    localStorage.setItem(SELECTED_GAME_STORAGE_KEY, gameId);
  } else {
    localStorage.removeItem(SELECTED_GAME_STORAGE_KEY);
  }
}

function getPlayerAvatarSrc(player, index = 0) {
  if (player?.spectator) {
    return "/assets/pixel-ui/avatars/avatar-placeholder-large.png";
  }

  const seed = hashString(`${player?.socketId || ""}:${player?.name || ""}:${player?.slot || index}`);
  return PIXEL_AVATAR_ASSETS[seed % PIXEL_AVATAR_ASSETS.length];
}

function getMiniProfileInitials() {
  const source = state.telegram?.user?.firstName || state.nickname || "TG";
  return source.slice(0, 2).toUpperCase();
}

function getSelectedConsole() {
  return CONSOLE_OPTIONS.find((option) => option.id === state.selectedConsoleId && option.available) ?? null;
}

function setSelectedConsole(consoleId) {
  state.selectedConsoleId = consoleId;
  if (consoleId) {
    localStorage.setItem(SELECTED_CONSOLE_STORAGE_KEY, consoleId);
  } else {
    localStorage.removeItem(SELECTED_CONSOLE_STORAGE_KEY);
  }
  state.librarySearchQuery = "";
  if (refs.miniLibrarySearch) {
    refs.miniLibrarySearch.value = "";
  }
  setSelectedGame("");
}

function getVisibleLibraryGames() {
  if (state.selectedConsoleId !== "nes") {
    return [];
  }

  const query = state.librarySearchQuery.trim().toLowerCase();
  if (!query) {
    return state.games;
  }

  return state.games.filter((game) => {
    const haystack = `${game.title} ${game.fileName} ${game.mapper}`.toLowerCase();
    return haystack.includes(query);
  });
}

function renderConsoleSelection() {
  refs.miniConsoleGrid.innerHTML = "";

  for (const option of CONSOLE_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mini-library__console-card";
    button.dataset.available = String(option.available);
    button.innerHTML = `
      <strong>${option.label}</strong>
      <span>${option.subtitle}</span>
    `;
    button.addEventListener("click", () => {
      if (!option.available) {
        showToast(`${option.label} скоро добавим`);
        return;
      }

      setSelectedConsole(option.id);
      renderMiniLibrary();
    });
    refs.miniConsoleGrid.appendChild(button);
  }
}

function renderRomSelection() {
  const visibleGames = getVisibleLibraryGames();
  const selectedGame = state.selectedGameId ? getSelectedGame(visibleGames) : null;
  if (state.selectedGameId && !selectedGame) {
    setSelectedGame("");
  }

  refs.miniRomGrid.innerHTML = "";
  for (const game of visibleGames) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mini-library__rom-card";
    button.dataset.selected = String(game.id === selectedGame?.id);
    button.innerHTML = `
      <span class="mini-library__rom-thumb">
        <img src="${game.coverUrl}" alt="${escapeHtml(game.title)}" loading="lazy" />
      </span>
      <span class="mini-library__rom-name">${escapeHtml(game.title)}</span>
    `;
    button.addEventListener("click", () => {
      setSelectedGame(game.id);
      renderMiniLibrary();
    });
    refs.miniRomGrid.appendChild(button);
  }

  if (!visibleGames.length) {
    const empty = document.createElement("div");
    empty.className = "mini-library__empty";
    empty.textContent = state.librarySearchQuery ? "Ничего не найдено" : "ROMы пока пусты";
    refs.miniRomGrid.appendChild(empty);
  }

  const shouldShowActions = Boolean(selectedGame);
  refs.miniLibraryActions.classList.toggle("hidden", !shouldShowActions);
  refs.miniLibraryActions.setAttribute("aria-hidden", String(!shouldShowActions));
  refs.miniLibraryPlay.disabled = !selectedGame;
  refs.miniLibraryHost.disabled = !selectedGame;
}

function legacyRenderMiniLibrary() {
  const active = shouldUsePixelMiniUi() && !state.currentRoomId;
  refs.miniLibraryScreen.classList.toggle("hidden", !active);
  refs.miniLibraryScreen.setAttribute("aria-hidden", String(!active));

  if (!active) {
    return;
  }

  refs.miniProfileInitials.textContent = getMiniProfileInitials();

  const selectedConsole = getSelectedConsole();
  const showConsoleSelection = !selectedConsole;

  refs.miniConsoleView.classList.toggle("hidden", !showConsoleSelection);
  refs.miniConsoleView.setAttribute("aria-hidden", String(!showConsoleSelection));
  refs.miniRomView.classList.toggle("hidden", showConsoleSelection);
  refs.miniRomView.setAttribute("aria-hidden", String(showConsoleSelection));
  refs.miniConsoleBack.classList.toggle("hidden", showConsoleSelection);
  refs.miniLibrarySearchWrap.classList.toggle("hidden", showConsoleSelection);

  refs.miniLibraryList.innerHTML = "";
  for (const entry of state.games) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "mini-library__item";
    item.dataset.selected = String(entry.id === game?.id);
    item.innerHTML = `
      <span class="mini-library__item-thumb">
        <img src="${entry.coverUrl}" alt="${escapeHtml(entry.title)}" loading="lazy" />
      </span>
      <span class="mini-library__item-copy">
        <strong>${escapeHtml(entry.title)}</strong>
        <small>MAPPER ${entry.mapper} • ${entry.prgKb} KB</small>
      </span>
    `;
    item.addEventListener("click", () => {
      setSelectedGame(entry.id);
      renderCatalog();
    });
    refs.miniLibraryList.appendChild(item);
  }
}

function renderMiniLibrary() {
  const active = shouldUsePixelMiniUi() && !state.currentRoomId;
  refs.miniLibraryScreen.classList.toggle("hidden", !active);
  refs.miniLibraryScreen.setAttribute("aria-hidden", String(!active));

  if (!active) {
    return;
  }

  refs.miniProfileInitials.textContent = getMiniProfileInitials();

  const selectedConsole = getSelectedConsole();
  const showConsoleSelection = !selectedConsole;

  refs.miniConsoleView.classList.toggle("hidden", !showConsoleSelection);
  refs.miniConsoleView.setAttribute("aria-hidden", String(!showConsoleSelection));
  refs.miniRomView.classList.toggle("hidden", showConsoleSelection);
  refs.miniRomView.setAttribute("aria-hidden", String(showConsoleSelection));
  refs.miniConsoleBack.classList.toggle("hidden", showConsoleSelection);
  refs.miniLibrarySearchWrap.classList.toggle("hidden", showConsoleSelection);

  if (showConsoleSelection) {
    refs.miniLibraryActions.classList.add("hidden");
    refs.miniLibraryActions.setAttribute("aria-hidden", "true");
    renderConsoleSelection();
    return;
  }

  renderRomSelection();
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

function getCurrentPlayer(room = state.currentRoom) {
  if (!room?.players?.length) {
    return state.participant;
  }

  return room.players.find((player) => player.socketId === socket.id) ?? state.participant;
}

async function copyTextToClipboard(value) {
  if (!value) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Use the fallback copy path below.
    }
  }

  const helper = document.createElement("textarea");
  helper.value = value;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  helper.style.pointerEvents = "none";
  document.body.appendChild(helper);
  helper.focus();
  helper.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  helper.remove();
  return copied;
}

function setPendingRoomLaunch(roomId, mode) {
  state.pendingRoomLaunch = {
    roomId,
    mode,
    readySent: false,
    startSent: false,
    fullscreenRequested: false,
  };
}

function pluralizeRu(count, one, few, many) {
  const remainder10 = Math.abs(count) % 10;
  const remainder100 = Math.abs(count) % 100;
  if (remainder10 === 1 && remainder100 !== 11) {
    return one;
  }
  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)) {
    return few;
  }
  return many;
}

function shouldShowPartyLobby(room = state.currentRoom) {
  if (!state.telegram?.isMiniApp || !state.isMobileDevice) {
    return false;
  }

  return state.roomUiMode === "party" && (!room || room.status !== "running");
}

function shouldUseSoloUi() {
  return Boolean(state.telegram?.isMiniApp && state.isMobileDevice && state.roomUiMode === "solo");
}

function shouldUsePartyUi() {
  return Boolean(
    state.telegram?.isMiniApp && state.isMobileDevice && state.roomUiMode === "party",
  );
}

function shouldShowSoloLaunch(room = state.currentRoom) {
  return shouldUseSoloUi() && (!room || room.status !== "running");
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

function syncEmulatorSurface(useMobileSurface) {
  const target = useMobileSurface ? refs.mobileScreenShell : refs.screenShell;
  if (!target) {
    return;
  }

  if (refs.emulatorMount.parentElement !== target) {
    target.prepend(refs.emulatorMount);
  }

  if (refs.screenOverlay.parentElement !== target) {
    target.append(refs.screenOverlay);
  }
}

function legacyUpdateFullscreenUi() {
  const hasRoom = Boolean(state.currentRoom);
  const fullscreenActive = isFullscreenActive();
  const roomFullscreenActive = hasRoom && fullscreenActive;
  const mobileControlsActive = state.isMobileDevice && roomFullscreenActive;
  const mobileOverlayActive = mobileControlsActive;
  state.fullscreenActive = fullscreenActive;

  document.body.classList.toggle("is-mobile-device", state.isMobileDevice);
  document.body.classList.toggle("is-mobile-fullscreen", mobileOverlayActive);
  refs.roomView.classList.toggle("room-view--fullscreen-active", roomFullscreenActive);
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

  renderFullscreenButtons(roomFullscreenActive);
  syncFullscreenButtonLabels(roomFullscreenActive);
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
    try {
      state.telegram?.webApp?.HapticFeedback?.impactOccurred?.("light");
    } catch {
      // Optional Telegram haptic bridge.
    }
    return;
  }

  const now = performance.now();
  if (now - lastHapticAt < 45) {
    return;
  }

  lastHapticAt = now;
  try {
    state.telegram?.webApp?.HapticFeedback?.impactOccurred?.("light");
  } catch {
    // Optional Telegram haptic bridge.
  }
  navigator.vibrate(duration);
}

async function ensureMiniAppFullscreen() {
  if (!state.telegram?.isMiniApp) {
    return false;
  }

  if (state.telegram.isFullscreenActive?.()) {
    updateFullscreenUi();
    return true;
  }

  const entered = await state.telegram.requestFullscreen?.();
  updateFullscreenUi();
  return Boolean(entered || state.telegram.isFullscreenActive?.());
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
    const entered = await ensureMiniAppFullscreen();
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

async function shareCurrentRoomLink(room = state.currentRoom) {
  if (!room) {
    return false;
  }

  const shareUrl = buildShareUrl(room);
  const shareText = room.game?.title
    ? `Залетай в комнату ${room.id} и запускай ${room.game.title}`
    : `Залетай в комнату ${room.id} в NES Switch Online`;

  if (await state.telegram?.shareRoomLink?.(shareUrl, shareText)) {
    showToast("Открыл приглашение в Telegram");
    return true;
  }

  const copied = await copyTextToClipboard(shareUrl);
  if (copied) {
    showToast(state.telegram?.botUsername ? "TG-ссылка скопирована" : "Ссылка скопирована");
    return true;
  }

  window.prompt("Скопируй ссылку на комнату", shareUrl);
  return false;
}

async function maybeHandlePendingRoomLaunch() {
  const launch = state.pendingRoomLaunch;
  if (!launch || launch.roomId !== state.currentRoomId || !state.currentRoom) {
    return;
  }

  if (!launch.fullscreenRequested && state.telegram?.isMiniApp) {
    launch.fullscreenRequested = true;
    await ensureMiniAppFullscreen();
  }

  const me = getCurrentPlayer();
  if (!me) {
    return;
  }

  if (launch.mode === "party") {
    state.pendingRoomLaunch = null;
    return;
  }

  if (me.spectator || state.currentRoom.status !== "lobby") {
    if (state.currentRoom.status === "running") {
      state.pendingRoomLaunch = null;
    }
    return;
  }

  if (!me.ready && !launch.readySent) {
    launch.readySent = true;
    socket.emit("room:ready", {
      ready: true,
    });
    return;
  }

  if (state.currentRoom.canStart && me.isHost && !launch.startSent) {
    launch.startSent = true;
    socket.emit("room:start", {
      inputDelayFrames: state.inputDelayFrames,
    });
  }
}

async function createRoomForGame(gameId, mode) {
  state.roomUiMode = mode === "solo" ? "solo" : "party";
  state.roomLoadError = "";

  if (state.telegram?.isMiniApp && mode === "solo") {
    void ensureMiniAppFullscreen();
  }

  const payload = await fetchJson("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ gameId }),
  });

  setPendingRoomLaunch(payload.room.id, mode);
  navigate(payload.room.sharePath);
}

async function copyCurrentRoomLink() {
  if (!state.currentRoom) {
    return false;
  }

  const shareUrl = buildShareUrl(state.currentRoom);
  const copied = await copyTextToClipboard(shareUrl);
  if (copied) {
    showToast(state.telegram?.botUsername ? "TG-ссылка скопирована" : "Ссылка скопирована");
    return true;
  }

  window.prompt("Скопируй ссылку на комнату", shareUrl);
  return false;
}

function toggleCurrentReady() {
  const me = getCurrentPlayer();
  socket.emit("room:ready", {
    ready: !(me?.ready ?? false),
  });
}

function startCurrentRoom() {
  socket.emit("room:start", {
    inputDelayFrames: state.inputDelayFrames,
  });
}

function legacyRenderCatalog() {
  refs.catalogCount.textContent = `${state.games.length} игр`;
  refs.catalogStatus.textContent = state.games.length ? "Готово к игре" : "Библиотека пуста";

  refs.emptyLibrary.classList.toggle("hidden", state.games.length > 0);
  refs.gameGrid.innerHTML = "";
  getSelectedGame();
  getSelectedGame();

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

  renderMiniLibrary();
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

  renderMiniLibrary();
}

function legacyRenderRoom() {
  const room = state.currentRoom;
  const participant = state.participant;
  refs.copyLink.textContent = state.telegram?.botUsername ? "Скопировать TG-ссылку" : "Копировать ссылку";

  if (!room) {
    refs.roomTitle.textContent = "Комната не найдена";
    refs.roomSubtitle.textContent = "Создай новую комнату из библиотеки.";
    refs.playersList.innerHTML = "";
    renderPartyLobby(null, null);
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
  renderPartyLobby(room, me);
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

async function legacySyncRoute() {
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

refs.miniConsoleBack?.addEventListener("click", () => {
  setSelectedConsole("");
  renderMiniLibrary();
});

refs.miniLibrarySearch?.addEventListener("input", () => {
  state.librarySearchQuery = refs.miniLibrarySearch.value;
  renderMiniLibrary();
});

refs.miniLibraryPlay?.addEventListener("click", async () => {
  const game = getSelectedGame(getVisibleLibraryGames());
  if (!game) {
    return;
  }

  try {
    refs.miniLibraryPlay.disabled = true;
    await createRoomForGame(game.id, "solo");
  } catch (error) {
    showToast(error.message);
  } finally {
    refs.miniLibraryPlay.disabled = false;
  }
});

refs.miniLibraryHost?.addEventListener("click", async () => {
  const game = getSelectedGame(getVisibleLibraryGames());
  if (!game) {
    return;
  }

  try {
    refs.miniLibraryHost.disabled = true;
    await createRoomForGame(game.id, "party");
  } catch (error) {
    showToast(error.message);
  } finally {
    refs.miniLibraryHost.disabled = false;
  }
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
refs.mobileBackButton.addEventListener("click", async () => {
  vibrateTap(18);
  if (state.fullscreenActive) {
    await exitFullscreenMode();
    return;
  }
  navigate("/");
});
refs.exitMobileFullscreen.addEventListener("click", async () => {
  vibrateTap(18);
  await exitFullscreenMode();
});
refs.mobileMenuButton.addEventListener("click", async () => {
  vibrateTap(18);
  await shareCurrentRoomLink(state.currentRoom);
});

refs.nicknameInput.addEventListener("change", () => {
  state.nickname = refs.nicknameInput.value.trim();
  refs.partyNicknameInput.value = state.nickname;
  localStorage.setItem("nes-switch-online:nickname", state.nickname);
  if (state.currentRoomId) {
    socket.emit("room:rename", { name: state.nickname || "Игрок" });
  }
});

refs.inputDelay.addEventListener("change", () => {
  state.inputDelayFrames = Number(refs.inputDelay.value);
  localStorage.setItem("nes-switch-online:input-delay", String(state.inputDelayFrames));
});

refs.partyNicknameInput.addEventListener("change", () => {
  state.nickname = refs.partyNicknameInput.value.trim();
  refs.nicknameInput.value = state.nickname;
  localStorage.setItem("nes-switch-online:nickname", state.nickname);
  if (state.currentRoomId) {
    socket.emit("room:rename", { name: state.nickname || "Игрок" });
  }
});

refs.partyBackButton.addEventListener("click", () => {
  navigate("/");
});

refs.partyCopyIconButton.addEventListener("click", async () => {
  await copyCurrentRoomLink();
});

refs.partyMenuButton.addEventListener("click", () => {
  void shareCurrentRoomLink(state.currentRoom);
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

refs.partyInviteButton.addEventListener("click", () => {
  void shareCurrentRoomLink(state.currentRoom);
});

refs.partyCopyButton.addEventListener("click", async () => {
  await copyCurrentRoomLink();
});

refs.partyReadyButton.addEventListener("click", () => {
  toggleCurrentReady();
});

refs.partyPlayButton.addEventListener("click", () => {
  startCurrentRoom();
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

function updateFullscreenUi() {
  const hasRoom = Boolean(state.currentRoom);
  const nativeRoomFullscreen = document.fullscreenElement === refs.roomView || state.fallbackFullscreen;
  const telegramAppFullscreen = Boolean(state.telegram?.isFullscreenActive?.());
  const fullscreenActive = nativeRoomFullscreen || telegramAppFullscreen;
  const roomFullscreenActive =
    hasRoom && (nativeRoomFullscreen || (telegramAppFullscreen && state.currentRoom?.status === "running"));
  const soloUiActive = shouldUseSoloUi();
  const partyUiActive = shouldUsePartyUi();
  const partyLobbyActive = shouldShowPartyLobby();
  const soloLaunchActive = shouldShowSoloLaunch();
  const mobileControlsActive = state.isMobileDevice && (roomFullscreenActive || soloUiActive);
  const mobileOverlayActive = mobileControlsActive;
  state.fullscreenActive = roomFullscreenActive;
  const appModeActive = Boolean(state.telegram?.isMiniApp && state.isMobileDevice && (soloUiActive || partyUiActive));

  document.body.classList.toggle("is-mobile-device", state.isMobileDevice);
  document.body.classList.toggle("is-mobile-fullscreen", mobileOverlayActive);
  document.body.classList.toggle("is-party-lobby-open", partyLobbyActive);
  document.body.classList.toggle("is-solo-launch-open", soloLaunchActive);
  document.body.classList.toggle("is-pixel-mini-ui", shouldUsePixelMiniUi());
  refs.roomView.classList.toggle("room-view--fullscreen-active", roomFullscreenActive);
  refs.roomView.classList.toggle("room-view--mobile-controls", mobileControlsActive);
  refs.roomView.classList.toggle("room-view--mobile-fs", mobileOverlayActive);
  refs.roomView.classList.toggle("room-view--party-lobby", partyLobbyActive);
  refs.roomView.classList.toggle("room-view--solo-launch", soloLaunchActive);
  refs.roomView.classList.toggle("room-view--app-solo", soloUiActive);
  refs.roomView.classList.toggle("room-view--app-party", partyUiActive);
  refs.roomHead.classList.toggle("hidden", appModeActive);
  refs.deckPanel.classList.toggle("hidden", appModeActive);
  refs.nesRoom.classList.toggle("hidden", partyLobbyActive);
  refs.mobileHandheld.classList.toggle("hidden", !mobileControlsActive);
  refs.mobileHandheld.setAttribute("aria-hidden", String(!mobileControlsActive));
  refs.exitMobileFullscreen.classList.toggle("hidden", !mobileOverlayActive);
  refs.mobileBackButton.classList.toggle("hidden", !mobileOverlayActive);
  refs.mobileMenuButton.classList.toggle("hidden", !mobileOverlayActive);
  refs.partyLobby.classList.toggle("hidden", !partyLobbyActive);
  refs.partyLobby.setAttribute("aria-hidden", String(!partyLobbyActive));

  const showFullscreenButtons = hasRoom && !partyLobbyActive && !soloLaunchActive && !soloUiActive && !partyUiActive;
  for (const button of refs.fullscreenButtons) {
    button.classList.toggle("hidden", !showFullscreenButtons);
    button.setAttribute(
      "aria-label",
      roomFullscreenActive ? "Выйти из полного экрана" : "Открыть на весь экран",
    );
  }

  syncEmulatorSurface(mobileOverlayActive);
  renderFullscreenButtons(roomFullscreenActive);
  syncFullscreenButtonLabels(roomFullscreenActive);
  state.telegram?.syncUi?.({
    inRoom: Boolean(state.currentRoomId),
    fullscreenActive,
    running: state.currentRoom?.status === "running",
  });
  refreshEmulatorLayout();
}

function legacyRenderCatalogV2() {
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
          <span>Mapper ${game.mapper}</span>
          <span>${game.prgKb} KB</span>
        </div>
      </div>
      <div class="game-card__actions">
        <button class="primary-button" type="button" data-launch-mode="solo">Играть</button>
        <button class="secondary-button" type="button" data-launch-mode="party">Пати</button>
      </div>
    `;

    for (const button of card.querySelectorAll("[data-launch-mode]")) {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await createRoomForGame(game.id, button.dataset.launchMode);
        } catch (error) {
          showToast(error.message);
        } finally {
          button.disabled = false;
        }
      });
    }

    refs.gameGrid.appendChild(card);
  }
}

function legacyRenderPartyLobby(room, me) {
  const lobbyActive = shouldShowPartyLobby();

  refs.partyLobby.classList.toggle("hidden", !lobbyActive);
  refs.partyLobby.setAttribute("aria-hidden", String(!lobbyActive));
  if (!lobbyActive) {
    return;
  }

  refs.partyNicknameInput.value = state.nickname;

  if (!room) {
    refs.partyLobbyTitle.textContent = state.roomLoadError ? "Комната не найдена" : "Создаю пати";
    refs.partyLobbySubtitle.textContent = state.roomLoadError
      ? "Вернись в библиотеку и создай новую комнату."
      : "Готовлю комнату и ссылку для друга.";
    refs.partyRoomCode.textContent = "------";
    refs.partyPlayerCount.textContent = "0 игроков";
    refs.partyStatusCopy.textContent = state.roomLoadError
      ? state.roomLoadError
      : "Сейчас появится код комнаты и кнопки приглашения.";
    refs.partyPlayersList.innerHTML = "";
    refs.partyCopyIconButton.disabled = true;
    refs.partyMenuButton.disabled = true;
    refs.partyInviteButton.disabled = true;
    refs.partyCopyButton.disabled = true;
    refs.partyReadyButton.disabled = true;
    refs.partyPlayButton.disabled = true;
    refs.partyReadyButton.textContent = "Готов";
    refs.partyPlayButton.textContent = "Играть";
    return;
  }

  const players = room.players.filter((player) => !player.spectator);
  const isHost = Boolean(me?.isHost);
  const readyPlayers = players.filter((player) => player.ready).length;
  const canPartyStart = Boolean(isHost && room.canStart && room.status === "lobby" && players.length > 1);
  refs.partyLobbyTitle.textContent = room.game?.title || "Party Room";
  refs.partyLobbySubtitle.textContent =
    canPartyStart
      ? "Оба игрока готовы. Можно запускать."
      : players.length < 2
        ? "Позови друга в комнату."
      : isHost
        ? "Когда второй игрок будет готов, нажми играть."
        : "Нажми готово и жди запуска.";
  refs.partyRoomCode.textContent = room.id;
  refs.partyPlayerCount.textContent = `${players.length} ${pluralizeRu(players.length, "игрок", "игрока", "игроков")}`;
  refs.partyStatusCopy.textContent =
    canPartyStart
      ? "Комната готова. Нажми «Играть», и игра откроется у всех."
      : players.length < 2
        ? "Нажми «Пригласить друга» и отправь ссылку в Telegram."
        : !isHost
          ? me?.ready
            ? "Ты готов. Жди, пока хост нажмёт играть."
            : "Нажми «Готов», чтобы хост смог запустить игру."
          : `Готовы ${readyPlayers} из ${players.length}.`;

  refs.partyPlayersList.innerHTML = "";
  for (const player of room.players) {
    const item = document.createElement("div");
    item.className = `party-lobby__player${player.isHost ? " party-lobby__player--host" : ""}`;
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <span>${player.isHost ? "Хост" : player.spectator ? "Наблюдатель" : `Игрок ${player.slot}`}</span>
      </div>
      <b class="${player.ready ? "party-lobby__state party-lobby__state--ready" : "party-lobby__state"}">
        ${player.spectator ? "Смотрит" : player.ready ? "Готов" : "Ждёт"}
      </b>
    `;
    refs.partyPlayersList.appendChild(item);
  }

  refs.partyCopyIconButton.disabled = false;
  refs.partyMenuButton.disabled = false;
  refs.partyInviteButton.disabled = false;
  refs.partyInviteButton.textContent = "Пригласить друга";
  refs.partyCopyButton.disabled = false;
  refs.partyCopyButton.textContent = "Скопировать ссылку";
  refs.partyReadyButton.disabled = room.status !== "lobby" || Boolean(me?.spectator);
  refs.partyReadyButton.textContent = me?.ready ? "Снять готовность" : "Готов";
  refs.partyPlayButton.textContent = isHost ? "Играть" : "Ждём хоста";
  refs.partyPlayButton.disabled = !canPartyStart;
}

function renderPartyLobby(room, me) {
  const lobbyActive = shouldShowPartyLobby();

  refs.partyLobby.classList.toggle("hidden", !lobbyActive);
  refs.partyLobby.setAttribute("aria-hidden", String(!lobbyActive));
  if (!lobbyActive) {
    return;
  }

  refs.partyNicknameInput.value = state.nickname;

  if (!room) {
    refs.partyLobbyTitle.textContent = state.roomLoadError ? "ROOM NOT FOUND" : "CREATING PARTY";
    refs.partyLobbySubtitle.textContent = state.roomLoadError
      ? "Return to the library and create a new room."
      : "Preparing room code and invite actions.";
    refs.partyRoomCode.textContent = "------";
    refs.partyPlayerCount.textContent = "0 PLAYERS";
    refs.partyGameCover.src = "";
    refs.partyGameCover.alt = "";
    refs.partyGameTitle.textContent = "CURRENT GAME";
    refs.partyGameMeta.innerHTML = `
      <span class="party-lobby__meta-chip">WAITING</span>
      <span class="party-lobby__meta-chip">ROOM</span>
    `;
    refs.partyStatusCopy.textContent = state.roomLoadError
      ? state.roomLoadError
      : "The room code and invite controls will appear in a moment.";
    refs.partyPlayersList.innerHTML = "";
    refs.partyCopyIconButton.disabled = true;
    refs.partyMenuButton.disabled = true;
    refs.partyInviteButton.disabled = true;
    refs.partyCopyButton.disabled = true;
    refs.partyReadyButton.disabled = true;
    refs.partyPlayButton.disabled = true;
    refs.partyInviteButton.textContent = "INVITE FRIEND";
    refs.partyCopyButton.textContent = "COPY LINK";
    refs.partyReadyButton.textContent = "READY";
    refs.partyPlayButton.textContent = "START GAME";
    return;
  }

  const players = room.players.filter((player) => !player.spectator);
  const isHost = Boolean(me?.isHost);
  const readyPlayers = players.filter((player) => player.ready).length;
  const canPartyStart = Boolean(isHost && room.canStart && room.status === "lobby" && players.length > 1);

  refs.partyLobbyTitle.textContent = room.game?.title || "PARTY MODE";
  refs.partyLobbySubtitle.textContent =
    canPartyStart
      ? "Both players are ready. Start the game."
      : players.length < 2
        ? "Invite a friend to join the room."
        : isHost
          ? "Start once the second player is ready."
          : "Press READY and wait for the host.";
  refs.partyRoomCode.textContent = room.id;
  refs.partyPlayerCount.textContent = `${players.length} ${pluralizeEn(players.length, "PLAYER", "PLAYERS")}`;
  refs.partyGameCover.src = room.game?.coverUrl || "";
  refs.partyGameCover.alt = room.game?.title || "";
  refs.partyGameTitle.textContent = room.game?.title || "CURRENT GAME";
  refs.partyGameMeta.innerHTML = `
    <span class="party-lobby__meta-chip">MAPPER ${room.game?.mapper ?? "-"}</span>
    <span class="party-lobby__meta-chip">${room.game?.prgKb ?? "--"} KB</span>
    <span class="party-lobby__meta-chip">${players.length}P ROOM</span>
  `;
  refs.partyStatusCopy.textContent =
    canPartyStart
      ? "The room is ready. Press START GAME and launch for everyone."
      : players.length < 2
        ? "Press INVITE FRIEND and send the Telegram room link."
        : !isHost
          ? me?.ready
            ? "You are ready. Wait for the host to start."
            : "Press READY so the host can launch the game."
          : `${readyPlayers} / ${players.length} players are ready.`;

  refs.partyPlayersList.innerHTML = "";
  room.players.forEach((player, index) => {
    const stateClass = player.spectator
      ? "party-lobby__state party-lobby__state--spectator"
      : player.ready
        ? "party-lobby__state party-lobby__state--ready"
        : "party-lobby__state party-lobby__state--waiting";
    const stateLabel = player.spectator ? "WATCHING" : player.ready ? "READY" : "WAITING";
    const item = document.createElement("div");
    item.className = `party-lobby__player${player.isHost ? " party-lobby__player--host" : ""}`;
    item.innerHTML = `
      <div class="party-lobby__player-main">
        <div class="party-lobby__avatar-shell">
          <img src="${getPlayerAvatarSrc(player, index)}" alt="${escapeHtml(player.name)}" loading="lazy" />
        </div>
        <div class="party-lobby__player-copy">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${player.spectator ? "SPECTATOR" : `PLAYER ${player.slot}`}</span>
          ${player.isHost ? '<img class="party-lobby__host-tag" src="/assets/pixel-ui/avatars/badge-host-ribbon-large.png" alt="Host" />' : ""}
        </div>
      </div>
      <b class="${stateClass}">
        ${stateLabel}
      </b>
    `;
    refs.partyPlayersList.appendChild(item);
  });

  refs.partyCopyIconButton.disabled = false;
  refs.partyMenuButton.disabled = false;
  refs.partyInviteButton.disabled = false;
  refs.partyInviteButton.textContent = "INVITE FRIEND";
  refs.partyCopyButton.disabled = false;
  refs.partyCopyButton.textContent = "COPY LINK";
  refs.partyReadyButton.disabled = room.status !== "lobby" || Boolean(me?.spectator);
  refs.partyReadyButton.textContent = me?.ready ? "UNREADY" : "READY";
  refs.partyPlayButton.textContent = isHost ? "START GAME" : "WAIT HOST";
  refs.partyPlayButton.disabled = !canPartyStart;
}

function renderCatalog() {
  refs.catalogCount.textContent = `${state.games.length} games`;
  refs.catalogStatus.textContent = state.games.length ? "Ready to launch" : "Library is empty";
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
          <span>Mapper ${game.mapper}</span>
          <span>${game.prgKb} KB</span>
        </div>
      </div>
      <div class="game-card__actions">
        <button class="primary-button" type="button" data-launch-mode="solo">Play</button>
        <button class="secondary-button" type="button" data-launch-mode="party">Party</button>
      </div>
    `;

    for (const button of card.querySelectorAll("[data-launch-mode]")) {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await createRoomForGame(game.id, button.dataset.launchMode);
        } catch (error) {
          showToast(error.message);
        } finally {
          button.disabled = false;
        }
      });
    }

    refs.gameGrid.appendChild(card);
  }

  renderMiniLibrary();
}

function renderRoom() {
  const room = state.currentRoom;
  const soloLaunchActive = shouldShowSoloLaunch(room);
  const partyUiActive = shouldUsePartyUi();
  refs.copyLink.textContent = state.telegram?.isMiniApp ? "Позвать друга" : "Копировать ссылку";

  if (!room) {
    if (soloLaunchActive) {
      refs.roomTitle.textContent = "Запускаю игру";
      refs.roomSubtitle.textContent = "Готовлю экран и подключаю сессию.";
      refs.screenOverlay.textContent = state.roomLoadError || "Запускаю игру...";
      refs.screenOverlay.classList.remove("hidden");
    } else if (partyUiActive) {
      refs.roomTitle.textContent = "Пати";
      refs.roomSubtitle.textContent = state.roomLoadError || "Создаю комнату для друга.";
      refs.screenOverlay.textContent = "Жду запуск сессии";
      refs.screenOverlay.classList.remove("hidden");
    } else {
      refs.roomTitle.textContent = "Комната не найдена";
      refs.roomSubtitle.textContent = "Создай новую комнату из библиотеки.";
      refs.screenOverlay.textContent = "Жду запуск сессии";
      refs.screenOverlay.classList.remove("hidden");
    }
    refs.playersList.innerHTML = "";
    renderPartyLobby(null, null);
    refs.mobileRoomBadge.textContent = soloLaunchActive ? "СТАРТ" : partyUiActive ? "ПАТИ" : "КОМНАТА";
    updateFullscreenUi();
    return;
  }

  const playerNames = room.players.map((player) => player.name).join(", ");
  const me = getCurrentPlayer(room);
  const isHost = Boolean(me?.isHost);
  const isSpectator = Boolean(me?.spectator);
  const canReady = room.status === "lobby" && !isSpectator;
  const amReady = Boolean(me?.ready);

  refs.roomTitle.textContent = room.game?.title || "Комната";
  refs.roomSubtitle.textContent =
    room.status === "running"
      ? `Комната ${room.id} • игра идёт`
      : playerNames
        ? `В комнате: ${playerNames} • код ${room.id}`
        : `Комната ${room.id} • ждёт игроков`;
  refs.roomCover.src = room.game?.coverUrl || "";
  refs.roomCover.alt = room.game?.title || "";
  refs.readySummary.textContent = room.canStart ? "Можно стартовать" : room.status === "running" ? "Сессия в игре" : "Не готово";
  refs.statusTitle.textContent =
    room.status === "running"
      ? room.session?.paused
        ? "Сессия на паузе"
        : "Сетевая сессия активна"
      : "Комната ждёт игроков";
  refs.mobileRoomBadge.textContent = room.id;
  if (soloLaunchActive) {
    refs.screenOverlay.textContent = "Подключаю сессию...";
    refs.screenOverlay.classList.remove("hidden");
  }
  if (partyUiActive && room.status !== "running") {
    refs.screenOverlay.textContent = "Жду запуск сессии";
    refs.screenOverlay.classList.remove("hidden");
  }

  refs.toggleReady.disabled = !canReady;
  refs.toggleReady.textContent = amReady ? "Снять готовность" : "Готов";
  refs.startSession.disabled = !(isHost && room.canStart && room.status === "lobby");
  refs.pauseSession.disabled = !(isHost && room.status === "running" && !room.session?.paused);
  refs.resumeSession.disabled = !(isHost && room.status === "running" && room.session?.paused);
  refs.stopSession.disabled = !(isHost && room.status === "running");
  refs.nicknameInput.disabled = room.status === "running";
  refs.inputDelay.disabled = !isHost || room.status === "running";

  renderPlayers(room);
  renderPartyLobby(room, me);
  updateFullscreenUi();
}

async function syncRoute() {
  const route = parseRoute();

  if (route.kind === "library") {
    state.currentRoomId = null;
    state.currentRoom = null;
    state.participant = null;
    state.roomUiMode = null;
    state.roomLoadError = "";
    state.pendingRoomLaunch = null;
    setSelectedConsole("");
    socket.emit("room:leave");
    releaseAllTouchControls();

    if (!state.telegram?.isMiniApp) {
      await exitFullscreenMode();
    } else {
      await ensureMiniAppFullscreen();
      updateFullscreenUi();
    }

    await emulator.stop();
    setView("library");
    renderCatalog();
    return;
  }

  setView("room");
  state.currentRoomId = route.roomId;
  state.roomLoadError = "";
  if (state.pendingRoomLaunch?.roomId === route.roomId) {
    state.roomUiMode = state.pendingRoomLaunch.mode === "solo" ? "solo" : "party";
  } else if (state.telegram?.isMiniApp && state.isMobileDevice) {
    state.roomUiMode = "party";
  } else {
    state.roomUiMode = null;
  }

  if (shouldShowSoloLaunch(null) || shouldShowPartyLobby(null)) {
    state.currentRoom = null;
    state.participant = null;
    renderRoom();
  }

  try {
    const payload = await fetchJson(`/api/rooms/${route.roomId}`);
    state.currentRoom = payload.room;
    state.participant = null;
    state.roomLoadError = "";
    renderRoom();
    await maybeHandlePendingRoomLaunch();
    if (socket.connected) {
      socket.emit("room:join", {
        roomId: route.roomId,
        name: state.nickname || "Игрок",
      });
    }
  } catch (error) {
    state.currentRoom = null;
    state.participant = null;
    state.pendingRoomLaunch = null;
    state.roomLoadError = error.message;
    renderRoom();
  }
}

refs.copyLink.replaceWith(refs.copyLink.cloneNode(true));
refs.copyLink = document.querySelector("#copy-link");
refs.copyLink.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  await shareCurrentRoomLink(state.currentRoom);
});

socket.off("room:joined");
socket.on("room:joined", ({ room, participant }) => {
  state.currentRoom = room;
  state.participant = participant;
  state.roomLoadError = "";
  renderRoom();
  void maybeHandlePendingRoomLaunch();
});

socket.off("room:state");
socket.on("room:state", (room) => {
  if (room.id !== state.currentRoomId) {
    return;
  }

  state.currentRoom = room;
  state.roomLoadError = "";
  renderRoom();
  void maybeHandlePendingRoomLaunch();
});

socket.off("session:starting");
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
    await enterFullscreenMode();
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
    state.pendingRoomLaunch = null;
  } catch (error) {
    releaseAllTouchControls();
    await emulator.stop(error.message);
    console.error(error);
  }
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
  if (state.currentRoomId && state.fullscreenActive) {
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
refs.partyNicknameInput.value = state.nickname;
refs.inputDelay.value = String(state.inputDelayFrames);

bindTouchControls();
refreshDeviceMode();
await ensureMiniAppFullscreen();

const initialCatalog = await fetchJson("/api/games");
state.games = initialCatalog.games;
renderCatalog();
renderRoom();
await syncRoute();
