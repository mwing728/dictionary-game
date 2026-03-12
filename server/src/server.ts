import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { verseBank } from "./content/verseBank.js";
import { wordBank } from "./content/wordBank.js";
import { SqliteStore } from "./persistence/sqliteStore.js";
import { RoomManager } from "./roomManager.js";
import { createSocketServer } from "./socket.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..");
const monorepoRoot = path.resolve(serverRoot, "..");
const clientDistPath = path.resolve(monorepoRoot, "client", "dist");
const databasePath = path.resolve(serverRoot, "data", "game.sqlite");
const port = Number(process.env.PORT ?? 3001);

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const store = new SqliteStore(databasePath);
const roomManager = new RoomManager(store, {
  words: wordBank,
  bibleVerses: verseBank,
});

createSocketServer(httpServer, roomManager);

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    timestamp: Date.now(),
  });
});

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get(/^(?!\/health).*/, (_request, response) => {
    response.sendFile(path.join(clientDistPath, "index.html"));
  });
}

httpServer.listen(port, () => {
  console.log(`Game server listening on http://localhost:${port}`);
});

process.on("SIGINT", () => {
  roomManager.close();
  httpServer.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  roomManager.close();
  httpServer.close(() => process.exit(0));
});
