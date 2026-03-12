import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verseBank } from "./content/verseBank.js";
import { wordBank } from "./content/wordBank.js";
import { SqliteStore } from "./persistence/sqliteStore.js";
import { RoomManager } from "./roomManager.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("room manager", () => {
  it("allows only the host to end a room and removes reconnect state", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fellowship-room-manager-"));
    tempPaths.push(tempDir);

    const store = new SqliteStore(path.join(tempDir, "game.sqlite"));
    const manager = new RoomManager(store, {
      words: wordBank,
      bibleVerses: verseBank,
    });

    try {
      const hostRoom = manager.createRoom({ name: "Host" });
      const guestRoom = manager.joinRoom(hostRoom.code, "Guest");
      manager.joinRoom(hostRoom.code, "Reader");

      manager.startRoom(hostRoom.code, hostRoom.meId);

      const timers = (manager as unknown as { timers: Map<string, NodeJS.Timeout> }).timers;
      expect(timers.has(hostRoom.code)).toBe(true);

      expect(() => manager.endRoom(hostRoom.code, guestRoom.meId)).toThrow("Only the host can do that.");

      const endedRoom = manager.endRoom(hostRoom.code, hostRoom.meId);
      expect(endedRoom.code).toBe(hostRoom.code);
      expect(timers.has(hostRoom.code)).toBe(false);
      expect(store.loadRooms()).toHaveLength(0);
      expect(store.findSession(hostRoom.meSessionToken)).toBeUndefined();
      expect(store.findSession(guestRoom.meSessionToken)).toBeUndefined();
      expect(() => manager.joinRoom(hostRoom.code, "Latecomer")).toThrow("That room does not exist.");
      expect(() => manager.reconnectRoom(hostRoom.code, guestRoom.meSessionToken)).toThrow(
        "That room session could not be restored.",
      );
    } finally {
      manager.close();
    }
  });
});
