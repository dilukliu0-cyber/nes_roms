import crypto from "node:crypto";

function sanitizeName(name) {
  if (!name) {
    return "Player";
  }

  return String(name).replace(/\s+/g, " ").trim().slice(0, 20) || "Player";
}

function clampInputDelayFrames(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 4;
  }
  return Math.min(8, Math.max(2, Math.round(numeric)));
}

function buildPlayerSnapshot(player, room) {
  return {
    socketId: player.socketId,
    slot: player.slot,
    spectator: player.spectator,
    ready: player.ready,
    name: player.name,
    isHost: room.hostSocketId === player.socketId,
  };
}

export class RoomManager {
  constructor({ library }) {
    this.library = library;
    this.rooms = new Map();
    this.socketToRoom = new Map();
  }

  createRoom(gameId) {
    const game = this.library.getGame(gameId);
    if (!game) {
      throw new Error("Game not found.");
    }

    let roomId = "";
    do {
      roomId = crypto.randomBytes(3).toString("hex").toUpperCase();
    } while (this.rooms.has(roomId));

    const room = {
      id: roomId,
      gameId,
      status: "lobby",
      createdAt: new Date().toISOString(),
      hostSocketId: null,
      players: new Map(),
      session: null,
      lastEndedReason: null,
    };

    this.rooms.set(roomId, room);
    return this.serializeRoom(room);
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) ?? null;
  }

  getSerializedRoom(roomId) {
    const room = this.getRoom(roomId);
    return room ? this.serializeRoom(room) : null;
  }

  joinRoom(roomId, socketId, name) {
    const room = this.getRoom(roomId);
    if (!room) {
      return { error: "Room not found." };
    }

    if (room.players.has(socketId)) {
      return {
        room: this.serializeRoom(room),
        participant: buildPlayerSnapshot(room.players.get(socketId), room),
      };
    }

    const assignedSlot = room.status === "lobby" ? this.getNextFreeSlot(room) : null;
    const spectator = assignedSlot === null;

    const participant = {
      socketId,
      slot: assignedSlot,
      spectator,
      ready: false,
      name: sanitizeName(name),
      joinedAt: new Date().toISOString(),
    };

    room.players.set(socketId, participant);
    this.socketToRoom.set(socketId, room.id);

    if (!room.hostSocketId && !spectator) {
      room.hostSocketId = socketId;
    }

    return {
      room: this.serializeRoom(room),
      participant: buildPlayerSnapshot(participant, room),
    };
  }

  leaveRoom(socketId) {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) {
      return null;
    }

    const room = this.getRoom(roomId);
    if (!room) {
      this.socketToRoom.delete(socketId);
      return null;
    }

    const player = room.players.get(socketId);
    room.players.delete(socketId);
    this.socketToRoom.delete(socketId);

    let sessionEnded = null;

    if (room.hostSocketId === socketId) {
      room.hostSocketId = this.findNewHost(room);
    }

    if (player?.slot && room.status === "running") {
      sessionEnded = this.endSession(room, "player-left");
    }

    if (room.players.size === 0) {
      this.rooms.delete(roomId);
      return {
        roomId,
        room: null,
        sessionEnded,
      };
    }

    return {
      roomId,
      room: this.serializeRoom(room),
      sessionEnded,
    };
  }

  renamePlayer(socketId, name) {
    const room = this.requireRoomForSocket(socketId);
    if (!room) {
      return null;
    }

    const player = room.players.get(socketId);
    if (!player) {
      return null;
    }

    player.name = sanitizeName(name);
    return this.serializeRoom(room);
  }

  setReady(socketId, ready) {
    const room = this.requireRoomForSocket(socketId);
    if (!room || room.status !== "lobby") {
      return null;
    }

    const player = room.players.get(socketId);
    if (!player || player.spectator) {
      return null;
    }

    player.ready = Boolean(ready);
    return this.serializeRoom(room);
  }

  startSession(socketId, { inputDelayFrames }) {
    const room = this.requireRoomForSocket(socketId);
    if (!room) {
      return { error: "Room not found." };
    }

    const game = this.library.getGame(room.gameId);
    if (!game) {
      return { error: "The selected ROM is no longer in the library." };
    }

    if (room.hostSocketId !== socketId) {
      return { error: "Only the host can start the session." };
    }

    if (room.status !== "lobby") {
      return { error: "Session is already running." };
    }

    const activePlayers = [...room.players.values()]
      .filter((player) => !player.spectator && player.slot)
      .sort((left, right) => left.slot - right.slot);

    if (activePlayers.length === 0) {
      return { error: "At least one player is required." };
    }

    if (!activePlayers.every((player) => player.ready)) {
      return { error: "Every connected player must click Ready first." };
    }

    const startAt = Date.now() + 1800;

    room.status = "running";
    room.lastEndedReason = null;
    room.session = {
      startedAt: startAt,
      paused: false,
      inputDelayFrames: clampInputDelayFrames(inputDelayFrames),
      requiredSlots: activePlayers.map((player) => player.slot),
      lastConfirmedFrame: 0,
      hashSamples: new Map(),
      lastDesyncFrame: null,
    };

    return {
      room: this.serializeRoom(room),
      session: {
        roomId: room.id,
        startedAt: startAt,
        inputDelayFrames: room.session.inputDelayFrames,
        requiredSlots: [...room.session.requiredSlots],
        game: this.library.toPublicGame(game),
      },
    };
  }

  pauseSession(socketId) {
    const room = this.requireRoomForSocket(socketId);
    if (!room || room.hostSocketId !== socketId || room.status !== "running" || !room.session) {
      return null;
    }

    room.session.paused = true;
    return this.serializeRoom(room);
  }

  resumeSession(socketId) {
    const room = this.requireRoomForSocket(socketId);
    if (!room || room.hostSocketId !== socketId || room.status !== "running" || !room.session) {
      return null;
    }

    room.session.paused = false;
    room.session.startedAt = Date.now() + 900;
    return {
      room: this.serializeRoom(room),
      startedAt: room.session.startedAt,
    };
  }

  stopSession(socketId) {
    const room = this.requireRoomForSocket(socketId);
    if (!room || room.hostSocketId !== socketId || room.status !== "running") {
      return null;
    }

    const ended = this.endSession(room, "host-ended");
    return {
      room: this.serializeRoom(room),
      ended,
    };
  }

  recordInput(socketId, { frame, mask }) {
    const room = this.requireRoomForSocket(socketId);
    if (!room || room.status !== "running" || !room.session) {
      return { error: "Session is not running." };
    }

    const player = room.players.get(socketId);
    if (!player || !player.slot || player.spectator) {
      return { error: "Only active players can send input." };
    }

    const normalizedFrame = Number(frame);
    const normalizedMask = Number(mask);

    if (
      !Number.isInteger(normalizedFrame) ||
      normalizedFrame < 0 ||
      !Number.isInteger(normalizedMask) ||
      normalizedMask < 0 ||
      normalizedMask > 255
    ) {
      return { error: "Invalid input payload." };
    }

    return {
      roomId: room.id,
      slot: player.slot,
      frame: normalizedFrame,
      mask: normalizedMask,
    };
  }

  recordHash(socketId, { frame, hash }) {
    const room = this.requireRoomForSocket(socketId);
    if (!room || room.status !== "running" || !room.session) {
      return null;
    }

    const player = room.players.get(socketId);
    if (!player || !player.slot || player.spectator) {
      return null;
    }

    const normalizedFrame = Number(frame);
    if (!Number.isInteger(normalizedFrame) || normalizedFrame < 0 || !hash) {
      return null;
    }

    let sample = room.session.hashSamples.get(normalizedFrame);
    if (!sample) {
      sample = new Map();
      room.session.hashSamples.set(normalizedFrame, sample);
    }

    sample.set(player.slot, String(hash));

    const requiredSlots = room.session.requiredSlots;
    if (!requiredSlots.every((slot) => sample.has(slot))) {
      return null;
    }

    const uniqueHashes = new Set(requiredSlots.map((slot) => sample.get(slot)));

    room.session.lastConfirmedFrame = normalizedFrame;

    for (const existingFrame of room.session.hashSamples.keys()) {
      if (existingFrame < normalizedFrame - 240) {
        room.session.hashSamples.delete(existingFrame);
      }
    }

    if (uniqueHashes.size > 1 && room.session.lastDesyncFrame !== normalizedFrame) {
      room.session.lastDesyncFrame = normalizedFrame;
      return {
        roomId: room.id,
        frame: normalizedFrame,
        hostSocketId: room.hostSocketId,
      };
    }

    return null;
  }

  relaySnapshot(socketId, { frame, state }) {
    const room = this.requireRoomForSocket(socketId);
    if (!room || room.status !== "running" || !room.session) {
      return null;
    }

    if (room.hostSocketId !== socketId) {
      return null;
    }

    const normalizedFrame = Number(frame);
    if (!Number.isInteger(normalizedFrame) || normalizedFrame < 0 || !state) {
      return null;
    }

    return {
      roomId: room.id,
      frame: normalizedFrame,
      state,
    };
  }

  serializeRoom(room) {
    const game = this.library.getGame(room.gameId);
    const players = [...room.players.values()]
      .sort((left, right) => {
        if (left.spectator && !right.spectator) {
          return 1;
        }
        if (!left.spectator && right.spectator) {
          return -1;
        }
        return (left.slot ?? 99) - (right.slot ?? 99);
      })
      .map((player) => buildPlayerSnapshot(player, room));

    const activePlayers = players.filter((player) => !player.spectator);
    const canStart =
      room.status === "lobby" &&
      activePlayers.length > 0 &&
      activePlayers.every((player) => player.ready);

    return {
      id: room.id,
      status: room.status,
      createdAt: room.createdAt,
      sharePath: `/room/${room.id}`,
      game: game ? this.library.toPublicGame(game) : null,
      players,
      hostSocketId: room.hostSocketId,
      canStart,
      lastEndedReason: room.lastEndedReason,
      session: room.session
        ? {
            paused: room.session.paused,
            startedAt: room.session.startedAt,
            inputDelayFrames: room.session.inputDelayFrames,
            requiredSlots: [...room.session.requiredSlots],
            lastConfirmedFrame: room.session.lastConfirmedFrame,
          }
        : null,
    };
  }

  getNextFreeSlot(room) {
    const usedSlots = new Set(
      [...room.players.values()].filter((player) => player.slot).map((player) => player.slot),
    );

    if (!usedSlots.has(1)) {
      return 1;
    }
    if (!usedSlots.has(2)) {
      return 2;
    }
    return null;
  }

  findNewHost(room) {
    const nextHost = [...room.players.values()]
      .filter((player) => !player.spectator && player.slot)
      .sort((left, right) => left.slot - right.slot)[0];

    return nextHost?.socketId ?? null;
  }

  requireRoomForSocket(socketId) {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) {
      return null;
    }
    return this.getRoom(roomId);
  }

  endSession(room, reason) {
    room.status = "lobby";
    room.lastEndedReason = reason;
    room.session = null;
    for (const player of room.players.values()) {
      if (!player.spectator) {
        player.ready = false;
      }
    }

    return {
      roomId: room.id,
      reason,
    };
  }
}
