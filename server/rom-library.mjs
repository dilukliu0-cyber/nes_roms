import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import chokidar from "chokidar";

const COVER_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif"];
const NES_EXTENSIONS = new Set([".nes"]);
const LIBRETRO_BOXART_BASE =
  "https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System/master/Named_Boxarts";

function ensureArrayUnique(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeTitle(title) {
  return title
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(title) {
  return normalizeTitle(title)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(USA|Europe|Japan|World|Rev\s*[A-Z0-9]+|Proto|Beta)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createTitleVariants(fileName) {
  const normalized = normalizeTitle(fileName);
  const cleaned = cleanTitle(fileName);
  const withoutArticle = cleaned.replace(/^The\s+/i, "");
  const withColon = cleaned.replace(/\s+-\s+/g, ": ");

  return ensureArrayUnique([
    normalized,
    cleaned,
    withoutArticle,
    withColon,
    cleaned.replace(/:\s+/g, " - "),
    cleaned.replace(/\bII\b/g, "2").replace(/\bIII\b/g, "3"),
  ]);
}

function wrapTitle(title, limit = 16) {
  const words = title.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= limit) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, 3);
}

function createGradientFromHash(hash) {
  const hueA = parseInt(hash.slice(0, 2), 16) % 360;
  const hueB = (parseInt(hash.slice(2, 4), 16) + 75) % 360;
  return {
    top: `hsl(${hueA} 78% 56%)`,
    bottom: `hsl(${hueB} 74% 42%)`,
    accent: `hsl(${(hueA + hueB) / 2} 92% 70%)`,
  };
}

function parseInesMetadata(buffer) {
  if (buffer.length < 16) {
    return null;
  }

  if (
    buffer[0] !== 0x4e ||
    buffer[1] !== 0x45 ||
    buffer[2] !== 0x53 ||
    buffer[3] !== 0x1a
  ) {
    return null;
  }

  const prgBanks = buffer[4];
  const chrBanks = buffer[5];
  const flags6 = buffer[6];
  const flags7 = buffer[7];
  const mapper = (flags6 >> 4) | (flags7 & 0xf0);
  const mirroring = flags6 & 0x08 ? "four-screen" : flags6 & 0x01 ? "vertical" : "horizontal";

  return {
    mapper,
    mirroring,
    hasBattery: Boolean(flags6 & 0x02),
    hasTrainer: Boolean(flags6 & 0x04),
    prgKb: prgBanks * 16,
    chrKb: chrBanks * 8,
  };
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dirPath, matcher, baseDir = dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(absolutePath, matcher, baseDir)));
      continue;
    }
    if (matcher(entry.name, absolutePath)) {
      results.push({
        absolutePath,
        relativePath: path.relative(baseDir, absolutePath),
      });
    }
  }

  return results;
}

export class RomLibrary {
  constructor({ romsDir, coverCacheDir, onUpdate }) {
    this.romsDir = romsDir;
    this.coverCacheDir = coverCacheDir;
    this.onUpdate = onUpdate;
    this.games = new Map();
    this.coverFetches = new Set();
    this.watchers = [];
    this.scanTimer = null;
  }

  async init() {
    await fs.mkdir(this.romsDir, { recursive: true });
    await fs.mkdir(this.coverCacheDir, { recursive: true });
    await this.scan();
    this.watch();
  }

  getGames() {
    return [...this.games.values()].sort((left, right) =>
      left.title.localeCompare(right.title, "ru", { sensitivity: "base" }),
    );
  }

  getPublicGames() {
    return this.getGames().map((game) => this.toPublicGame(game));
  }

