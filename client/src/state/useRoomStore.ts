import { useSyncExternalStore } from "react";
import type {
  RoomErrorEvent,
  RoomJoinedEvent,
  RoomView,
} from "@fellowship/shared";
import { getGameSocket } from "../lib/socket";

type ConnectionStatus = "idle" | "connecting" | "connected";

interface PersistedSession {
  code: string;
  sessionToken: string;
}

interface RoomStoreState {
  status: ConnectionStatus;
  room: RoomView | null;
  error: string | null;
  reconnecting: boolean;
}

const SESSION_STORAGE_KEY = "fellowship-games-session";

class RoomStore {
  private state: RoomStoreState = {
    status: "idle",
    room: null,
    error: null,
    reconnecting: false,
  };

  private readonly listeners = new Set<() => void>();
  private initialized = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RoomStoreState => this.state;

  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    const socket = getGameSocket();

    socket.on("connect", () => {
      this.setState({ status: "connected" });
    });

    socket.on("disconnect", () => {
      this.setState({ status: "idle" });
    });

    socket.on("room:joined", (payload: RoomJoinedEvent) => {
      this.handleRoom(payload.room);
    });

    socket.on("room:update", (room: RoomView) => {
      this.handleRoom(room);
    });

    socket.on("room:error", (payload: RoomErrorEvent) => {
      this.setState({ error: payload.message, reconnecting: false });
    });

    if (!socket.connected) {
      this.setState({ status: "connecting" });
      socket.connect();
    }
  }

  async reconnectFromStorage(): Promise<void> {
    this.initialize();
    const session = readSession();

    if (!session) {
      return;
    }

    this.setState({ reconnecting: true, error: null });
    await this.emitWithAck("room:reconnect", session);
  }

  async createRoom(name: string): Promise<void> {
    this.initialize();
    this.setState({ error: null });
    await this.emitWithAck("room:create", { name });
  }

  async joinRoom(code: string, name: string): Promise<void> {
    this.initialize();
    this.setState({ error: null });
    await this.emitWithAck("room:join", { code, name });
  }

  startGame(): void {
    getGameSocket().emit("room:start");
  }

  submit(text: string): void {
    getGameSocket().emit("round:submit", { text });
  }

  vote(optionId: string): void {
    getGameSocket().emit("round:vote", { optionId });
  }

  advance(): void {
    getGameSocket().emit("room:advance");
  }

  clearError(): void {
    this.setState({ error: null });
  }

  disconnect(): void {
    writeSession(null);
    this.setState({ room: null, reconnecting: false, error: null });
    getGameSocket().disconnect();
  }

  private async emitWithAck(event: string, payload: unknown): Promise<void> {
    const socket = getGameSocket();

    if (!socket.connected) {
      socket.connect();
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("The server did not respond in time."));
      }, 6000);

      const handleJoined = () => {
        cleanup();
        resolve();
      };

      const handleError = (payload: RoomErrorEvent) => {
        cleanup();
        reject(new Error(payload.message));
      };

      const cleanup = () => {
        window.clearTimeout(timeout);
        socket.off("room:joined", handleJoined);
        socket.off("room:error", handleError);
      };

      socket.on("room:joined", handleJoined);
      socket.on("room:error", handleError);
      socket.emit(event, payload);
    }).catch((error) => {
      this.setState({
        reconnecting: false,
        error: error instanceof Error ? error.message : "Unexpected connection error.",
      });
    });
  }

  private handleRoom(room: RoomView): void {
    writeSession({
      code: room.code,
      sessionToken: room.meSessionToken,
    });

    this.setState({
      room,
      status: "connected",
      reconnecting: false,
      error: null,
    });
  }

  private setState(update: Partial<RoomStoreState>): void {
    this.state = {
      ...this.state,
      ...update,
    };

    for (const listener of this.listeners) {
      listener();
    }
  }
}

const roomStore = new RoomStore();

export function useRoomStore(): RoomStoreState & { actions: RoomStore } {
  const state = useSyncExternalStore(roomStore.subscribe, roomStore.getSnapshot, roomStore.getSnapshot);
  return {
    ...state,
    actions: roomStore,
  };
}

function readSession(): PersistedSession | null {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

function writeSession(session: PersistedSession | null): void {
  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}
