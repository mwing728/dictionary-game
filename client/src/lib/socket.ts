import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getGameSocket(): Socket {
  if (!socket) {
    socket = io(import.meta.env.VITE_SERVER_URL ?? window.location.origin, {
      autoConnect: false,
      transports: ["websocket"],
    });
  }

  return socket;
}
