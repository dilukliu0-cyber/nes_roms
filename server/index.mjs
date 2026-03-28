import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { Server as SocketServer } from "socket.io";

import { RomLibrary } from "./rom-library.mjs";
import { RoomManager } from "./room-manager.mjs";
import { getTelegramPublicConfig, validateTelegramInitData } from "./telegram-mini-app.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const clientDir = path.join(projectRoot, "client");
const romsDir = path.join(projectRoot, "roms");
const coverCacheDir = path.join(projectRoot, "cover-cache");
const nodeModulesDir = path.join(projectRoot, "node_modules");

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: {
    origin: "*",
  },
  maxHttpBufferSize: 1e8,
});

const library = new RomLibrary({
  romsDir,
  coverCacheDir,
  onUpdate(games) {
    io.emit("catalog:updated", games);
  },
});

const rooms = new RoomManager({ library });

app.use(express.json({ limit: "2mb" }));
app.use("/vendor/jsnes", express.static(path.join(nodeModulesDir, "jsnes")));
app.use(express.static(clientDir));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    games: library.getGames().length,
    rooms: rooms.rooms.size,
  });
});

app.get("/api/telegram/config", (_req, res) => {
  res.json({
    telegram: getTelegramPublicConfig(),
  });
});

app.post("/api/telegram/session", (req, res) => {
  const initData = typeof req.body?.initData === "string" ? req.body.initData : "";

  res.json({
    telegram: getTelegramPublicConfig(),
    auth: validateTelegramInitData(initData),
  });
});

app.get("/api/games", (_req, res) => {
  res.json({
    games: library.getPublicGames(),
  });
});

app.get("/api/rooms/:roomId", (req, res) => {
  const room = rooms.getSerializedRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  res.json({ room });
});

app.post("/api/rooms", (req, res) => {
  try {
    const room = rooms.createRoom(req.body?.gameId);
    res.status(201).json({ room });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to create room.",
    });
  }
});

app.get("/api/roms/:gameId/file", async (req, res) => {
  await library.sendRom(req, res);
});

app.get("/api/games/:gameId/cover", async (req, res) => {
  await library.sendCover(req, res);
});

app.get(["/", "/room/:roomId"], (_req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

function handleRoomExit(socket) {
  const result = rooms.leaveRoom(socket.id);
  if (!result) {
    return;
  }

  socket.leave(result.roomId);

  if (result.sessionEnded) {
    io.to(result.roomId).emit("session:ended", result.sessionEnded);
  }

  if (result.room) {
    io.to(result.roomId).emit("room:state", result.room);
  }
}

io.on("connection", (socket) => {
  socket.emit("catalog:updated", library.getPublicGames());

  socket.on("net:ping", (_payload, ack) => {
    if (typeof ack === "function") {
      ack({ now: Date.now() });
    }
  });

  socket.on("room:join", ({ roomId, name } = {}) => {
    handleRoomExit(socket);

    const result = rooms.joinRoom(roomId, socket.id, name);
    if (result?.error) {
      socket.emit("room:error", { message: result.error });
      return;
    }

    socket.join(roomId);
    socket.emit("room:joined", {
      room: result.room,
      participant: result.participant,
    });
    io.to(roomId).emit("room:state", result.room);
  });

  socket.on("room:leave", () => {
    handleRoomExit(socket);
  });

  socket.on("room:rename", ({ name } = {}) => {
    const room = rooms.renamePlayer(socket.id, name);
    if (room) {
      io.to(room.id).emit("room:state", room);
    }
  });

  socket.on("room:ready", ({ ready } = {}) => {
    const room = rooms.setReady(socket.id, ready);
    if (room) {
      io.to(room.id).emit("room:state", room);
    }
  });

  socket.on("room:start", ({ inputDelayFrames } = {}) => {
    const result = rooms.startSession(socket.id, { inputDelayFrames });
    if (result?.error) {
      socket.emit("room:error", { message: result.error });
      return;
    }

    io.to(result.room.id).emit("session:starting", result.session);
    io.to(result.room.id).emit("room:state", result.room);
  });

  socket.on("session:pause", () => {
    const room = rooms.pauseSession(socket.id);
    if (!room) {
      return;
    }
    io.to(room.id).emit("session:paused", {
      roomId: room.id,
    });
    io.to(room.id).emit("room:state", room);
  });

  socket.on("session:resume", () => {
    const result = rooms.resumeSession(socket.id);
    if (!result) {
      return;
    }

    io.to(result.room.id).emit("session:resumed", {
      roomId: result.room.id,
      startedAt: result.startedAt,
    });
    io.to(result.room.id).emit("room:state", result.room);
  });

  socket.on("session:stop", () => {
    const result = rooms.stopSession(socket.id);
    if (!result) {
      return;
    }

    io.to(result.room.id).emit("session:ended", result.ended);
    io.to(result.room.id).emit("room:state", result.room);
  });

  socket.on("session:input", (payload) => {
    const result = rooms.recordInput(socket.id, payload ?? {});
    if (!result || result.error) {
      return;
    }

    io.to(result.roomId).emit("session:input", result);
  });

  socket.on("session:hash", (payload) => {
    const desync = rooms.recordHash(socket.id, payload ?? {});
    if (!desync?.hostSocketId) {
      return;
    }

    io.to(desync.hostSocketId).emit("session:request-snapshot", {
      roomId: desync.roomId,
      frame: desync.frame,
    });
  });

  socket.on("session:snapshot", (payload) => {
    const snapshot = rooms.relaySnapshot(socket.id, payload ?? {});
    if (!snapshot) {
      return;
    }

    socket.to(snapshot.roomId).emit("session:snapshot", snapshot);
  });

  socket.on("disconnect", () => {
    handleRoomExit(socket);
  });
});

await library.init();

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`NES Switch Online server listening on http://localhost:${port}`);
});
