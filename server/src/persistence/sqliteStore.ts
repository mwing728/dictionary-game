import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { PlayerState, RoomSnapshot } from "../../../shared/dist/index.js";

interface SessionRow {
  session_token: string;
  room_code: string;
  player_id: string;
}

export class SqliteStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  loadRooms(): RoomSnapshot[] {
    const rows = this.db.prepare("SELECT snapshot_json FROM rooms").all() as Array<{ snapshot_json: string }>;
    return rows.map((row) => JSON.parse(row.snapshot_json) as RoomSnapshot);
  }

  saveRoom(room: RoomSnapshot): void {
    const saveRoomStatement = this.db.prepare(`
      INSERT INTO rooms (code, snapshot_json, updated_at)
      VALUES (@code, @snapshot_json, @updated_at)
      ON CONFLICT(code) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        updated_at = excluded.updated_at
    `);

    const saveSessionStatement = this.db.prepare(`
      INSERT INTO sessions (session_token, room_code, player_id, updated_at)
      VALUES (@session_token, @room_code, @player_id, @updated_at)
      ON CONFLICT(session_token) DO UPDATE SET
        room_code = excluded.room_code,
        player_id = excluded.player_id,
        updated_at = excluded.updated_at
    `);

    const transaction = this.db.transaction(() => {
      saveRoomStatement.run({
        code: room.code,
        snapshot_json: JSON.stringify(room),
        updated_at: room.updatedAt,
      });

      for (const player of Object.values(room.players) as PlayerState[]) {
        saveSessionStatement.run({
          session_token: player.sessionToken,
          room_code: room.code,
          player_id: player.id,
          updated_at: room.updatedAt,
        });
      }
    });

    transaction();
  }

  findSession(sessionToken: string): SessionRow | undefined {
    return this.db
      .prepare(`
        SELECT session_token, room_code, player_id
        FROM sessions
        WHERE session_token = ?
      `)
      .get(sessionToken) as SessionRow | undefined;
  }

  deleteRoom(code: string): void {
    const deleteRoomStatement = this.db.prepare("DELETE FROM rooms WHERE code = ?");
    const deleteSessionsStatement = this.db.prepare("DELETE FROM sessions WHERE room_code = ?");

    const transaction = this.db.transaction(() => {
      deleteRoomStatement.run(code);
      deleteSessionsStatement.run(code);
    });

    transaction();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        snapshot_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_token TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        player_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }
}
