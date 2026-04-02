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
const RECENT_ROOM_STORAGE_KEY = "nes-switch-online:recent-room";
const RECENT_GAMES_STORAGE_KEY = "nes-switch-online:recent-games";
const IN_GAME_SAVE_STORAGE_PREFIX = "nes-switch-online:in-game-saves:v1";
const MAX_RECENT_GAMES = 6;
const MAX_SPOTLIGHT_GAMES = 3;
const IN_GAME_SAVE_SLOT_COUNT = 4;
const CONSOLE_OPTIONS = [
  {
    id: "nes",
    label: "NES",
    subtitle: "Nintendo Entertainment System",
    description: "Playable now",
    status: "Live",
    imageSrc: "/assets/console-cards/png/nes-card.png",
    available: true,
  },
  {
    id: "snes",
    label: "SNES",
    subtitle: "Super Nintendo",
    description: "Coming soon",
    status: "Soon",
    imageSrc: "/assets/console-cards/png/snes-card.png",
    available: false,
  },
  {
    id: "gb",
    label: "Game Boy",
    subtitle: "Pocket handheld",
    description: "Coming soon",
    status: "Soon",
    imageSrc: "/assets/console-cards/png/gameboy-card.png",
    available: false,
  },
  {
    id: "sega",
    label: "Sega",
    subtitle: "Mega Drive",
    description: "Coming soon",
    status: "Soon",
    imageSrc: "/assets/console-cards/png/sega-card.png",
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
const GAME_TAG_PATTERNS = [
  { tag: "2P", score: 5, pattern: /(contra|chip|dale|double dragon|battletoads|tmnt|ice climber|mario bros|river city|gauntlet|tennis|soccer|track|field|wrestle|blades of steel)/i },
  { tag: "Fast", score: 3, pattern: /(tetris|dr\.?\s*mario|pac|galaga|balloon|duck|pinball|excitebike|arkanoid|mario|ninja)/i },
  { tag: "Hard", score: 2, pattern: /(castlevania|ninja gaiden|ghosts|goblins|battletoads|mega man|gradius)/i },
  { tag: "Co-op", score: 4, pattern: /(contra|chip|dale|double dragon|river city|ice climber|gauntlet|tmnt)/i },
];

function readJsonStorage(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function writeJsonStorage(key, value) {
  try {
    if (value == null) {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures.
  }
}

function tryWriteJsonStorage(key, value) {
  try {
    if (value == null) {
      localStorage.removeItem(key);
      return true;
    }

    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function loadRecentRoom() {
  const value = readJsonStorage(RECENT_ROOM_STORAGE_KEY, null);
  if (!value || typeof value !== "object") {
    return null;
  }

  const roomId = typeof value.roomId === "string" ? value.roomId.trim().toUpperCase() : "";
  if (!roomId) {
    return null;
  }

  return {
    roomId,
    sharePath: typeof value.sharePath === "string" && value.sharePath ? value.sharePath : `/room/${roomId}`,
    gameId: typeof value.gameId === "string" ? value.gameId : "",
    gameTitle: typeof value.gameTitle === "string" ? value.gameTitle : "",
    coverUrl: typeof value.coverUrl === "string" ? value.coverUrl : "",
    mode: value.mode === "solo" ? "solo" : "party",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function loadRecentGameIds() {
  const value = readJsonStorage(RECENT_GAMES_STORAGE_KEY, []);
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => typeof entry === "string" && entry).slice(0, MAX_RECENT_GAMES);
}

const state = {
  games: [],
  currentRoom: null,
  participant: null,
  currentRoomId: null,
  roomUiMode: null,
  roomLoadError: "",
  nickname: localStorage.getItem("nes-switch-online:nickname") || "",
  inputDelayFrames: Number(localStorage.getItem("nes-switch-online:input-delay") || 4),
  selectedConsoleId: "",
  selectedGameId: localStorage.getItem(SELECTED_GAME_STORAGE_KEY) || "",
  librarySearchQuery: "",
  isMobileDevice: false,
  fallbackFullscreen: false,
  fullscreenActive: false,
  telegram: null,
  pendingRoomLaunch: null,
  recentRoom: loadRecentRoom(),
  recentGameIds: loadRecentGameIds(),
  inGameMenuOpen: false,
  inGameMenuView: "root",
  inGameMenuSelection: 0,
  inGameMenuStatus: "",
};

const refs = {
  appShell: document.querySelector(".app-shell"),
  libraryView: document.querySelector("#library-view"),
  roomView: document.querySelector("#room-view"),
  roomHead: document.querySelector(".room-head"),
  nesRoom: document.querySelector(".nes-room"),
  deckPanel: document.querySelector(".deck-panel"),
  catalogCount: document.querySelector("#catalog-count"),
  catalogStatus: document.querySelector("#catalog-status"),
  libraryHub: document.querySelector("#library-hub"),
  libraryHubTitle: document.querySelector("#library-hub-title"),
  libraryHubCopy: document.querySelector("#library-hub-copy"),
  hubCatalogCount: document.querySelector("#hub-catalog-count"),
  hubCatalogStatus: document.querySelector("#hub-catalog-status"),
  hubPartyButton: document.querySelector("#hub-party-button"),
  hubPlayButton: document.querySelector("#hub-play-button"),
  hubRefreshButton: document.querySelector("#hub-refresh-button"),
  hubFeaturedTitle: document.querySelector("#hub-featured-title"),
  hubFeaturedCopy: document.querySelector("#hub-featured-copy"),
  hubFeaturedTags: document.querySelector("#hub-featured-tags"),
  hubRecentCard: document.querySelector("#hub-recent-card"),
  hubRecentTitle: document.querySelector("#hub-recent-title"),
  hubRecentCopy: document.querySelector("#hub-recent-copy"),
  hubResumeButton: document.querySelector("#hub-resume-button"),
  spotlightSection: document.querySelector("#spotlight-section"),
  spotlightGrid: document.querySelector("#spotlight-grid"),
  gameGrid: document.querySelector("#game-grid"),
  emptyLibrary: document.querySelector("#empty-library"),
  refreshLibrary: document.querySelector("#refresh-library"),
  miniLibraryScreen: document.querySelector("#mini-library-screen"),
  miniProfileButton: document.querySelector("#mini-profile-button"),
  miniProfileInitials: document.querySelector("#mini-profile-initials"),
  miniConsoleBack: document.querySelector("#mini-console-back"),
  miniLibrarySearchWrap: document.querySelector("#mini-library-search-wrap"),
  miniLibrarySearch: document.querySelector("#mini-library-search"),
  miniLibraryHeroTitle: document.querySelector("#mini-library-hero-title"),
  miniLibraryHeroSubtitle: document.querySelector("#mini-library-hero-subtitle"),
  miniResumeCard: document.querySelector("#mini-resume-card"),
  miniResumeMeta: document.querySelector("#mini-resume-meta"),
  miniResumeButton: document.querySelector("#mini-resume-button"),
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
  partySaveButton: document.querySelector("#party-save-button"),
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
  gbaSpPowerButton: document.querySelector(".gba-sp-power"),
  touchDpad: document.querySelector("#touch-dpad"),
  touchButtons: Array.from(document.querySelectorAll("[data-touch-bit]")),
  fullscreenButtons: [
    document.querySelector("#toggle-fullscreen"),
    document.querySelector("#screen-fullscreen-button"),
  ].filter(Boolean),
};

if (!refs.partySaveButton && refs.partyPlayButton?.parentElement) {
  const partySaveButton = document.createElement("button");
  partySaveButton.id = "party-save-button";
  partySaveButton.className = "secondary-button";
  partySaveButton.type = "button";
  partySaveButton.textContent = "Запустить сейв";
  refs.partyPlayButton.parentElement.appendChild(partySaveButton);
  refs.partySaveButton = partySaveButton;
}

if (refs.partyLobby && refs.partyBackButton && refs.partyInviteButton && refs.partyReadyButton && refs.partyPlayButton && refs.partySaveButton) {
  const partyScreen = document.createElement("section");
  partyScreen.id = "party-screen";
  partyScreen.className = "view hidden";

  const partyMenuScreen = document.createElement("div");
  partyMenuScreen.className = "party-room-menu";

  refs.partyMenuButton.setAttribute("aria-label", "Закрыть");
  refs.partyMenuButton.innerHTML = '<span class="party-icon-button__glyph" aria-hidden="true">×</span>';
  refs.partyCopyIconButton.setAttribute("aria-label", "Скопировать ссылку");
  refs.partyCopyIconButton.innerHTML = '<span class="party-icon-button__glyph" aria-hidden="true">⧉</span>';

  const partyMenuBar = document.createElement("div");
  partyMenuBar.className = "party-room-menu__bar";

  const partyMenuBarTitle = document.createElement("strong");
  partyMenuBarTitle.className = "party-room-menu__bar-title";
  partyMenuBarTitle.textContent = "Party";

  partyMenuBar.append(refs.partyBackButton, partyMenuBarTitle, refs.partyMenuButton);

  const partyInviteHeading = document.createElement("div");
  partyInviteHeading.className = "party-room-menu__section-head";
  partyInviteHeading.innerHTML = `
    <span aria-hidden="true"></span>
    <h2>Пригласите друзей</h2>
    <span aria-hidden="true"></span>
  `;

  const partyMenuGame = document.createElement("div");
  partyMenuGame.className = "party-room-menu__game";

  const partyMenuCover = document.createElement("div");
  partyMenuCover.className = "party-room-menu__cover";

  const partyMenuCoverImage = document.createElement("img");
  partyMenuCoverImage.alt = "";
  partyMenuCover.appendChild(partyMenuCoverImage);

  const partyMenuTitle = document.createElement("strong");
  partyMenuTitle.className = "party-room-menu__title";
  partyMenuTitle.textContent = "Выбранная игра";

  partyMenuGame.append(partyMenuCover, partyMenuTitle);

  const partyMenuInviteInfo = document.createElement("div");
  partyMenuInviteInfo.className = "party-room-menu__invite-info";

  const partyMenuPlayersMeta = document.createElement("p");
  partyMenuPlayersMeta.className = "party-room-menu__players-meta";
  partyMenuPlayersMeta.textContent = "0 игроков";

  const partyMenuCodeLabel = document.createElement("span");
  partyMenuCodeLabel.className = "party-room-menu__eyebrow";
  partyMenuCodeLabel.textContent = "Код комнаты";

  const partyMenuCodeRow = document.createElement("div");
  partyMenuCodeRow.className = "party-room-menu__code-row";

  const partyMenuCode = document.createElement("strong");
  partyMenuCode.className = "party-room-menu__code-badge";
  partyMenuCode.textContent = "------";

  partyMenuCodeRow.append(partyMenuCode, refs.partyCopyIconButton);

  const partyMenuInviteMeta = document.createElement("p");
  partyMenuInviteMeta.className = "party-room-menu__invite-meta";
  partyMenuInviteMeta.textContent = "Открой комнату для друзей и поделись ссылкой через Telegram.";

  partyMenuInviteInfo.append(
    partyMenuPlayersMeta,
    partyMenuCodeLabel,
    partyMenuCodeRow,
    partyMenuInviteMeta,
  );

  const partyMenuInviteCard = document.createElement("section");
  partyMenuInviteCard.className = "party-room-menu__invite-card";
  partyMenuInviteCard.append(partyMenuGame, partyMenuInviteInfo);

  const partyPlayersHeading = document.createElement("div");
  partyPlayersHeading.className = "party-room-menu__players-headline";
  partyPlayersHeading.innerHTML = `
    <h2>Игроки</h2>
    <span aria-hidden="true"></span>
  `;

  const partyMenuPlayers = document.createElement("div");
  partyMenuPlayers.className = "party-room-menu__players";

  const partyMenuLimit = document.createElement("p");
  partyMenuLimit.className = "party-room-menu__limit";
  partyMenuLimit.textContent = "Лимит: 2 - 4 игрока";

  const partyMenuPlayersPanel = document.createElement("section");
  partyMenuPlayersPanel.className = "party-room-menu__players-panel";
  partyMenuPlayersPanel.append(partyMenuPlayers, partyMenuLimit);

  const partyMenuSecondaryActions = document.createElement("div");
  partyMenuSecondaryActions.className = "party-room-menu__secondary-actions";
  partyMenuSecondaryActions.append(refs.partyReadyButton, refs.partySaveButton);

  const partyMenuActions = document.createElement("div");
  partyMenuActions.className = "party-room-menu__actions";
  partyMenuActions.append(refs.partyInviteButton, refs.partyPlayButton);

  const partyMenuStatus = document.createElement("p");
  partyMenuStatus.className = "party-room-menu__status";
  partyMenuStatus.textContent = "Подожди друзей или стартуй, когда все будут готовы.";

  partyMenuScreen.append(
    partyMenuBar,
    partyInviteHeading,
    partyMenuInviteCard,
    partyPlayersHeading,
    partyMenuPlayersPanel,
    partyMenuSecondaryActions,
    partyMenuActions,
    partyMenuStatus,
  );
  partyScreen.appendChild(partyMenuScreen);
  refs.appShell?.appendChild(partyScreen);
  refs.partyScreen = partyScreen;
  refs.partyMenuScreen = partyMenuScreen;
  refs.partyMenuGame = partyMenuGame;
  refs.partyMenuBarTitle = partyMenuBarTitle;
  refs.partyMenuCoverImage = partyMenuCoverImage;
  refs.partyMenuTitle = partyMenuTitle;
  refs.partyMenuPlayersMeta = partyMenuPlayersMeta;
  refs.partyMenuCode = partyMenuCode;
  refs.partyMenuInviteMeta = partyMenuInviteMeta;
  refs.partyMenuPlayers = partyMenuPlayers;
  refs.partyMenuLimit = partyMenuLimit;
  refs.partyMenuStatus = partyMenuStatus;
  refs.partyMenuActions = partyMenuActions;

  const partySaveScreen = document.createElement("section");
  partySaveScreen.id = "party-save-screen";
  partySaveScreen.className = "view hidden";

  const partySaveMenu = document.createElement("div");
  partySaveMenu.className = "save-room-menu";

  const partySaveBar = document.createElement("div");
  partySaveBar.className = "save-room-menu__bar";

  const partySaveBackButton = document.createElement("button");
  partySaveBackButton.id = "party-save-back-button";
  partySaveBackButton.className = "party-chip party-chip--back";
  partySaveBackButton.type = "button";
  partySaveBackButton.innerHTML = `
    <span class="party-chip__arrow" aria-hidden="true"></span>
    <span>Назад</span>
  `;

  const partySaveBarTitle = document.createElement("strong");
  partySaveBarTitle.className = "save-room-menu__bar-title";
  partySaveBarTitle.textContent = "Выберите сейв";

  const partySaveCloseButton = document.createElement("button");
  partySaveCloseButton.id = "party-save-close-button";
  partySaveCloseButton.className = "party-icon-button";
  partySaveCloseButton.type = "button";
  partySaveCloseButton.setAttribute("aria-label", "Закрыть");
  partySaveCloseButton.innerHTML = '<span class="party-icon-button__glyph" aria-hidden="true">×</span>';

  partySaveBar.append(partySaveBackButton);

  const partySaveSectionHead = document.createElement("div");
  partySaveSectionHead.className = "save-room-menu__section-head";
  partySaveSectionHead.innerHTML = `
    <span aria-hidden="true"></span>
    <h2>Выберите сейв</h2>
    <span aria-hidden="true"></span>
  `;

  const partySavePanel = document.createElement("section");
  partySavePanel.className = "save-room-menu__panel";

  const partySaveSlots = document.createElement("div");
  partySaveSlots.className = "save-room-menu__slots";
  partySavePanel.appendChild(partySaveSlots);

  const partySaveCancelButton = document.createElement("button");
  partySaveCancelButton.id = "party-save-cancel-button";
  partySaveCancelButton.className = "secondary-button";
  partySaveCancelButton.type = "button";
  partySaveCancelButton.textContent = "Отмена";

  partySaveMenu.append(
    partySaveBar,
    partySaveSectionHead,
    partySavePanel,
  );
  partySaveScreen.appendChild(partySaveMenu);
  refs.appShell?.appendChild(partySaveScreen);

  refs.partySaveScreen = partySaveScreen;
  refs.partySaveMenu = partySaveMenu;
  refs.partySaveBackButton = partySaveBackButton;
  refs.partySaveCloseButton = partySaveCloseButton;
  refs.partySaveBarTitle = partySaveBarTitle;
  refs.partySaveSlots = partySaveSlots;
  refs.partySaveCancelButton = partySaveCancelButton;
}

if (refs.mobileScreenShell) {
  const inGameMenu = document.createElement("section");
  inGameMenu.id = "in-game-menu";
  inGameMenu.className = "mobile-in-game-menu hidden";
  inGameMenu.setAttribute("aria-hidden", "true");

  const inGameMenuPanel = document.createElement("div");
  inGameMenuPanel.className = "mobile-in-game-menu__panel";

  const inGameMenuHeader = document.createElement("div");
  inGameMenuHeader.className = "mobile-in-game-menu__header";

  const inGameMenuEyebrow = document.createElement("span");
  inGameMenuEyebrow.className = "mobile-in-game-menu__eyebrow";
  inGameMenuEyebrow.textContent = "PAUSE";

  const inGameMenuTitle = document.createElement("strong");
  inGameMenuTitle.className = "mobile-in-game-menu__title";
  inGameMenuTitle.textContent = "Меню";

  const inGameMenuSubtitle = document.createElement("span");
  inGameMenuSubtitle.className = "mobile-in-game-menu__subtitle";
  inGameMenuSubtitle.textContent = "Выбери действие";

  inGameMenuHeader.append(inGameMenuEyebrow, inGameMenuTitle, inGameMenuSubtitle);

  const inGameMenuActions = document.createElement("div");
  inGameMenuActions.className = "mobile-in-game-menu__actions";

  const inGameMenuSlots = document.createElement("div");
  inGameMenuSlots.className = "mobile-in-game-menu__slots hidden";

  const inGameMenuStatus = document.createElement("p");
  inGameMenuStatus.className = "mobile-in-game-menu__status hidden";

  const inGameMenuHint = document.createElement("p");
  inGameMenuHint.className = "mobile-in-game-menu__hint";
  inGameMenuHint.textContent = "Крестовина - выбор  •  A - OK  •  B - назад";

  inGameMenuPanel.append(
    inGameMenuHeader,
    inGameMenuActions,
    inGameMenuSlots,
    inGameMenuStatus,
    inGameMenuHint,
  );
  inGameMenu.appendChild(inGameMenuPanel);
  refs.mobileScreenShell.appendChild(inGameMenu);

  refs.inGameMenu = inGameMenu;
  refs.inGameMenuPanel = inGameMenuPanel;
  refs.inGameMenuEyebrow = inGameMenuEyebrow;
  refs.inGameMenuTitle = inGameMenuTitle;
  refs.inGameMenuSubtitle = inGameMenuSubtitle;
  refs.inGameMenuActions = inGameMenuActions;
  refs.inGameMenuSlots = inGameMenuSlots;
  refs.inGameMenuStatus = inGameMenuStatus;
  refs.inGameMenuHint = inGameMenuHint;
}

if (refs.gbaSpPowerButton) {
  refs.gbaSpPowerButton.setAttribute("role", "button");
  refs.gbaSpPowerButton.setAttribute("tabindex", "0");
  refs.gbaSpPowerButton.setAttribute("aria-label", "Открыть игровое меню");
  refs.gbaSpPowerButton.setAttribute("aria-hidden", "false");
}

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
  const partySavesMatch = window.location.pathname.match(/^\/party\/([A-Z0-9]+)\/saves$/i);
  if (partySavesMatch) {
    return { kind: "party-saves", roomId: partySavesMatch[1].toUpperCase() };
  }

  const partyMatch = window.location.pathname.match(/^\/party\/([A-Z0-9]+)$/i);
  if (partyMatch) {
    return { kind: "party", roomId: partyMatch[1].toUpperCase() };
  }

  const roomMatch = window.location.pathname.match(/^\/room\/([A-Z0-9]+)$/i);
  return roomMatch
    ? { kind: "room", roomId: roomMatch[1].toUpperCase() }
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

function getInGameMenuGame(room = state.currentRoom) {
  return (
    room?.game ||
    (state.selectedGameId ? state.games.find((game) => game.id === state.selectedGameId) ?? null : null) ||
    getPrimaryLaunchGame(getVisibleLibraryGames()) ||
    getPrimaryLaunchGame() ||
    null
  );
}

function getInGameSaveStorageKey(gameId) {
  return `${IN_GAME_SAVE_STORAGE_PREFIX}:${gameId}`;
}

function getInGameSavePermission(room = state.currentRoom) {
  const activePlayers = room?.players?.filter((player) => !player.spectator) ?? [];
  const me = getCurrentPlayer(room);

  if (!room?.id || room.status !== "running") {
    return {
      allowed: false,
      reason: "Сначала запусти игру.",
    };
  }

  if (activePlayers.length <= 1 || me?.isHost) {
    return {
      allowed: true,
      reason: "",
    };
  }

  return {
    allowed: false,
    reason: "В пати сейвы может открывать только хост.",
  };
}

function getInGameSaveRecords(game = getInGameMenuGame()) {
  if (!game?.id) {
    return {};
  }

  const value = readJsonStorage(getInGameSaveStorageKey(game.id), {});
  return value && typeof value === "object" ? value : {};
}

function formatInGameSaveTimestamp(savedAt) {
  if (!savedAt) {
    return "";
  }

  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getInGameSaveSlots(game = getInGameMenuGame()) {
  const records = getInGameSaveRecords(game);

  return Array.from({ length: IN_GAME_SAVE_SLOT_COUNT }, (_, index) => {
    const slotId = index + 1;
    const record = records[`slot-${slotId}`];
    const filled = Boolean(record?.snapshot);

    return {
      id: `slot-${slotId}`,
      slotId,
      filled,
      title: filled ? record.title || game?.title || `Слот ${slotId}` : `Слот ${slotId}`,
      subtitle: filled
        ? `Сохранено ${formatInGameSaveTimestamp(record.savedAt) || "только что"}`
        : "Свободный слот",
      coverUrl: filled ? record.coverUrl || game?.coverUrl || "" : game?.coverUrl || "",
      savedAt: filled ? record.savedAt || "" : "",
      snapshot: filled ? record.snapshot : null,
    };
  });
}

function getInGameRootItems(room = state.currentRoom) {
  const permission = getInGameSavePermission(room);

  return [
    {
      id: "continue",
      label: "Продолжить",
      disabled: false,
      reason: "",
    },
    {
      id: "save",
      label: "Сохранить",
      disabled: !permission.allowed,
      reason: permission.reason,
    },
    {
      id: "load",
      label: "Загрузить",
      disabled: !permission.allowed,
      reason: permission.reason,
    },
  ];
}

function getInGameMenuItems() {
  if (state.inGameMenuView === "root") {
    return getInGameRootItems();
  }

  return getInGameSaveSlots();
}

function setInGameMenuStatus(message = "") {
  state.inGameMenuStatus = String(message || "").trim();
}

function clampInGameMenuSelection() {
  const items = getInGameMenuItems();
  if (!items.length) {
    state.inGameMenuSelection = 0;
    return;
  }

  state.inGameMenuSelection = Math.max(0, Math.min(items.length - 1, state.inGameMenuSelection));
}

function canOpenInGameMenu(room = state.currentRoom) {
  return Boolean(
    refs.inGameMenu &&
    refs.mobileScreenShell &&
    refs.mobileHandheld &&
    state.isMobileDevice &&
    !refs.mobileHandheld.classList.contains("hidden") &&
    room?.status === "running" &&
    emulator.running,
  );
}

function renderInGameMenu() {
  if (!refs.inGameMenu || !refs.inGameMenuActions || !refs.inGameMenuSlots) {
    return;
  }

  const visible = state.inGameMenuOpen && canOpenInGameMenu();
  refs.inGameMenu.classList.toggle("hidden", !visible);
  refs.inGameMenu.setAttribute("aria-hidden", String(!visible));

  if (!visible) {
    refs.inGameMenu.dataset.view = "hidden";
    return;
  }

  const game = getInGameMenuGame();
  const showingSlots = state.inGameMenuView !== "root";
  const slots = showingSlots ? getInGameSaveSlots(game) : [];
  const items = showingSlots ? slots : getInGameRootItems();

  clampInGameMenuSelection();
  refs.inGameMenu.dataset.view = state.inGameMenuView;
  refs.inGameMenuEyebrow.textContent =
    state.inGameMenuView === "save" ? "SAVE" : state.inGameMenuView === "load" ? "LOAD" : "PAUSE";
  refs.inGameMenuTitle.textContent = game?.title || "Меню";
  refs.inGameMenuSubtitle.textContent =
    state.inGameMenuView === "save"
      ? "Выбери слот для сохранения"
      : state.inGameMenuView === "load"
        ? "Выбери сейв для загрузки"
        : "Выбери действие";
  refs.inGameMenuHint.textContent = showingSlots
    ? "Крестовина - слот  •  A - выбрать  •  B - назад"
    : "Крестовина - выбор  •  A - OK  •  B - назад";

  refs.inGameMenuActions.innerHTML = "";
  refs.inGameMenuSlots.innerHTML = "";
  refs.inGameMenuActions.classList.toggle("hidden", showingSlots);
  refs.inGameMenuSlots.classList.toggle("hidden", !showingSlots);

  if (!showingSlots) {
    for (const [index, item] of items.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `mobile-in-game-menu__action${index === state.inGameMenuSelection ? " is-selected" : ""}`;
      if (item.disabled) {
        button.classList.add("is-disabled");
      }
      button.innerHTML = `
        <span>${escapeHtml(item.label)}</span>
      `;
      button.addEventListener("click", () => {
        state.inGameMenuSelection = index;
        activateInGameMenuSelection();
      });
      refs.inGameMenuActions.appendChild(button);
    }
  } else {
    for (const [index, slot] of slots.entries()) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = `mobile-in-game-menu__slot${slot.filled ? " is-filled" : ""}${index === state.inGameMenuSelection ? " is-selected" : ""}`;
      tile.dataset.slotId = slot.id;

      tile.innerHTML = `
        <span class="mobile-in-game-menu__slot-body">
          <span class="mobile-in-game-menu__slot-cover${slot.coverUrl ? " has-image" : ""}">
            ${slot.coverUrl ? `<img src="${escapeHtml(slot.coverUrl)}" alt="" loading="lazy" />` : "<span>NES</span>"}
          </span>
          <span class="mobile-in-game-menu__slot-copy">
            <span>${escapeHtml(slot.subtitle)}</span>
          </span>
        </span>
      `;

      tile.addEventListener("click", () => {
        state.inGameMenuSelection = index;
        activateInGameMenuSelection();
      });
      refs.inGameMenuSlots.appendChild(tile);
    }
  }

  refs.inGameMenuStatus.textContent = state.inGameMenuStatus;
  refs.inGameMenuStatus.classList.toggle("hidden", !state.inGameMenuStatus);
}

function openInGameMenu(view = "root") {
  if (!canOpenInGameMenu()) {
    return false;
  }

  releaseAllTouchControls();
  state.inGameMenuOpen = true;
  state.inGameMenuView = view;
  state.inGameMenuSelection = 0;
  setInGameMenuStatus("");
  emulator.setMenuPaused(true);
  renderInGameMenu();
  return true;
}

function closeInGameMenu() {
  const wasOpen = state.inGameMenuOpen;
  state.inGameMenuOpen = false;
  state.inGameMenuView = "root";
  state.inGameMenuSelection = 0;
  setInGameMenuStatus("");
  releaseAllTouchControls();
  emulator.setMenuPaused(false);
  renderInGameMenu();
  return wasOpen;
}

function moveInGameMenuSelection(direction) {
  const items = getInGameMenuItems();
  if (!items.length) {
    return;
  }

  const columns = state.inGameMenuView === "root" ? 1 : 2;
  let nextIndex = state.inGameMenuSelection;

  if (columns === 1) {
    if (direction === "up") {
      nextIndex -= 1;
    } else if (direction === "down") {
      nextIndex += 1;
    } else {
      return;
    }
  } else {
    const row = Math.floor(nextIndex / columns);
    const column = nextIndex % columns;
    let nextRow = row;
    let nextColumn = column;

    if (direction === "up") {
      nextRow -= 1;
    } else if (direction === "down") {
      nextRow += 1;
    } else if (direction === "left") {
      nextColumn -= 1;
    } else if (direction === "right") {
      nextColumn += 1;
    } else {
      return;
    }

    nextRow = Math.max(0, Math.min(Math.ceil(items.length / columns) - 1, nextRow));
    nextColumn = Math.max(0, Math.min(columns - 1, nextColumn));
    nextIndex = nextRow * columns + nextColumn;
    if (nextIndex >= items.length) {
      nextIndex = items.length - 1;
    }
  }

  nextIndex = Math.max(0, Math.min(items.length - 1, nextIndex));
  if (nextIndex === state.inGameMenuSelection) {
    return;
  }

  state.inGameMenuSelection = nextIndex;
  renderInGameMenu();
  vibrateTap(10);
}

function persistInGameSave(slotId) {
  const game = getInGameMenuGame();
  const snapshot = emulator.serializeState();
  if (!game?.id || !snapshot) {
    setInGameMenuStatus("Не удалось сохранить сейв.");
    renderInGameMenu();
    return false;
  }

  const records = getInGameSaveRecords(game);
  const nextRecords = {
    ...records,
    [`slot-${slotId}`]: {
      slotId,
      title: game.title || `Слот ${slotId}`,
      coverUrl: game.coverUrl || "",
      savedAt: new Date().toISOString(),
      snapshot,
    },
  };

  if (!tryWriteJsonStorage(getInGameSaveStorageKey(game.id), nextRecords)) {
    setInGameMenuStatus("Память заполнена. Освободи место для сейвов.");
    renderInGameMenu();
    return false;
  }

  setInGameMenuStatus(`Слот ${slotId} сохранен.`);
  renderInGameMenu();
  return true;
}

function broadcastLoadedSave(snapshot) {
  const room = state.currentRoom;
  const activePlayers = room?.players?.filter((player) => !player.spectator) ?? [];
  const me = getCurrentPlayer(room);

  if (!snapshot || !room?.id || activePlayers.length <= 1 || !me?.isHost) {
    return;
  }

  socket.emit("session:snapshot", {
    roomId: room.id,
    frame: emulator.localFrame,
    state: snapshot,
  });
}

function restoreInGameSave(slotId) {
  const slot = getInGameSaveSlots().find((entry) => entry.slotId === slotId);
  if (!slot?.snapshot) {
    setInGameMenuStatus("Этот слот пока пустой.");
    renderInGameMenu();
    return false;
  }

  if (!emulator.restoreState(slot.snapshot)) {
    setInGameMenuStatus("Не получилось загрузить сейв.");
    renderInGameMenu();
    return false;
  }

  broadcastLoadedSave(slot.snapshot);
  closeInGameMenu();
  return true;
}

function handleInGameMenuBack() {
  if (!state.inGameMenuOpen) {
    return false;
  }

  vibrateTap(10);
  if (state.inGameMenuView === "root") {
    closeInGameMenu();
    return true;
  }

  state.inGameMenuView = "root";
  state.inGameMenuSelection = 0;
  setInGameMenuStatus("");
  renderInGameMenu();
  return true;
}

function activateInGameMenuSelection() {
  if (!state.inGameMenuOpen) {
    return false;
  }

  const items = getInGameMenuItems();
  const current = items[state.inGameMenuSelection];
  if (!current) {
    return false;
  }

  vibrateTap(14);
  if (state.inGameMenuView === "root") {
    if (current.disabled) {
      setInGameMenuStatus(current.reason || "Сейчас недоступно.");
      renderInGameMenu();
      return false;
    }

    if (current.id === "continue") {
      closeInGameMenu();
      return true;
    }

    state.inGameMenuView = current.id;
    state.inGameMenuSelection = 0;
    setInGameMenuStatus("");
    renderInGameMenu();
    return true;
  }

  return state.inGameMenuView === "save"
    ? persistInGameSave(current.slotId)
    : restoreInGameSave(current.slotId);
}

function handleInGameMenuInput({ mask, previousMask }) {
  if (!state.inGameMenuOpen) {
    return mask;
  }

  const pressed = (bit) => Boolean(mask & bit) && !(previousMask & bit);

  if (pressed(TOUCH_BITS.UP)) {
    moveInGameMenuSelection("up");
  } else if (pressed(TOUCH_BITS.DOWN)) {
    moveInGameMenuSelection("down");
  } else if (pressed(TOUCH_BITS.LEFT)) {
    moveInGameMenuSelection("left");
  } else if (pressed(TOUCH_BITS.RIGHT)) {
    moveInGameMenuSelection("right");
  }

  if (pressed(TOUCH_BITS.A) || pressed(TOUCH_BITS.START)) {
    activateInGameMenuSelection();
  }

  if (pressed(TOUCH_BITS.B) || pressed(TOUCH_BITS.SELECT)) {
    handleInGameMenuBack();
  }

  return 0;
}

function syncInGameMenuAvailability() {
  if (canOpenInGameMenu()) {
    renderInGameMenu();
    return;
  }

  if (state.inGameMenuOpen) {
    closeInGameMenu();
    return;
  }

  renderInGameMenu();
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

function getAvailableConsoles() {
  return CONSOLE_OPTIONS.filter((option) => option.available);
}

function getDefaultConsoleId() {
  const available = getAvailableConsoles();
  return available.length === 1 ? available[0].id : "";
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

function getGameTags(game) {
  const title = String(game?.title || "");
  const tags = new Set();
  let score = 0;

  for (const rule of GAME_TAG_PATTERNS) {
    if (rule.pattern.test(title)) {
      tags.add(rule.tag);
      score += rule.score;
    }
  }

  if (!tags.size) {
    tags.add("Classic");
    score += 1;
  }

  if (game?.prgKb <= 256) {
    tags.add("Quick");
    score += 1;
  }

  return {
    tags: [...tags].slice(0, 3),
    score,
  };
}

function getGamePitch(game) {
  const { tags } = getGameTags(game);

  if (tags.includes("2P") && tags.includes("Co-op")) {
    return "Great for fast couch-style co-op inside Telegram.";
  }

  if (tags.includes("2P")) {
    return "Easy to invite a friend and jump in right away.";
  }

  if (tags.includes("Fast")) {
    return "A quick session pick for short phone play.";
  }

  if (tags.includes("Hard")) {
    return "High-pressure runs that are fun to retry and rematch.";
  }

  return "A clean retro pick for a quick room launch.";
}

function truncateLabel(value, maxLength = 16) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function getRecentGames() {
  const recentGames = [];

  for (const gameId of state.recentGameIds) {
    const game = state.games.find((entry) => entry.id === gameId);
    if (game && !recentGames.some((entry) => entry.id === game.id)) {
      recentGames.push(game);
    }
  }

  return recentGames;
}

function getSpotlightGames() {
  const recentGames = getRecentGames();
  const scoredGames = state.games
    .map((game) => ({
      game,
      score: getGameTags(game).score + (recentGames.findIndex((entry) => entry.id === game.id) === 0 ? 4 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.game.title.localeCompare(right.game.title))
    .map((entry) => entry.game);

  const uniqueGames = [];
  for (const game of [...recentGames, ...scoredGames]) {
    if (!uniqueGames.some((entry) => entry.id === game.id)) {
      uniqueGames.push(game);
    }
  }

  return uniqueGames.slice(0, MAX_SPOTLIGHT_GAMES);
}

function getPrimaryLaunchGame(games = state.games) {
  if (!games.length) {
    return null;
  }

  const selectedGame = games.find((game) => game.id === state.selectedGameId);
  if (selectedGame) {
    return selectedGame;
  }

  const recentGame = getRecentGames().find((game) => games.some((entry) => entry.id === game.id));
  if (recentGame) {
    return recentGame;
  }

  const spotlightGame = getSpotlightGames().find((game) => games.some((entry) => entry.id === game.id));
  return spotlightGame || games[0];
}

function rememberRecentGame(gameId) {
  if (!gameId) {
    return;
  }

  state.recentGameIds = [gameId, ...state.recentGameIds.filter((entry) => entry !== gameId)].slice(0, MAX_RECENT_GAMES);
  writeJsonStorage(RECENT_GAMES_STORAGE_KEY, state.recentGameIds);
}

function rememberRecentRoom(room = state.currentRoom) {
  if (!room?.id) {
    return;
  }

  state.recentRoom = {
    roomId: room.id,
    sharePath: room.sharePath || `/room/${room.id}`,
    gameId: room.game?.id || "",
    gameTitle: room.game?.title || "",
    coverUrl: room.game?.coverUrl || "",
    mode: state.roomUiMode === "solo" ? "solo" : "party",
    updatedAt: new Date().toISOString(),
  };

  writeJsonStorage(RECENT_ROOM_STORAGE_KEY, state.recentRoom);
  if (room.game?.id) {
    rememberRecentGame(room.game.id);
  }
}

function clearRecentRoom(roomId = "") {
  if (roomId && state.recentRoom?.roomId !== roomId) {
    return;
  }

  state.recentRoom = null;
  writeJsonStorage(RECENT_ROOM_STORAGE_KEY, null);
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

function renderTagList(container, tags, className = "library-hub__tag") {
  if (!container) {
    return;
  }

  container.innerHTML = "";
  for (const tag of tags) {
    const item = document.createElement("span");
    item.className = className;
    item.textContent = tag;
    container.appendChild(item);
  }
}

function buildGameCard(game, { compact = false } = {}) {
  const card = document.createElement("article");
  const { tags } = getGameTags(game);
  const recent = state.recentGameIds.includes(game.id);
  card.className = `game-card${compact ? " game-card--compact" : ""}`;
  card.innerHTML = `
    <div class="game-card__cover">
      ${recent ? '<span class="game-card__badge">Recent</span>' : ""}
      <img src="${game.coverUrl}" alt="${escapeHtml(game.title)}" loading="lazy" />
    </div>
    <div class="game-card__meta">
      <h3 class="game-card__title">${escapeHtml(game.title)}</h3>
      <p class="game-card__summary">${escapeHtml(getGamePitch(game))}</p>
      <div class="game-card__tags">
        ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
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

  return card;
}

function resumeRecentRoom() {
  if (!state.recentRoom?.sharePath) {
    return;
  }

  navigate(state.recentRoom.sharePath);
}

async function launchPrimaryGame(mode) {
  const game = getPrimaryLaunchGame();
  if (!game) {
    showToast("Add a ROM to unlock quick launch.");
    return;
  }

  await createRoomForGame(game.id, mode);
}

function renderLibraryHub() {
  const featuredGame = getPrimaryLaunchGame();
  const spotlightGames = getSpotlightGames();
  const hasGames = state.games.length > 0;
  const recentRoom = state.recentRoom;
  const recentRoomGame = recentRoom?.gameId ? state.games.find((game) => game.id === recentRoom.gameId) : null;
  const recentRoomTitle = recentRoomGame?.title || recentRoom?.gameTitle || "";

  if (refs.libraryHubTitle) {
    refs.libraryHubTitle.textContent = hasGames
      ? "Play retro with a friend in 15 seconds"
      : "Drop ROMs in and build your retro party shelf";
  }

  if (refs.libraryHubCopy) {
    refs.libraryHubCopy.textContent = hasGames
      ? recentRoom
        ? `Resume room ${recentRoom.roomId} or launch a new quick session from the picks below.`
        : "Pick a featured game, open a room, and drop the invite straight into Telegram."
      : "Once the library is populated, the app will surface quick party picks and one-tap relaunches.";
  }

  if (featuredGame) {
    refs.hubFeaturedTitle.textContent = featuredGame.title;
    refs.hubFeaturedCopy.textContent = getGamePitch(featuredGame);
    renderTagList(refs.hubFeaturedTags, getGameTags(featuredGame).tags);
  } else {
    refs.hubFeaturedTitle.textContent = "No games yet";
    refs.hubFeaturedCopy.textContent = "Add ROMs to your library to unlock quick party launches.";
    renderTagList(refs.hubFeaturedTags, []);
  }

  refs.hubPlayButton.disabled = !featuredGame;
  refs.hubPartyButton.disabled = !featuredGame;
  refs.hubPlayButton.textContent = featuredGame ? `Quick Play ${truncateLabel(featuredGame.title, 12)}` : "Quick Play";
  refs.hubPartyButton.textContent = featuredGame ? `Party ${truncateLabel(featuredGame.title, 14)}` : "Quick Party";

  const showRecentRoom = Boolean(recentRoom?.sharePath);
  refs.hubRecentCard.classList.toggle("hidden", !showRecentRoom);
  if (showRecentRoom) {
    refs.hubRecentTitle.textContent = recentRoomTitle || `Room ${recentRoom.roomId}`;
    refs.hubRecentCopy.textContent = `Room ${recentRoom.roomId} is still one tap away. Use it for a fast rematch or to keep the invite thread alive.`;
  }

  const showSpotlight = spotlightGames.length > 0;
  refs.spotlightSection.classList.toggle("hidden", !showSpotlight);
  refs.spotlightGrid.innerHTML = "";
  for (const game of spotlightGames) {
    refs.spotlightGrid.appendChild(buildGameCard(game, { compact: true }));
  }
}

function renderMiniLibraryHero(currentGame) {
  const recentRoom = state.recentRoom;
  const recentRoomGame = recentRoom?.gameId ? state.games.find((game) => game.id === recentRoom.gameId) : null;
  const featuredGame = currentGame || getPrimaryLaunchGame(getVisibleLibraryGames()) || getPrimaryLaunchGame();

  if (!state.selectedConsoleId) {
    refs.miniLibraryHeroTitle.textContent = "Choose your console";
    refs.miniLibraryHeroSubtitle.textContent = "Start with NES now. SNES, Game Boy, and Sega are queued next.";
  } else {
    refs.miniLibraryHeroTitle.textContent = featuredGame
      ? `Start with ${featuredGame.title}`
      : "Pick a game and invite a friend";
    refs.miniLibraryHeroSubtitle.textContent = recentRoom
      ? `Room ${recentRoom.roomId} is saved here, so you can jump back in without hunting for the invite.`
      : "Pick a ROM, open a room, and keep the invite loop inside Telegram.";
  }

  const hasRecentRoom = Boolean(recentRoom?.sharePath);
  refs.miniResumeCard.classList.toggle("hidden", !hasRecentRoom);
  if (hasRecentRoom) {
    refs.miniResumeMeta.textContent = `${recentRoomGame?.title || recentRoom.gameTitle || "Last room"} · ${recentRoom.roomId}`;
  }
}

function renderConsoleSelection() {
  refs.miniConsoleGrid.innerHTML = "";

  for (const option of CONSOLE_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mini-library__console-card";
    button.dataset.console = option.id;
    button.dataset.available = String(option.available);
    button.innerHTML = `
      <span class="mini-library__console-art">
        <img src="${option.imageSrc}" alt="${escapeHtml(option.label)} console" loading="lazy" />
      </span>
      <span class="mini-library__console-copy">
        <strong>${option.label}</strong>
      </span>
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

function animateMiniRomCardState(gameId, previousRect, { centerInView = false } = {}) {
  if (!gameId || !previousRect) {
    return;
  }

  window.requestAnimationFrame(() => {
    const nextCard = refs.miniRomGrid.querySelector(
      `.mini-library__rom-card[data-game-id="${CSS.escape(gameId)}"]`,
    );
    if (!nextCard) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nextRect = nextCard.getBoundingClientRect();

    if (!reduceMotion) {
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      const scaleX = previousRect.width / Math.max(nextRect.width, 1);
      const scaleY = previousRect.height / Math.max(nextRect.height, 1);

      nextCard.animate(
        [
          {
            transformOrigin: "top center",
            transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
          },
          {
            transformOrigin: "top center",
            transform: "translate(0, 0) scale(1, 1)",
          },
        ],
        {
          duration: 260,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
    }

    if (centerInView) {
      nextCard.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }

    nextCard.querySelector(".mini-library__rom-hit")?.focus({ preventScroll: true });
  });
}

function renderRomSelection() {
  const visibleGames = getVisibleLibraryGames();
  const selectedGame = state.selectedGameId
    ? visibleGames.find((game) => game.id === state.selectedGameId) ?? null
    : null;
  if (state.selectedGameId && !selectedGame) {
    setSelectedGame("");
  }

  refs.miniRomGrid.innerHTML = "";
  for (const game of visibleGames) {
    const selected = game.id === selectedGame?.id;
    const card = document.createElement("article");
    card.className = "mini-library__rom-card";
    card.dataset.gameId = game.id;
    card.dataset.selected = String(selected);
    card.innerHTML = `
      <button class="mini-library__rom-hit" type="button" aria-pressed="${selected}">
        <span class="mini-library__rom-thumb">
          <img src="${game.coverUrl}" alt="${escapeHtml(game.title)}" loading="lazy" />
        </span>
        <span class="mini-library__rom-name">${escapeHtml(game.title)}</span>
      </button>
      <div class="mini-library__rom-actions${selected ? "" : " hidden"}" aria-hidden="${String(!selected)}">
        <button class="mini-library__rom-action mini-library__rom-action--play" data-launch-mode="solo" type="button">
          Играть
        </button>
        <button class="mini-library__rom-action mini-library__rom-action--party" data-launch-mode="party" type="button">
          Пати
        </button>
      </div>
    `;

    card.querySelector(".mini-library__rom-hit")?.addEventListener("click", () => {
      const nextSelectedGameId = selected ? "" : game.id;
      const previousRect = card.getBoundingClientRect();

      setSelectedGame(nextSelectedGameId);
      renderMiniLibrary();

      animateMiniRomCardState(game.id, previousRect, {
        centerInView: Boolean(nextSelectedGameId),
      });
    });

    for (const launchButton of card.querySelectorAll("[data-launch-mode]")) {
      launchButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (launchButton.disabled) {
          return;
        }

        const launchMode = launchButton.dataset.launchMode === "party" ? "party" : "solo";
        try {
          launchButton.disabled = true;
          await createRoomForGame(game.id, launchMode);
        } catch (error) {
          showToast(error.message);
          launchButton.disabled = false;
        }
      });
    }

    refs.miniRomGrid.appendChild(card);
  }

  if (!visibleGames.length) {
    const empty = document.createElement("div");
    empty.className = "mini-library__empty";
    empty.textContent = state.librarySearchQuery ? "Ничего не найдено" : "ROMы пока пусты";
    refs.miniRomGrid.appendChild(empty);
  }

  refs.miniLibraryActions.classList.add("hidden");
  refs.miniLibraryActions.setAttribute("aria-hidden", "true");
  renderMiniLibraryHero(selectedGame);
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
  const canGoBack = !showConsoleSelection && CONSOLE_OPTIONS.length > 1;

  refs.miniLibraryScreen.dataset.stage = showConsoleSelection ? "console" : "rom";
  refs.miniConsoleView.classList.toggle("hidden", !showConsoleSelection);
  refs.miniConsoleView.setAttribute("aria-hidden", String(!showConsoleSelection));
  refs.miniRomView.classList.toggle("hidden", showConsoleSelection);
  refs.miniRomView.setAttribute("aria-hidden", String(showConsoleSelection));
  refs.miniConsoleBack.classList.toggle("hidden", !canGoBack);
  refs.miniLibrarySearchWrap.classList.toggle("hidden", showConsoleSelection);

  if (showConsoleSelection) {
    refs.miniLibraryActions.classList.add("hidden");
    refs.miniLibraryActions.setAttribute("aria-hidden", "true");
    renderMiniLibraryHero(null);
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
  refs.partyScreen?.classList.toggle("hidden", kind !== "party");
  refs.partySaveScreen?.classList.toggle("hidden", kind !== "save");

  if (kind === "room" || kind === "party" || kind === "save") {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
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

  return parseRoute().kind === "party" && state.roomUiMode === "party" && (!room || room.status !== "running");
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
    ? `Join room ${room.id} and launch ${room.game.title} with me in NES Switch Online.`
    : `Join room ${room.id} in NES Switch Online.`;

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

  rememberRecentGame(gameId);
  setPendingRoomLaunch(payload.room.id, mode);
  navigate(mode === "party" ? `/party/${payload.room.id}` : payload.room.sharePath);
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

async function refreshLibraryCatalog() {
  const payload = await fetchJson("/api/games");
  state.games = payload.games;
  renderCatalog();
}

refs.refreshLibrary?.addEventListener("click", refreshLibraryCatalog);
refs.hubRefreshButton?.addEventListener("click", refreshLibraryCatalog);

refs.hubPartyButton?.addEventListener("click", async () => {
  try {
    refs.hubPartyButton.disabled = true;
    await launchPrimaryGame("party");
  } catch (error) {
    showToast(error.message);
  } finally {
    refs.hubPartyButton.disabled = false;
  }
});

refs.hubPlayButton?.addEventListener("click", async () => {
  try {
    refs.hubPlayButton.disabled = true;
    await launchPrimaryGame("solo");
  } catch (error) {
    showToast(error.message);
  } finally {
    refs.hubPlayButton.disabled = false;
  }
});

refs.hubResumeButton?.addEventListener("click", () => {
  resumeRecentRoom();
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

refs.miniResumeButton?.addEventListener("click", () => {
  resumeRecentRoom();
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
  if (state.inGameMenuOpen) {
    closeInGameMenu();
    return;
  }
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
  if (canOpenInGameMenu()) {
    if (state.inGameMenuOpen) {
      closeInGameMenu();
    } else {
      openInGameMenu();
    }
    return;
  }

  await shareCurrentRoomLink(state.currentRoom);
});

refs.gbaSpPowerButton?.addEventListener("click", (event) => {
  event.preventDefault();
  vibrateTap(18);
  if (!canOpenInGameMenu()) {
    return;
  }

  if (state.inGameMenuOpen) {
    closeInGameMenu();
  } else {
    openInGameMenu();
  }
});

refs.gbaSpPowerButton?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  vibrateTap(18);
  if (!canOpenInGameMenu()) {
    return;
  }

  if (state.inGameMenuOpen) {
    closeInGameMenu();
  } else {
    openInGameMenu();
  }
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
  navigate("/");
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

refs.partySaveButton?.addEventListener("click", () => {
  vibrateTap(18);
  showToast("Сейвы скоро появятся");
});

refs.partySaveButton?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  vibrateTap(18);
  if (!state.currentRoomId) {
    return;
  }

  navigate(`/party/${state.currentRoomId}/saves`);
}, { capture: true });

refs.partySaveBackButton?.addEventListener("click", () => {
  if (!state.currentRoomId) {
    navigate("/");
    return;
  }

  navigate(`/party/${state.currentRoomId}`);
});

refs.partySaveCloseButton?.addEventListener("click", () => {
  if (!state.currentRoomId) {
    navigate("/");
    return;
  }

  navigate(`/party/${state.currentRoomId}`);
});

refs.partySaveCancelButton?.addEventListener("click", () => {
  if (!state.currentRoomId) {
    navigate("/");
    return;
  }

  navigate(`/party/${state.currentRoomId}`);
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
  if (route.kind !== "library") {
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
  if (state.currentRoom) {
    rememberRecentRoom(state.currentRoom);
  }
  renderCatalog();
  renderActiveView();
});

socket.on("room:joined", ({ room, participant }) => {
  state.currentRoom = room;
  state.participant = participant;
  renderActiveView();
});

socket.on("room:state", (room) => {
  if (room.id !== state.currentRoomId) {
    return;
  }
  state.currentRoom = room;
  renderActiveView();
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
  closeInGameMenu();
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
  refs.nesRoom.classList.toggle("hidden", partyLobbyActive || soloUiActive);
  refs.mobileHandheld.classList.toggle("hidden", !mobileControlsActive);
  refs.mobileHandheld.setAttribute("aria-hidden", String(!mobileControlsActive));
  refs.exitMobileFullscreen.classList.toggle("hidden", !mobileOverlayActive);
  refs.mobileBackButton.classList.toggle("hidden", !mobileOverlayActive);
  refs.mobileMenuButton.classList.toggle("hidden", !mobileOverlayActive);
  refs.mobileMenuButton.setAttribute("aria-label", canOpenInGameMenu() ? "Открыть меню" : "Поделиться");
  refs.partyLobby.classList.add("hidden");
  refs.partyLobby.setAttribute("aria-hidden", "true");
  refs.partyScreen?.setAttribute("aria-hidden", String(!partyLobbyActive));
  refs.partySaveScreen?.setAttribute("aria-hidden", String(parseRoute().kind !== "party-saves"));

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
  syncInGameMenuAvailability();
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

function getPartyMenuGame(room = state.currentRoom) {
  return (
    room?.game ||
    (state.selectedGameId ? state.games.find((game) => game.id === state.selectedGameId) ?? null : null) ||
    getPrimaryLaunchGame(getVisibleLibraryGames()) ||
    getPrimaryLaunchGame()
  );
}

function formatSaveClock(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function getPartySaveSlots(game = getPartyMenuGame()) {
  const seed = hashString(game?.id || game?.title || "party-save");
  const totalMinutes = 8 * 60 + 12 + (seed % 165);
  const hoursAgo = 2 + (seed % 18);

  return [
    {
      id: "slot-1",
      filled: true,
      title: game?.title || "Текущий сейв",
      coverUrl: game?.coverUrl || "",
      duration: formatSaveClock(totalMinutes),
      ageLabel: `${hoursAgo} ${pluralizeRu(hoursAgo, "час", "часа", "часов")} назад`,
    },
    {
      id: "slot-2",
      filled: false,
      title: "Пусто",
      subtitle: "Свободный слот для сохранения",
    },
    {
      id: "slot-3",
      filled: false,
      title: "Пусто",
      subtitle: "Свободный слот для сохранения",
    },
    {
      id: "slot-4",
      filled: false,
      title: "Пусто",
      subtitle: "Свободный слот для сохранения",
    },
    {
      id: "slot-5",
      filled: false,
      title: "Пусто",
      subtitle: "Свободный слот для сохранения",
    },
  ];
}

function renderPartySaveSlots(slots) {
  if (!refs.partySaveSlots) {
    return;
  }

  refs.partySaveSlots.innerHTML = "";

  for (const slot of slots) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `save-room-menu__slot${slot.filled ? " save-room-menu__slot--filled" : ""}`;
    item.dataset.slotId = slot.id;

    if (slot.filled) {
      item.innerHTML = `
        <span class="save-room-menu__slot-cover">
          <img src="${escapeHtml(slot.coverUrl)}" alt="" />
        </span>
        <span class="save-room-menu__slot-copy">
          <strong>${escapeHtml(slot.title)}</strong>
          <span>Прохождение: ${escapeHtml(slot.progress)}</span>
          <span>${escapeHtml(slot.duration)}</span>
        </span>
        <span class="save-room-menu__slot-meta">
          <b>SAVE</b>
          <span>${escapeHtml(slot.ageLabel)}</span>
        </span>
      `;
      item.querySelector(".save-room-menu__slot-copy span")?.remove();
    } else {
      item.innerHTML = `
        <span class="save-room-menu__slot-empty">
          <strong>${escapeHtml(slot.title)}</strong>
          <span>${escapeHtml(slot.subtitle)}</span>
        </span>
      `;
    }

    item.addEventListener("click", () => {
      vibrateTap(12);
      showToast(slot.filled ? "Загрузка сейвов пока заглушка" : "Свободные слоты скоро заработают");
    });

    refs.partySaveSlots.appendChild(item);
  }
}

function legacyRenderPartyMenu(room, me) {
  const lobbyActive = shouldShowPartyLobby();

  refs.partyMenuScreen?.classList.toggle("hidden", !lobbyActive);
  if (!lobbyActive) {
    return;
  }

  const partyMenuGame =
    room?.game ||
    (state.selectedGameId ? state.games.find((game) => game.id === state.selectedGameId) ?? null : null) ||
    getPrimaryLaunchGame(getVisibleLibraryGames()) ||
    getPrimaryLaunchGame();

  refs.partyMenuScreen?.classList.remove("hidden");
  if (refs.partyMenuCoverImage) {
    refs.partyMenuCoverImage.src = partyMenuGame?.coverUrl || "";
    refs.partyMenuCoverImage.alt = partyMenuGame?.title || "";
  }
  if (refs.partyMenuTitle) {
    refs.partyMenuTitle.textContent = partyMenuGame?.title || "Выбранная игра";
  }
  refs.partyReadyButton.dataset.ready = "false";
  refs.partyInviteButton.textContent = "Пригласить";
  refs.partyReadyButton.textContent = "Готов";
  refs.partyPlayButton.textContent = "Играть";
  refs.partySaveButton.textContent = "Запустить сейв";

  if (!room) {
    refs.partyInviteButton.disabled = true;
    refs.partyReadyButton.disabled = true;
    refs.partyPlayButton.disabled = true;
    refs.partySaveButton.disabled = true;
    return;
  }

  const players = room.players.filter((player) => !player.spectator);
  const isHost = Boolean(me?.isHost);
  const canPartyStart = Boolean(isHost && room.canStart && room.status === "lobby" && players.length > 1);

  refs.partyInviteButton.disabled = false;
  refs.partyReadyButton.disabled = room.status !== "lobby" || Boolean(me?.spectator);
  refs.partyReadyButton.dataset.ready = String(Boolean(me?.ready));
  refs.partyPlayButton.disabled = !canPartyStart;
  refs.partySaveButton.disabled = false;
}

function renderPartyMenuPlayers(players, me) {
  if (!refs.partyMenuPlayers) {
    return;
  }

  refs.partyMenuPlayers.innerHTML = "";
  const visiblePlayers = players.filter((player) => !player.spectator).slice(0, 4);

  for (let index = 0; index < 4; index += 1) {
    const player = visiblePlayers[index];
    const item = document.createElement("div");
    item.className = `party-room-menu__player${player ? "" : " party-room-menu__player--empty"}`;

    if (player) {
      const isSelf = Boolean(me && player.socketId === me.socketId);
      const playerLabel = isSelf ? "Ты" : player.name;
      const playerMeta = player.isHost ? "Хост" : `Игрок ${player.slot || index + 1}`;
      const playerState = player.isHost ? "Хост" : player.ready ? "Готов" : "Ждёт";
      const playerStateClass = player.ready || player.isHost
        ? "party-room-menu__player-pill party-room-menu__player-pill--active"
        : "party-room-menu__player-pill";

      item.innerHTML = `
        <div class="party-room-menu__player-avatar">
          <img src="${escapeHtml(getPlayerAvatarSrc(player, index))}" alt="" />
        </div>
        <div class="party-room-menu__player-copy">
          <strong>${escapeHtml(playerLabel)}</strong>
          <span>${escapeHtml(playerMeta)}</span>
        </div>
        <b class="${playerStateClass}">${escapeHtml(playerState)}</b>
      `;
    } else {
      item.innerHTML = `
        <div class="party-room-menu__player-avatar party-room-menu__player-avatar--empty">+</div>
        <div class="party-room-menu__player-copy">
          <strong>Пригласите друга</strong>
          <span>Свободный слот</span>
        </div>
        <b class="party-room-menu__player-pill party-room-menu__player-pill--empty">+</b>
      `;
    }

    refs.partyMenuPlayers.appendChild(item);
  }
}

function renderPartyLobby(room, me) {
  const lobbyActive = shouldShowPartyLobby();

  refs.partyMenuScreen?.classList.toggle("hidden", !lobbyActive);
  if (!lobbyActive) {
    return;
  }

  const partyMenuGame =
    room?.game ||
    (state.selectedGameId ? state.games.find((game) => game.id === state.selectedGameId) ?? null : null) ||
    getPrimaryLaunchGame(getVisibleLibraryGames()) ||
    getPrimaryLaunchGame();

  const title = partyMenuGame?.title || "Новая комната";

  refs.partyMenuScreen?.classList.remove("hidden");
  if (refs.partyMenuBarTitle) {
    refs.partyMenuBarTitle.textContent = title;
  }
  if (refs.partyMenuCoverImage) {
    refs.partyMenuCoverImage.src = partyMenuGame?.coverUrl || "";
    refs.partyMenuCoverImage.alt = title;
  }
  if (refs.partyMenuTitle) {
    refs.partyMenuTitle.textContent = title;
  }
  if (refs.partyMenuCode) {
    refs.partyMenuCode.textContent = room?.id || "------";
  }

  refs.partyCopyIconButton.disabled = !room;
  refs.partyMenuButton.disabled = false;
  refs.partyReadyButton.dataset.ready = "false";
  refs.partyInviteButton.textContent = "Пригласить";
  refs.partyReadyButton.textContent = "Готов";
  refs.partyPlayButton.textContent = "Начать";
  refs.partySaveButton.textContent = "Загрузить сейв";

  if (!room) {
    if (refs.partyMenuPlayersMeta) {
      refs.partyMenuPlayersMeta.textContent = "0 игроков";
    }
    if (refs.partyMenuInviteMeta) {
      refs.partyMenuInviteMeta.textContent = state.roomLoadError || "Готовлю комнату и ссылку.";
    }
    if (refs.partyMenuStatus) {
      refs.partyMenuStatus.textContent = state.roomLoadError || "Слоты игроков скоро появятся.";
    }
    renderPartyMenuPlayers([], null);
    refs.partyInviteButton.disabled = true;
    refs.partyReadyButton.disabled = true;
    refs.partyPlayButton.disabled = true;
    refs.partySaveButton.disabled = true;
    return;
  }

  const players = room.players.filter((player) => !player.spectator);
  const readyPlayers = players.filter((player) => player.ready).length;
  const isHost = Boolean(me?.isHost);
  const canPartyStart = Boolean(isHost && room.canStart && room.status === "lobby" && players.length > 1);

  if (refs.partyMenuPlayersMeta) {
    refs.partyMenuPlayersMeta.textContent = `${players.length} ${pluralizeRu(players.length, "игрок", "игрока", "игроков")}`;
  }
  if (refs.partyMenuInviteMeta) {
    refs.partyMenuInviteMeta.textContent = players.length < 2
      ? "Скопируй ссылку и позови друга в Telegram."
      : isHost
        ? `Готовы ${readyPlayers} из ${players.length}.`
        : me?.ready
          ? "Ты готов. Ждём сигнал от хоста."
          : "Нажми «Готов», чтобы хост увидел тебя.";
  }
  if (refs.partyMenuStatus) {
    refs.partyMenuStatus.textContent = canPartyStart
      ? "Комната собрана. Можно начинать бой."
      : players.length < 2
        ? "Подожди друзей или отправь приглашение ещё раз."
        : !isHost
          ? me?.ready
            ? "Ждём старт от хоста."
            : "Отметься как готовый, и старт станет доступен."
          : "Когда все отметятся как готовые, кнопка старта откроется.";
  }

  renderPartyMenuPlayers(players, me);
  refs.partyInviteButton.disabled = false;
  refs.partyReadyButton.disabled = room.status !== "lobby" || Boolean(me?.spectator);
  refs.partyReadyButton.dataset.ready = String(Boolean(me?.ready));
  refs.partyReadyButton.textContent = me?.ready ? "Готово" : "Готов";
  refs.partyPlayButton.textContent = isHost ? "Начать" : "Ждём хоста";
  refs.partyPlayButton.disabled = !canPartyStart;
  refs.partySaveButton.disabled = false;
}

function renderPartySaveScreen() {
  const room = state.currentRoom;

  if (room?.status === "running") {
    navigate(`/room/${room.id}`, { replace: true });
    return;
  }

  setView("save");
  if (refs.partySaveBarTitle) {
    refs.partySaveBarTitle.textContent = "Выберите сейв";
  }
  renderPartySaveSlots(getPartySaveSlots(getPartyMenuGame(room)));
  updateFullscreenUi();
}

function renderPartyScreen() {
  const room = state.currentRoom;

  if (room?.status === "running") {
    navigate(`/room/${room.id}`, { replace: true });
    return;
  }

  setView("party");
  renderPartyLobby(room, getCurrentPlayer(room));
  updateFullscreenUi();
}

function renderActiveView() {
  if (parseRoute().kind === "party-saves") {
    renderPartySaveScreen();
    return;
  }

  if (parseRoute().kind === "party") {
    renderPartyScreen();
    return;
  }

  renderRoom();
}

function renderCatalog() {
  const catalogCountText = `${state.games.length} games`;
  const catalogStatusText = state.recentRoom?.roomId
    ? `Room ${state.recentRoom.roomId} ready to resume`
    : state.games.length
      ? "Ready to launch"
      : "Library is empty";

  if (refs.catalogCount) {
    refs.catalogCount.textContent = catalogCountText;
  }
  if (refs.catalogStatus) {
    refs.catalogStatus.textContent = catalogStatusText;
  }
  if (refs.hubCatalogCount) {
    refs.hubCatalogCount.textContent = catalogCountText;
  }
  if (refs.hubCatalogStatus) {
    refs.hubCatalogStatus.textContent = catalogStatusText;
  }
  if (refs.emptyLibrary) {
    refs.emptyLibrary.classList.add("hidden");
    refs.emptyLibrary.setAttribute("aria-hidden", "true");
  }
  refs.gameGrid.innerHTML = "";
  renderLibraryHub();

  for (const game of state.games) {
    refs.gameGrid.appendChild(buildGameCard(game));
  }

  renderMiniLibrary();
}

function renderRoom() {
  const room = state.currentRoom;
  const soloLaunchActive = shouldShowSoloLaunch(room);
  const partyLobbyActive = shouldShowPartyLobby(room);
  const partyUiActive = shouldUsePartyUi();
  refs.copyLink.textContent = state.telegram?.isMiniApp ? "Позвать друга" : "Копировать ссылку";

  if (partyLobbyActive) {
    return;
  }

  setView("room");

  if (!room) {
    if (soloLaunchActive) {
      refs.roomTitle.textContent = "Запускаю игру";
      refs.roomSubtitle.textContent = "Готовлю экран и подключаю сессию.";
      refs.screenOverlay.textContent = state.roomLoadError || "Запускаю игру...";
      refs.screenOverlay.classList.remove("hidden");
    } else {
      refs.roomTitle.textContent = "Комната не найдена";
      refs.roomSubtitle.textContent = "Создай новую комнату из библиотеки.";
      refs.screenOverlay.textContent = "Жду запуск сессии";
      refs.screenOverlay.classList.remove("hidden");
    }
    refs.playersList.innerHTML = "";
    refs.mobileRoomBadge.textContent = soloLaunchActive ? "СТАРТ" : "КОМНАТА";
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
  updateFullscreenUi();
}

async function syncRoute() {
  const route = parseRoute();

  if (route.kind === "library") {
    closeInGameMenu();
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

  state.currentRoomId = route.roomId;
  state.roomLoadError = "";
  if (route.kind === "party" || route.kind === "party-saves") {
    state.roomUiMode = "party";
  } else if (state.pendingRoomLaunch?.roomId === route.roomId) {
    state.roomUiMode = state.pendingRoomLaunch.mode === "solo" ? "solo" : "party";
  } else if (state.telegram?.isMiniApp && state.isMobileDevice) {
    state.roomUiMode = "party";
  } else {
    state.roomUiMode = null;
  }

  setView(route.kind === "party" ? "party" : route.kind === "party-saves" ? "save" : "room");

  if (shouldShowSoloLaunch(null) || shouldShowPartyLobby(null) || route.kind === "party-saves") {
    state.currentRoom = null;
    state.participant = null;
    renderActiveView();
  }

  try {
    const payload = await fetchJson(`/api/rooms/${route.roomId}`);
    state.currentRoom = payload.room;
    state.participant = null;
    state.roomLoadError = "";
    rememberRecentRoom(payload.room);
    renderActiveView();
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
    if (error.message === "Room not found.") {
      clearRecentRoom(route.roomId);
    }
    renderActiveView();
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
  rememberRecentRoom(room);
  renderActiveView();
  void maybeHandlePendingRoomLaunch();
});

socket.off("room:state");
socket.on("room:state", (room) => {
  if (room.id !== state.currentRoomId) {
    return;
  }

  state.currentRoom = room;
  state.roomLoadError = "";
  rememberRecentRoom(room);
  renderActiveView();
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
    closeInGameMenu();
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
  if (state.inGameMenuOpen) {
    closeInGameMenu();
    return;
  }

  if (state.currentRoomId && state.fullscreenActive) {
    void exitFullscreenMode();
    return;
  }

  if (state.currentRoomId && parseRoute().kind === "party-saves") {
    navigate(`/party/${state.currentRoomId}`);
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

emulator.setInputInterceptor(handleInGameMenuInput);
bindTouchControls();
refreshDeviceMode();
await ensureMiniAppFullscreen();

const initialCatalog = await fetchJson("/api/games");
state.games = initialCatalog.games;
renderCatalog();
await syncRoute();
