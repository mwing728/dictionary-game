import type { Server as HttpServer } from "node:http";
import type {
  CreateRoomPayload,
  JoinPayload,
  RoomEndedEvent,
  ReconnectPayload,
  SubmitPayload,
  VotePayload,
} from "../../shared/dist/index.js";
import { Server, type Socket } from "socket.io";
import { GameError } from "./gameEngine.js";
import { RoomManager } from "./roomManager.js";

interface SocketSession {
  roomCode: string;
  playerId: string;
}

export function createSocketServer(server: HttpServer, roomManager: RoomManager): Server {
  const io = new Server(server, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  const sessionsBySocket = new Map<string, SocketSession>();
  const socketsByPlayer = new Map<string, Set<string>>();

  roomManager.subscribe((room) => {
    for (const player of Object.values(room.players)) {
      const socketIds = socketsByPlayer.get(player.id);

      if (!socketIds) {
        continue;
      }

      const view = roomManager.getRoomView(room.code, player.id);

      for (const socketId of socketIds) {
        io.to(socketId).emit("room:update", view);
      }
    }
  });

  io.on("connection", (socket) => {
    socket.on("room:create", (payload: CreateRoomPayload) => {
      runSafely(socket, () => {
        const room = roomManager.createRoom(payload);
        attachSocket(socket.id, { roomCode: room.code, playerId: room.meId });
        void socket.join(room.code);
        socket.emit("room:joined", { room });
      });
    });

    socket.on("room:join", (payload: JoinPayload) => {
      runSafely(socket, () => {
        const room = roomManager.joinRoom(payload.code.toUpperCase(), payload.name);
        attachSocket(socket.id, { roomCode: room.code, playerId: room.meId });
        void socket.join(room.code);
        socket.emit("room:joined", { room });
      });
    });

    socket.on("room:reconnect", (payload: ReconnectPayload) => {
      runSafely(socket, () => {
        const room = roomManager.reconnectRoom(payload.code.toUpperCase(), payload.sessionToken);
        attachSocket(socket.id, { roomCode: room.code, playerId: room.meId });
        void socket.join(room.code);
        socket.emit("room:joined", { room });
      });
    });

    socket.on("room:start", () => {
      runSafely(socket, () => {
        const session = requireSession(socket.id);
        roomManager.startRoom(session.roomCode, session.playerId);
      });
    });

    socket.on("round:submit", (payload: SubmitPayload) => {
      runSafely(socket, () => {
        const session = requireSession(socket.id);
        roomManager.submit(session.roomCode, session.playerId, payload);
      });
    });

    socket.on("round:vote", (payload: VotePayload) => {
      runSafely(socket, () => {
        const session = requireSession(socket.id);
        roomManager.vote(session.roomCode, session.playerId, payload);
      });
    });

    socket.on("room:advance", () => {
      runSafely(socket, () => {
        const session = requireSession(socket.id);
        roomManager.advance(session.roomCode, session.playerId);
      });
    });

    socket.on("room:end", () => {
      runSafely(socket, () => {
        const session = requireSession(socket.id);
        const room = roomManager.endRoom(session.roomCode, session.playerId);
        const payload: RoomEndedEvent = {
          reason: "ended_by_host",
          message: "The host ended the room session.",
        };

        io.to(room.code).emit("room:ended", payload);
        clearRoomSessions(room.code, Object.keys(room.players));
      });
    });

    socket.on("disconnect", () => {
      const session = sessionsBySocket.get(socket.id);

      if (!session) {
        return;
      }

      sessionsBySocket.delete(socket.id);

      const sockets = socketsByPlayer.get(session.playerId);

      if (!sockets) {
        return;
      }

      sockets.delete(socket.id);

      if (sockets.size === 0) {
        socketsByPlayer.delete(session.playerId);
        roomManager.markDisconnected(session.roomCode, session.playerId);
      }
    });
  });

  return io;

  function attachSocket(socketId: string, session: SocketSession): void {
    sessionsBySocket.set(socketId, session);

    const sockets = socketsByPlayer.get(session.playerId) ?? new Set<string>();
    sockets.add(socketId);
    socketsByPlayer.set(session.playerId, sockets);
  }

  function requireSession(socketId: string): SocketSession {
    const session = sessionsBySocket.get(socketId);

    if (!session) {
      throw new GameError("Join a room before sending game actions.");
    }

    return session;
  }

  function clearRoomSessions(roomCode: string, playerIds: string[]): void {
    for (const playerId of playerIds) {
      const socketIds = socketsByPlayer.get(playerId);

      if (!socketIds) {
        continue;
      }

      for (const socketId of socketIds) {
        sessionsBySocket.delete(socketId);
      }

      socketsByPlayer.delete(playerId);
    }

    io.in(roomCode).socketsLeave(roomCode);
  }
}

function runSafely(socket: Socket, task: () => void): void {
  try {
    task();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    socket.emit("room:error", { message });
  }
}