  toPublicGame(game) {
    return {
      id: game.id,
      hash: game.hash,
      title: game.title,
      fileName: game.fileName,
      relativePath: game.relativePath,
      sizeBytes: game.sizeBytes,
      mapper: game.mapper,
      mirroring: game.mirroring,
      prgKb: game.prgKb,
      chrKb: game.chrKb,
      hasBattery: game.hasBattery,
      hasTrainer: game.hasTrainer,
      coverUrl: `/api/games/${game.id}/cover?v=${game.coverVersion}`,
      coverMode: game.coverMode,
      addedAt: game.addedAt,
    };
  }

  getGame(gameId) {
    return this.games.get(gameId) ?? null;
  }

  async scan() {
    const romFiles = await collectFiles(
      this.romsDir,
      (fileName) => NES_EXTENSIONS.has(path.extname(fileName).toLowerCase()),
    );

    const nextGames = new Map();

    for (const romFile of romFiles) {
      const game = await this.buildGame(romFile);
      if (game) {
        nextGames.set(game.id, game);
      }
    }

    this.games = nextGames;
    this.emitUpdate();

    for (const game of this.games.values()) {
      if (game.coverMode === "generated") {
        void this.fetchRemoteCover(game.id);
      }
    }
  }

  emitUpdate() {
    if (typeof this.onUpdate === "function") {
      this.onUpdate(this.getPublicGames());
    }
  }

