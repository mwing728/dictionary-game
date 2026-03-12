import {
  type BibleVerseEntry,
  type CreateRoomPayload,
  type PlayerState,
  type RoomSnapshot,
  type RoomView,
  type SubmitPayload,
  type VotePayload,
  type WordEntry,
} from "../../shared/dist/index.js";
import {
  GameError,
  type PromptBanks,
  advancePhase,
  castVote,
  createRoom,
  disconnectPlayer,
  generateRoomCode,
  getRoomView,
  joinRoom,
  reconnectPlayer,
  startGame,
  submitDefinition,
} from "./gameEngine.js";
import { SqliteStore } from "./persistence/sqliteStore.js";

type RoomListener = (room: RoomSnapshot) => void;

export class RoomManager {
  private readonly rooms = new Map<string, RoomSnapshot>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly listeners = new Set<RoomListener>();

  constructor(
    private readonly store: SqliteStore,
    private readonly promptBanks: PromptBanks,
  ) {
    const restoredRooms = this.store.loadRooms();

    for (const room of restoredRooms) {
      hydrateRoom(room);

      for (const player of Object.values(room.players) as PlayerState[]) {
        player.connected = false;
      }

      this.rooms.set(room.code, room);
      this.schedule(room);
    }
  }

  subscribe(listener: RoomListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createRoom(payload: CreateRoomPayload): RoomView {
    const code = generateRoomCode(new Set(this.rooms.keys()));
    const room = createRoom(code, payload);

    this.rooms.set(code, room);
    this.persistAndPublish(room);

    return getRoomView(room, room.hostId);
  }

  joinRoom(code: string, name: string): RoomView {
    const room = this.requireRoom(code);
    const player = joinRoom(room, name);

    this.persistAndPublish(room);
    return getRoomView(room, player.id);
  }

  reconnectRoom(code: string, sessionToken: string): RoomView {
    const session = this.store.findSession(sessionToken);

    if (!session || session.room_code !== code) {
      throw new GameError("That room session could not be restored.");
    }

    const room = this.requireRoom(code);
    const player = reconnectPlayer(room, sessionToken);

    this.persistAndPublish(room);
    return getRoomView(room, player.id);
  }

  getRoomView(code: string, playerId: string): RoomView {
    return getRoomView(this.requireRoom(code), playerId);
  }

  markDisconnected(code: string, playerId: string): void {
    const room = this.rooms.get(code);

    if (!room) {
      return;
    }

    disconnectPlayer(room, playerId);
    this.persistAndPublish(room);
  }

  startRoom(code: string, playerId: string): void {
    const room = this.requireRoom(code);
    this.assertHost(room, playerId);
    startGame(room, this.promptBanks);
    this.persistAndPublish(room);
  }

  submit(code: string, playerId: string, payload: SubmitPayload): void {
    const room = this.requireRoom(code);
    submitDefinition(room, playerId, payload.text);
    this.persistAndPublish(room);
  }

  vote(code: string, playerId: string, payload: VotePayload): void {
    const room = this.requireRoom(code);
    castVote(room, playerId, payload.optionId);
    this.persistAndPublish(room);
  }

  advance(code: string, playerId: string): void {
    const room = this.requireRoom(code);
    this.assertHost(room, playerId);
    advancePhase(room, this.promptBanks);
    this.persistAndPublish(room);
  }

  endRoom(code: string, playerId: string): RoomSnapshot {
    const room = this.requireRoom(code);
    this.assertHost(room, playerId);
    this.clearTimer(room.code);
    this.rooms.delete(room.code);
    this.store.deleteRoom(room.code);
    return room;
  }

  close(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
    this.store.close();
  }

  private requireRoom(code: string): RoomSnapshot {
    const room = this.rooms.get(code.toUpperCase());

    if (!room) {
      throw new GameError("That room does not exist.");
    }

    return room;
  }

  private assertHost(room: RoomSnapshot, playerId: string): void {
    if (room.hostId !== playerId) {
      throw new GameError("Only the host can do that.");
    }
  }

  private persistAndPublish(room: RoomSnapshot): void {
    this.store.saveRoom(room);
    this.schedule(room);

    for (const listener of this.listeners) {
      listener(room);
    }
  }

  private clearTimer(code: string): void {
    const existingTimer = this.timers.get(code);

    if (!existingTimer) {
      return;
    }

    clearTimeout(existingTimer);
    this.timers.delete(code);
  }

  private schedule(room: RoomSnapshot): void {
    this.clearTimer(room.code);

    const deadlineAt = room.activeRound?.phaseDeadlineAt;

    if (!deadlineAt || room.phase === "lobby" || room.phase === "scoreboard" || room.phase === "finished") {
      return;
    }

    const delay = Math.max(0, deadlineAt - Date.now());
    const timer = setTimeout(() => {
      try {
        advancePhase(room, this.promptBanks, Date.now());
        this.persistAndPublish(room);
      } catch {
        this.schedule(room);
      }
    }, delay);

    this.timers.set(room.code, timer);
  }
}

function hydrateRoom(room: RoomSnapshot): void {
  if (!room.activeRound) {
    return;
  }

  room.activeRound.solvedPlayerIds ??= [];
  room.activeRound.submissionScoreDeltas ??= [];
}
