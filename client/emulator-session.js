import { Controller, NES } from "/vendor/jsnes/src/index.js";
import Screen from "/vendor/jsnes/src/browser/screen.js";
import Speakers from "/vendor/jsnes/src/browser/speakers.js";

const FRAME_MS = 1000 / 60;
const HASH_INTERVAL = 120;
const BUTTONS = [
  { bit: 1 << 0, code: Controller.BUTTON_A },
  { bit: 1 << 1, code: Controller.BUTTON_B },
  { bit: 1 << 2, code: Controller.BUTTON_SELECT },
  { bit: 1 << 3, code: Controller.BUTTON_START },
  { bit: 1 << 4, code: Controller.BUTTON_UP },
  { bit: 1 << 5, code: Controller.BUTTON_DOWN },
  { bit: 1 << 6, code: Controller.BUTTON_LEFT },
  { bit: 1 << 7, code: Controller.BUTTON_RIGHT },
];

const KEY_FLAGS = {
  ArrowUp: 1 << 4,
  ArrowDown: 1 << 5,
  ArrowLeft: 1 << 6,
  ArrowRight: 1 << 7,
  KeyX: 1 << 0,
  KeyZ: 1 << 1,
  Enter: 1 << 3,
  ShiftLeft: 1 << 2,
  ShiftRight: 1 << 2,
};

function isEditableTarget(target) {
  return target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function fnv1a32(uint32Array) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < uint32Array.length; index += 97) {
    hash ^= uint32Array[index];
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16);
}

export class EmulatorSession {
  constructor({ mount, overlay, frameEl, syncEl, statusEl, latencyEl }) {
    this.mount = mount;
    this.overlay = overlay;
    this.frameEl = frameEl;
    this.syncEl = syncEl;
    this.statusEl = statusEl;
    this.latencyEl = latencyEl;

    this.screen = null;
    this.speakers = null;
    this.nes = null;
    this.socket = null;
    this.roomId = null;
    this.slot = null;
    this.requiredSlots = [1];
    this.inputDelayFrames = 4;
    this.startedAt = null;
    this.running = false;
    this.paused = false;
    this.localFrame = 0;
    this.sentThroughFrame = -1;
    this.accumulator = 0;
    this.lastTick = 0;
    this.lastAppliedMasks = { 1: 0, 2: 0 };
    this.authoritativeInputs = new Map();
    this.keyState = new Set();
    this.touchMask = 0;
    this.animationFrame = null;
    this.resizeHandler = null;
    this.inputInterceptor = null;
    this.previousInputMask = 0;
    this.menuPaused = false;

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.tick = this.tick.bind(this);
  }

  async start({ roomId, slot, romUrl, socket, startedAt, inputDelayFrames, requiredSlots }) {
    await this.stop();

    this.roomId = roomId;
    this.slot = slot;
    this.socket = socket;
    this.startedAt = startedAt;
    this.inputDelayFrames = inputDelayFrames;
    this.requiredSlots = requiredSlots?.length ? [...requiredSlots] : [1];
    this.running = true;
    this.paused = false;
    this.localFrame = 0;
    this.sentThroughFrame = -1;
    this.accumulator = 0;
    this.lastTick = 0;
    this.lastAppliedMasks = { 1: 0, 2: 0 };
    this.authoritativeInputs.clear();
    this.touchMask = 0;
    this.previousInputMask = 0;
    this.menuPaused = false;

    this.mount.innerHTML = "";
    this.screen = new Screen(this.mount);
    this.screen.fitInParent();
    this.resizeHandler = () => this.screen?.fitInParent();
    window.addEventListener("resize", this.resizeHandler);

    this.speakers = new Speakers({
      onBufferUnderrun: () => {},
    });
    await this.speakers.start();

    this.nes = new NES({
      sampleRate: this.speakers.getSampleRate(),
      onFrame: (buffer) => {
        this.screen.setBuffer(buffer);
      },
      onAudioSample: (left, right) => {
        this.speakers.writeSample(left, right);
      },
      onStatusUpdate: (status) => {
        this.setStatus(status);
      },
    });

    const response = await fetch(romUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Не удалось загрузить ROM для текущей комнаты.");
    }

    this.nes.loadROM(await response.arrayBuffer());

    window.addEventListener("keydown", this.handleKeyDown, { passive: false });
    window.addEventListener("keyup", this.handleKeyUp, { passive: false });

    this.overlay.textContent = "Сессия готовится к старту";
    this.overlay.classList.remove("hidden");
    this.frameEl.textContent = "0";
    this.setSyncStatus("Буферизую кадры");

    this.animationFrame = requestAnimationFrame(this.tick);
  }

  async stop(reason = "") {
    this.running = false;
    this.paused = false;
    this.localFrame = 0;
    this.sentThroughFrame = -1;
    this.accumulator = 0;
    this.lastTick = 0;
    this.authoritativeInputs.clear();
    this.touchMask = 0;
    this.previousInputMask = 0;
    this.menuPaused = false;

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);

    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    if (this.speakers) {
      this.speakers.stop();
      this.speakers = null;
    }

