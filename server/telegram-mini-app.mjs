import crypto from "node:crypto";

const ROOM_ID_RE = /^(?:room[-_:])?([A-Z0-9]{6})$/i;

function safeTrim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonField(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseInitData(initDataRaw) {
  const initData = safeTrim(initDataRaw);
  if (!initData) {
    return null;
  }

  const params = new URLSearchParams(initData);
  const entries = [...params.entries()];
  const data = {};

  for (const [key, value] of entries) {
    if (key === "user" || key === "receiver" || key === "chat") {
      data[key] = parseJsonField(value);
      continue;
    }

    data[key] = value;
  }

  return {
    entries,
    data,
    hash: safeTrim(params.get("hash")),
    authDate: Number(params.get("auth_date") || 0),
    startParam: safeTrim(params.get("start_param")),
  };
}

function extractRoomId(startParam) {
  const match = safeTrim(startParam).match(ROOM_ID_RE);
  return match ? match[1].toUpperCase() : null;
}

export function getTelegramPublicConfig() {
  const botUsername = safeTrim(process.env.TELEGRAM_BOT_USERNAME);
  const miniAppUrl = safeTrim(process.env.TELEGRAM_MINI_APP_URL);

  return {
    enabled: Boolean(botUsername || miniAppUrl),
    botUsername: botUsername || null,
    miniAppUrl: miniAppUrl || null,
  };
}

export function validateTelegramInitData(initDataRaw) {
  const botToken = safeTrim(process.env.TELEGRAM_BOT_TOKEN);
  const parsed = parseInitData(initDataRaw);

  if (!botToken || !parsed) {
    return {
      isValid: false,
      user: null,
      startParam: parsed?.startParam || "",
      roomId: extractRoomId(parsed?.startParam || ""),
      reason: botToken ? "missing-init-data" : "missing-bot-token",
    };
  }

  const dataCheckString = parsed.entries
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const receivedHash = parsed.hash;

  const expectedHashBuffer = Buffer.from(expectedHash, "hex");
  const receivedHashBuffer = /^[a-f0-9]+$/i.test(receivedHash) ? Buffer.from(receivedHash, "hex") : Buffer.alloc(0);
  const isHashValid =
    receivedHashBuffer.length === expectedHashBuffer.length &&
    crypto.timingSafeEqual(receivedHashBuffer, expectedHashBuffer);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ageSeconds = parsed.authDate > 0 ? Math.max(0, nowSeconds - parsed.authDate) : Number.POSITIVE_INFINITY;
  const maxAgeSeconds = Number(process.env.TELEGRAM_INIT_MAX_AGE_SECONDS || 86400);
  const isFresh = Number.isFinite(maxAgeSeconds) ? ageSeconds <= maxAgeSeconds : true;

  return {
    isValid: isHashValid && isFresh,
    user: parsed.data.user || null,
    startParam: parsed.startParam,
    roomId: extractRoomId(parsed.startParam),
    authDate: parsed.authDate || null,
    reason: isHashValid ? (isFresh ? null : "expired") : "invalid-hash",
  };
}
