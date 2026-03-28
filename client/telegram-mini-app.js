const ROOM_ID_RE = /^(?:room[-_:])?([A-Z0-9]{6})$/i;

function safeTrim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUser(user) {
  if (!user || typeof user !== "object") {
    return null;
  }

  const firstName = safeTrim(user.first_name || user.firstName);
  const lastName = safeTrim(user.last_name || user.lastName);
  const username = safeTrim(user.username);
  const languageCode = safeTrim(user.language_code || user.languageCode);
  const photoUrl = safeTrim(user.photo_url || user.photoUrl);

  return {
    id: Number.isFinite(Number(user.id)) ? Number(user.id) : null,
    firstName,
    lastName,
    username,
    languageCode,
    photoUrl,
  };
}

function extractRoomIdFromStartParam(startParam) {
  const match = safeTrim(startParam).match(ROOM_ID_RE);
  return match ? match[1].toUpperCase() : null;
}

function getLocationStartParam() {
  const params = new URLSearchParams(window.location.search);
  return safeTrim(params.get("tgWebAppStartParam"));
}

async function fetchTelegramConfig() {
  try {
    const response = await fetch("/api/telegram/config");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return null;
    }
    return payload.telegram || null;
  } catch {
    return null;
  }
}

async function fetchTelegramSession(initData) {
  try {
    const response = await fetch("/api/telegram/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ initData }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function safeCall(method, ...args) {
  if (typeof method !== "function") {
    return undefined;
  }

  try {
    return method(...args);
  } catch {
    return undefined;
  }
}

export async function initializeTelegramMiniApp() {
  const webApp = window.Telegram?.WebApp ?? null;
  const config = await fetchTelegramConfig();

  const bridge = {
    isMiniApp: Boolean(webApp),
    webApp,
    botUsername: config?.botUsername || null,
    miniAppUrl: config?.miniAppUrl || null,
    initData: "",
    user: null,
    startParam: "",
    startRoomId: null,
    isFullscreenActive() {
      return Boolean(webApp?.isFullscreen);
    },
    async requestFullscreen() {
      if (!webApp?.requestFullscreen) {
        return false;
      }

      try {
        await webApp.requestFullscreen();
        return true;
      } catch {
        return false;
      }
    },
    async exitFullscreen() {
      if (!webApp?.exitFullscreen) {
        return false;
      }

      try {
        await webApp.exitFullscreen();
        return true;
      } catch {
        return false;
      }
    },
    async lockOrientation() {
      if (!webApp?.lockOrientation) {
        return false;
      }

      try {
        await webApp.lockOrientation();
        return true;
      } catch {
        return false;
      }
    },
    async unlockOrientation() {
      if (!webApp?.unlockOrientation) {
        return false;
      }

      try {
        await webApp.unlockOrientation();
        return true;
      } catch {
        return false;
      }
    },
    syncUi({ inRoom = false, fullscreenActive = false, running = false } = {}) {
      if (!webApp) {
        return;
      }

      const showBack = inRoom || fullscreenActive;
      if (showBack) {
        safeCall(webApp.BackButton?.show?.bind(webApp.BackButton));
      } else {
        safeCall(webApp.BackButton?.hide?.bind(webApp.BackButton));
      }

      if (running) {
        safeCall(webApp.enableClosingConfirmation?.bind(webApp));
      } else {
        safeCall(webApp.disableClosingConfirmation?.bind(webApp));
      }

      if (fullscreenActive || running) {
        safeCall(webApp.disableVerticalSwipes?.bind(webApp));
      } else {
        safeCall(webApp.enableVerticalSwipes?.bind(webApp));
      }

      safeCall(webApp.setHeaderColor?.bind(webApp), fullscreenActive ? "#101920" : "#202735");
      safeCall(webApp.setBackgroundColor?.bind(webApp), fullscreenActive ? "#0a0c10" : "#10141c");
      safeCall(webApp.setBottomBarColor?.bind(webApp), fullscreenActive ? "#0a0c10" : "#10141c");
    },
    buildShareUrl(roomId, fallbackUrl) {
      if (!this.botUsername || !roomId) {
        return fallbackUrl;
      }

      return `https://t.me/${this.botUsername}?startapp=${encodeURIComponent(`room-${roomId}`)}`;
    },
    setBackHandler(handler) {
      if (!webApp?.BackButton) {
        return;
      }

      if (this._backHandler) {
        safeCall(webApp.BackButton.offClick?.bind(webApp.BackButton), this._backHandler);
      }

      this._backHandler = typeof handler === "function" ? handler : null;
      if (this._backHandler) {
        safeCall(webApp.BackButton.onClick?.bind(webApp.BackButton), this._backHandler);
      }
    },
    setFullscreenChangedHandler(handler) {
      if (!webApp?.onEvent || !webApp?.offEvent) {
        return;
      }

      if (this._fullscreenHandler) {
        safeCall(webApp.offEvent.bind(webApp), "fullscreenChanged", this._fullscreenHandler);
      }

      this._fullscreenHandler = typeof handler === "function" ? handler : null;
      if (this._fullscreenHandler) {
        safeCall(webApp.onEvent.bind(webApp), "fullscreenChanged", this._fullscreenHandler);
      }
    },
  };

  if (!webApp) {
    return bridge;
  }

  document.body.classList.add("is-telegram-mini-app");
  bridge.initData = typeof webApp.initData === "string" ? webApp.initData : "";
  bridge.user = normalizeUser(webApp.initDataUnsafe?.user);
  bridge.startParam = safeTrim(webApp.initDataUnsafe?.start_param) || getLocationStartParam();
  bridge.startRoomId = extractRoomIdFromStartParam(bridge.startParam);

  safeCall(webApp.ready?.bind(webApp));
  safeCall(webApp.expand?.bind(webApp));
  safeCall(webApp.setHeaderColor?.bind(webApp), "#202735");
  safeCall(webApp.setBackgroundColor?.bind(webApp), "#10141c");
  safeCall(webApp.setBottomBarColor?.bind(webApp), "#10141c");

  const session = await fetchTelegramSession(bridge.initData);
  if (session?.telegram?.botUsername) {
    bridge.botUsername = session.telegram.botUsername;
  }
  if (session?.telegram?.miniAppUrl) {
    bridge.miniAppUrl = session.telegram.miniAppUrl;
  }
  if (session?.auth?.isValid) {
    bridge.user = normalizeUser(session.auth.user) || bridge.user;
    bridge.startParam = safeTrim(session.auth.startParam) || bridge.startParam;
    bridge.startRoomId = session.auth.roomId || bridge.startRoomId;
  }

  return bridge;
}