  watch() {
    const watcher = chokidar.watch([this.romsDir, this.coverCacheDir], {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    const scheduleScan = () => {
      clearTimeout(this.scanTimer);
      this.scanTimer = setTimeout(() => {
        void this.scan();
      }, 250);
    };

    watcher.on("add", scheduleScan);
    watcher.on("change", scheduleScan);
    watcher.on("unlink", scheduleScan);
    watcher.on("addDir", scheduleScan);
    watcher.on("unlinkDir", scheduleScan);

    this.watchers.push(watcher);
  }

  async buildGame({ absolutePath, relativePath }) {
    const fileBuffer = await fs.readFile(absolutePath);
    const metadata = parseInesMetadata(fileBuffer);

    if (!metadata) {
      return null;
    }

    const stat = await fs.stat(absolutePath);
    const hash = crypto.createHash("sha1").update(fileBuffer).digest("hex");
    const id = hash.slice(0, 16);
    const fileName = path.basename(absolutePath);
    const title = cleanTitle(fileName) || normalizeTitle(fileName) || fileName;
    const localCoverPath = await this.findExistingCover(absolutePath, hash);

    return {
      id,
      hash,
      title,
      fileName,
      absolutePath,
      relativePath: relativePath.replace(/\\/g, "/"),
      sizeBytes: stat.size,
      addedAt: stat.mtime.toISOString(),
      coverPath: localCoverPath,
      coverMode: localCoverPath ? "image" : "generated",
      coverVersion: Date.now(),
      ...metadata,
    };
  }

  async findExistingCover(romPath, hash) {
    const romDir = path.dirname(romPath);
    const romBaseName = path.basename(romPath, path.extname(romPath));

    for (const extension of COVER_EXTENSIONS) {
      const siblingCover = path.join(romDir, `${romBaseName}${extension}`);
      if (await pathExists(siblingCover)) {
        return siblingCover;
      }
      const cachedCover = path.join(this.coverCacheDir, `${hash}${extension}`);
      if (await pathExists(cachedCover)) {
        return cachedCover;
      }
    }

    return null;
  }

  async fetchRemoteCover(gameId) {
    const game = this.getGame(gameId);

    if (!game || game.coverMode !== "generated" || this.coverFetches.has(game.id)) {
      return;
    }

    this.coverFetches.add(game.id);

    try {
      const variants = createTitleVariants(game.fileName);

      for (const variant of variants) {
        const url = `${LIBRETRO_BOXART_BASE}/${encodeURIComponent(variant)}.png`;
        const response = await fetch(url, {
          headers: {
            "user-agent": "nes-switch-online",
          },
        });

        if (!response.ok) {
          continue;
        }

        const filePath = path.join(this.coverCacheDir, `${game.hash}.png`);
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(filePath, buffer);

        const currentGame = this.getGame(game.id);
        if (currentGame) {
          currentGame.coverPath = filePath;
          currentGame.coverMode = "image";
          currentGame.coverVersion = Date.now();
          this.emitUpdate();
        }
        return;
      }
    } catch {
      // Remote cover download is optional.
    } finally {
      this.coverFetches.delete(game.id);
    }
  }

  async sendRom(req, res) {
    const game = this.getGame(req.params.gameId);
    if (!game) {
      res.status(404).json({ error: "ROM not found." });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.sendFile(game.absolutePath);
  }

  async sendCover(req, res) {
    const game = this.getGame(req.params.gameId);
    if (!game) {
      res.status(404).json({ error: "Cover not found." });
      return;
    }

    if (game.coverPath && (await pathExists(game.coverPath))) {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.sendFile(game.coverPath);
      return;
    }

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(this.generateCoverSvg(game));
  }

  generateCoverSvg(game) {
    const colors = createGradientFromHash(game.hash);
    const titleLines = wrapTitle(game.title, 14);
    const subtitle = `NES ROOM • MAPPER ${game.mapper}`;
    const detailLine = `${game.prgKb} KB PRG • ${game.chrKb} KB CHR`;

    const textLines = titleLines
      .map(
        (line, index) =>
          `<text x="56" y="${130 + index * 52}" fill="white" font-size="${
            index === 0 ? 42 : 34
          }" font-family="Arial, sans-serif" font-weight="700">${xmlEscape(line)}</text>`,
      )
      .join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="720" viewBox="0 0 512 720">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.top}" />
      <stop offset="100%" stop-color="${colors.bottom}" />
    </linearGradient>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="16" stdDeviation="22" flood-color="rgba(0,0,0,.35)" />
    </filter>
  </defs>
  <rect width="512" height="720" rx="42" fill="url(#bg)" />
  <rect x="34" y="34" width="444" height="652" rx="28" fill="rgba(255,255,255,.09)" stroke="rgba(255,255,255,.18)" />
  <circle cx="396" cy="126" r="88" fill="${colors.accent}" opacity=".18" />
  <circle cx="448" cy="88" r="36" fill="white" opacity=".16" />
  <rect x="56" y="78" width="118" height="28" rx="14" fill="rgba(0,0,0,.24)" />
  <text x="74" y="98" fill="white" font-size="18" font-family="Arial, sans-serif" font-weight="700">AUTO COVER</text>
  <g filter="url(#shadow)">
    <rect x="56" y="132" width="400" height="230" rx="26" fill="rgba(0,0,0,.18)" />
    <rect x="82" y="158" width="348" height="178" rx="18" fill="rgba(255,255,255,.14)" stroke="rgba(255,255,255,.18)" />
    <path d="M130 270 C180 180 280 180 346 268" fill="none" stroke="white" stroke-opacity=".72" stroke-width="18" stroke-linecap="round"/>
    <circle cx="194" cy="238" r="24" fill="white" fill-opacity=".82" />
    <circle cx="316" cy="226" r="30" fill="white" fill-opacity=".62" />
  </g>
  ${textLines}
  <text x="56" y="516" fill="rgba(255,255,255,.92)" font-size="18" font-family="Arial, sans-serif" font-weight="600">${xmlEscape(
    subtitle,
  )}</text>
  <text x="56" y="548" fill="rgba(255,255,255,.78)" font-size="20" font-family="Arial, sans-serif">${xmlEscape(
    detailLine,
  )}</text>
  <text x="56" y="622" fill="rgba(255,255,255,.82)" font-size="22" font-family="Arial, sans-serif" font-weight="700">Добавлено автоматически</text>
  <text x="56" y="654" fill="rgba(255,255,255,.68)" font-size="18" font-family="Arial, sans-serif">Положи ROM в папку проекта, и игра появится в библиотеке сама.</text>
</svg>`;
  }
}