    if (this.screen) {
      this.screen.destroy();
      this.screen = null;
    }

    this.mount.innerHTML = "";
    this.nes = null;
    this.keyState.clear();

    this.overlay.textContent = reason || "Жду запуск сессии";
    this.overlay.classList.remove("hidden");
    this.frameEl.textContent = "0";
    this.setSyncStatus("Ожидание");
    if (!reason) {
      this.statusEl.textContent = "Комната ждёт игроков";
    }
  }

  receiveInput({ slot, frame, mask }) {
    if (!this.running) {
      return;
    }

    let frameInputs = this.authoritativeInputs.get(frame);
    if (!frameInputs) {
      frameInputs = {};
      this.authoritativeInputs.set(frame, frameInputs);
    }

    frameInputs[slot] = mask;
  }

  receivePause() {
    if (!this.running) {
      return;
    }
    this.paused = true;
    this.overlay.textContent = "Пауза от хоста";
    this.overlay.classList.remove("hidden");
    this.setSyncStatus("Пауза");
  }

  receiveResume(startedAt) {
    if (!this.running) {
      return;
    }
    this.paused = false;
    this.startedAt = startedAt;
    this.lastTick = 0;
    this.overlay.textContent = "Возвращаемся в игру";
    this.overlay.classList.remove("hidden");
    this.setSyncStatus("Ресинхронизация");
  }

  handleSnapshotRequest() {
    if (!this.running || this.slot !== 1 || !this.nes || !this.socket) {
      return;
    }

    this.socket.emit("session:snapshot", {
      roomId: this.roomId,
      frame: this.localFrame,
      state: this.nes.toJSON(),
    });
  }

  applySnapshot({ frame, state }) {
    if (!this.running || !this.nes || !this.screen) {
      return;
    }

    this.nes.fromJSON(state);
    this.screen.setBuffer(this.nes.ppu.buffer);
    this.screen.writeBuffer();
    this.localFrame = frame;
    this.accumulator = 0;
    this.lastTick = 0;
    this.sentThroughFrame = Math.max(this.sentThroughFrame, frame + this.inputDelayFrames);
    const previousInputs = this.authoritativeInputs.get(frame - 1) ?? {};
    this.lastAppliedMasks[1] = previousInputs[1] ?? 0;
    this.lastAppliedMasks[2] = previousInputs[2] ?? 0;
    this.setSyncStatus("Восстановлено из снапшота");
  }

  setLatency(latency) {
    this.latencyEl.textContent = `${latency} ms`;
  }

  setTouchBit(bit, active) {
    if (active) {
      this.touchMask |= bit;
    } else {
      this.touchMask &= ~bit;
    }
  }

  setInputInterceptor(handler) {
    this.inputInterceptor = typeof handler === "function" ? handler : null;
    this.previousInputMask = 0;
  }

  setMenuPaused(paused) {
    this.menuPaused = Boolean(paused);
    this.previousInputMask = 0;
    if (!this.menuPaused) {
      this.lastTick = 0;
    }
  }

  serializeState() {
    if (!this.running || !this.nes) {
      return null;
    }

    try {
      return this.nes.toJSON();
    } catch {
      return null;
    }
  }

  restoreState(state) {
    if (!this.running || !this.nes || !this.screen || !state) {
      return false;
    }

    try {
      this.nes.fromJSON(state);
      this.screen.setBuffer(this.nes.ppu.buffer);
      this.screen.writeBuffer();
      this.accumulator = 0;
      this.lastTick = 0;
      this.setSyncStatus("Локальный сейв загружен");
      return true;
    } catch {
      return false;
    }
  }

  refreshLayout() {
    this.screen?.fitInParent();
  }

  clearTouchMask() {
    this.touchMask = 0;
  }

  setStatus(text) {
    if (text) {
      this.statusEl.textContent = text;
    }
  }

  setSyncStatus(text) {
    this.syncEl.textContent = text;
  }

  handleKeyDown(event) {
    if (!(event.code in KEY_FLAGS) || isEditableTarget(event.target)) {
      return;
    }

    event.preventDefault();
    this.keyState.add(event.code);
  }

  handleKeyUp(event) {
    if (!(event.code in KEY_FLAGS)) {
      return;
    }

    event.preventDefault();
    this.keyState.delete(event.code);
  }

  readLocalMask() {
    let mask = 0;

    for (const key of this.keyState) {
      mask |= KEY_FLAGS[key] ?? 0;
    }

    const gamepads = navigator.getGamepads?.() ?? [];
    const gamepad = gamepads.find(Boolean);

    if (gamepad) {
      if (gamepad.buttons[0]?.pressed) mask |= 1 << 0;
      if (gamepad.buttons[1]?.pressed) mask |= 1 << 1;
      if (gamepad.buttons[8]?.pressed) mask |= 1 << 2;
      if (gamepad.buttons[9]?.pressed) mask |= 1 << 3;
      if (gamepad.buttons[12]?.pressed || gamepad.axes[1] < -0.35) mask |= 1 << 4;
      if (gamepad.buttons[13]?.pressed || gamepad.axes[1] > 0.35) mask |= 1 << 5;
      if (gamepad.buttons[14]?.pressed || gamepad.axes[0] < -0.35) mask |= 1 << 6;
      if (gamepad.buttons[15]?.pressed || gamepad.axes[0] > 0.35) mask |= 1 << 7;
    }

    return mask | this.touchMask;
  }

  bufferLocalInput() {
    if (!this.running || !this.slot || !this.socket) {
      return;
    }

    const rawMask = this.readLocalMask();
    let currentMask = rawMask;
    if (this.inputInterceptor) {
      const intercepted = this.inputInterceptor({
        mask: rawMask,
        previousMask: this.previousInputMask,
      });
      if (typeof intercepted === "number") {
        currentMask = intercepted;
      } else if (intercepted && typeof intercepted.mask === "number") {
        currentMask = intercepted.mask;
      }
    }
    this.previousInputMask = rawMask;
    const targetFrame = this.localFrame + this.inputDelayFrames;

    while (this.sentThroughFrame < targetFrame) {
      this.sentThroughFrame += 1;
      this.receiveInput({
        slot: this.slot,
        frame: this.sentThroughFrame,
        mask: currentMask,
      });
      this.socket.emit("session:input", {
        roomId: this.roomId,
        frame: this.sentThroughFrame,
        mask: currentMask,
      });
    }
  }

  getInputsForFrame(frame) {
    const frameInputs = this.authoritativeInputs.get(frame);
    if (!frameInputs) {
      return null;
    }

    for (const slot of this.requiredSlots) {
      if (frameInputs[slot] == null) {
        return null;
      }
    }

    return {
      1: frameInputs[1] ?? 0,
      2: frameInputs[2] ?? 0,
    };
  }

  applyMaskToController(controllerId, nextMask) {
    const previousMask = this.lastAppliedMasks[controllerId];

    for (const button of BUTTONS) {
      const wasPressed = Boolean(previousMask & button.bit);
      const isPressed = Boolean(nextMask & button.bit);

      if (isPressed === wasPressed) {
        continue;
      }

      if (isPressed) {
        this.nes.buttonDown(controllerId, button.code);
      } else {
        this.nes.buttonUp(controllerId, button.code);
      }
    }

    this.lastAppliedMasks[controllerId] = nextMask;
  }

  cleanupInputs() {
    for (const frame of this.authoritativeInputs.keys()) {
      if (frame < this.localFrame - 240) {
        this.authoritativeInputs.delete(frame);
      }
    }
  }

  tick(now) {
    if (!this.running || !this.nes || !this.screen) {
      return;
    }

    this.bufferLocalInput();

    if (this.paused || this.menuPaused) {
      this.animationFrame = requestAnimationFrame(this.tick);
      return;
    }

    if (this.startedAt && Date.now() < this.startedAt) {
      const remaining = Math.max(0, this.startedAt - Date.now());
      this.overlay.textContent =
        remaining > 1000
          ? `Старт через ${Math.ceil(remaining / 1000)}`
          : "Поехали";
      this.overlay.classList.remove("hidden");
      this.animationFrame = requestAnimationFrame(this.tick);
      return;
    }

    if (this.overlay && !this.overlay.classList.contains("hidden")) {
      this.overlay.classList.add("hidden");
    }

    if (!this.lastTick) {
      this.lastTick = now;
    }

    const delta = Math.min(64, now - this.lastTick);
    this.lastTick = now;
    this.accumulator += delta;

    const maxFrames = Math.min(4, Math.floor(this.accumulator / FRAME_MS));

    for (let index = 0; index < maxFrames; index += 1) {
      const inputs = this.getInputsForFrame(this.localFrame);
      if (!inputs) {
        this.accumulator = Math.min(this.accumulator, FRAME_MS);
        this.setSyncStatus(`Жду кадр ${this.localFrame}`);
        break;
      }

      this.applyMaskToController(1, inputs[1]);
      this.applyMaskToController(2, inputs[2]);

      try {
        this.nes.frame();
      } catch (error) {
        this.stop("Ошибка эмулятора");
        console.error(error);
        return;
      }

      this.screen.writeBuffer();
      this.speakers?.flush();
      this.localFrame += 1;
      this.accumulator -= FRAME_MS;
      this.frameEl.textContent = String(this.localFrame);
      this.cleanupInputs();
      this.setSyncStatus("Синхронизировано");

      if (this.socket && this.requiredSlots.length > 1 && this.localFrame % HASH_INTERVAL === 0) {
        this.socket.emit("session:hash", {
          roomId: this.roomId,
          frame: this.localFrame,
          hash: fnv1a32(this.screen.buf32),
        });
      }
    }

    this.animationFrame = requestAnimationFrame(this.tick);
  }
}
