import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RoundOption } from "../../shared/dist/index.js";
import { verseBank } from "./content/verseBank.js";
import { wordBank } from "./content/wordBank.js";
import {
  advancePhase,
  castVote,
  createRoom,
  getRoomView,
  joinRoom,
  startGame,
  submitDefinition,
} from "./gameEngine.js";
import { SqliteStore } from "./persistence/sqliteStore.js";

const tempPaths: string[] = [];
const promptBanks = {
  words: wordBank,
  bibleVerses: verseBank,
};
const focusedPromptBanks = {
  words: [
    {
      kind: "word" as const,
      id: "abibliophobia",
      word: "abibliophobia",
      definition: "the fear of running out of reading material",
      category: "Oddities",
      difficulty: "easy" as const,
    },
  ],
  bibleVerses: [
    {
      kind: "bibleVerse" as const,
      id: "john-3-16",
      verse: "For God so loved the world, that he gave his only begotten Son.",
      reference: "John 3:16",
      category: "Gospel",
      difficulty: "easy" as const,
    },
  ],
};

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("game engine", () => {
  it("treats the host as a moderator and only scores non-host players", () => {
    const room = createRoom("TEST", { name: "Host" });
    const alice = joinRoom(room, "Alice");
    const bob = joinRoom(room, "Bob");

    startGame(room, promptBanks, 1000);
    expect(room.settings.totalRounds).toBe(20);
    expect(room.activeRound?.prompt.kind).toBe("word");

    expect(() =>
      submitDefinition(room, room.hostId, "A ceremonial ink bottle used by judges.", 2000),
    ).toThrow("does not play in rounds");

    submitDefinition(room, alice.id, "A traveling song performed before dawn.", 3000);
    submitDefinition(room, bob.id, "A brass token given to lighthouse keepers.", 4000);

    expect(room.phase).toBe("voting");
    expect(room.activeRound?.options).toHaveLength(3);

    const realOption = room.activeRound?.options.find((option: RoundOption) => option.kind === "real");
    const aliceBluff = room.activeRound?.options.find((option: RoundOption) => option.authorId === alice.id);

    expect(realOption).toBeDefined();
    expect(aliceBluff).toBeDefined();

    expect(() => castVote(room, room.hostId, realOption!.id, 5000)).toThrow("does not play in rounds");

    castVote(room, alice.id, realOption!.id, 6000);
    castVote(room, bob.id, aliceBluff!.id, 7000);

    expect(room.phase).toBe("voting");
    expect(room.activeRound?.phaseDeadlineAt).toBe(4000 + room.settings.votingSeconds * 1000);

    advancePhase(room, promptBanks, 8000);
    expect(room.phase).toBe("reveal");
    expect(room.activeRound?.phaseDeadlineAt).toBeNull();
    expect(room.players[room.hostId]?.score).toBe(0);
    expect(room.players[alice.id]?.score).toBe(3);
    expect(room.players[bob.id]?.score).toBe(0);
    expect(room.activeRound?.reveal?.scoreDeltas).toHaveLength(2);

    advancePhase(room, promptBanks, 9000);
    expect(room.phase).toBe("scoreboard");
    expect(room.activeRound?.phaseDeadlineAt).toBeNull();
    advancePhase(room, promptBanks, 10000);
    expect(room.phase).toBe("submission");
    expect(room.currentRoundIndex).toBe(1);
    expect(room.activeRound?.prompt.kind).toBe("bibleVerse");
  });

  it("alternates to bible verse rounds and hides solver and self-authored references", () => {
    const room = createRoom("SAVE", { name: "Archivist" });
    const guest = joinRoom(room, "Historian");
    const secondGuest = joinRoom(room, "Researcher");
    const thirdGuest = joinRoom(room, "Scribe");

    const hostLobbyView = getRoomView(room, room.hostId);
    expect(hostLobbyView.canStart).toBe(true);

    startGame(room, focusedPromptBanks, 1000);
    submitDefinition(room, guest.id, "A brass whistle used on old steamships.", 2000);

    const view = getRoomView(room, guest.id);
    expect(view.round?.hasSubmitted).toBe(true);
    expect(view.round?.submissionsCount).toBe(1);
    expect(view.round?.playersNeeded).toBe(3);
    expect(view.players).toHaveLength(4);
    expect(view.round?.selectedOptionId).toBeUndefined();
    expect(view.round?.promptKind).toBe("word");

    submitDefinition(room, secondGuest.id, "A leather case for folding maps.", 3000);
    submitDefinition(room, thirdGuest.id, "A silver compass for crossing old trade routes.", 3500);
    const realOption = room.activeRound?.options.find((option: RoundOption) => option.kind === "real");
    castVote(room, guest.id, realOption!.id, 4000);
    castVote(room, secondGuest.id, realOption!.id, 5000);
    castVote(room, thirdGuest.id, realOption!.id, 5500);

    expect(room.phase).toBe("voting");

    advancePhase(room, focusedPromptBanks, 6000);
    advancePhase(room, focusedPromptBanks, 7000);
    advancePhase(room, focusedPromptBanks, 8000);

    expect(room.phase).toBe("submission");
    expect(room.activeRound?.prompt.kind).toBe("bibleVerse");
    const versePrompt = room.activeRound?.prompt;
    expect(versePrompt?.kind).toBe("bibleVerse");
    if (!versePrompt || versePrompt.kind !== "bibleVerse") {
      throw new Error("Expected a Bible verse round.");
    }

    submitDefinition(room, guest.id, "joHN: 3:16", 9000);
    submitDefinition(room, secondGuest.id, "Psalm: 91:1", 10000);
    submitDefinition(room, thirdGuest.id, "Romans: 12:2", 11000);

    const guestVotingView = getRoomView(room, guest.id);
    const secondGuestVotingView = getRoomView(room, secondGuest.id);
    const thirdGuestVotingView = getRoomView(room, thirdGuest.id);
    expect(guestVotingView.round?.hasSolved).toBe(true);
    expect(guestVotingView.round?.options).toHaveLength(0);
    expect(secondGuestVotingView.round?.promptKind).toBe("bibleVerse");
    expect(secondGuestVotingView.round?.options.some((option) => option.text === "Psalm: 91:1")).toBe(false);
    expect(secondGuestVotingView.round?.options.some((option) => option.text === versePrompt.reference)).toBe(true);
    expect(thirdGuestVotingView.round?.options.some((option) => option.text === "Romans: 12:2")).toBe(false);
  });

  it("auto-scores close word definitions, hides them, and skips solver voting", () => {
    const room = createRoom("WORD", { name: "Host" });
    const alice = joinRoom(room, "Alice");
    const bob = joinRoom(room, "Bob");
    const cara = joinRoom(room, "Cara");

    startGame(room, focusedPromptBanks, 1000);
    submitDefinition(room, alice.id, "Fear of running out of books to read", 2000);

    expect(room.players[alice.id]?.score).toBe(2);
    expect(room.activeRound?.solvedPlayerIds).toEqual([alice.id]);

    submitDefinition(room, bob.id, "A church custom for sorting printed bulletins.", 3000);
    submitDefinition(room, cara.id, "The fear of speaking aloud during announcements.", 4000);

    expect(room.phase).toBe("voting");
    expect(room.activeRound?.options.some((option) => option.text === "Fear of running out of books to read")).toBe(
      false,
    );

    const aliceView = getRoomView(room, alice.id);
    const bobView = getRoomView(room, bob.id);
    expect(aliceView.round?.hasSolved).toBe(true);
    expect(aliceView.round?.canVote).toBe(false);
    expect(aliceView.round?.options).toHaveLength(0);
    expect(bobView.round?.canVote).toBe(true);
    expect(bobView.round?.options.some((option) => option.text === "A church custom for sorting printed bulletins.")).toBe(
      false,
    );
    expect(
      () => castVote(room, alice.id, room.activeRound?.options[0]?.id ?? "missing-option", 5000),
    ).toThrow("already solved");

    const realOption = room.activeRound?.options.find((option: RoundOption) => option.kind === "real");
    const bobBluff = room.activeRound?.options.find((option: RoundOption) => option.authorId === bob.id);
    expect(realOption).toBeDefined();
    expect(bobBluff).toBeDefined();

    castVote(room, bob.id, realOption!.id, 6000);
    castVote(room, cara.id, bobBluff!.id, 7000);

    expect(room.phase).toBe("voting");

    advancePhase(room, focusedPromptBanks, 8000);
    expect(room.phase).toBe("reveal");
    expect(room.players[alice.id]?.score).toBe(2);
    expect(room.players[bob.id]?.score).toBe(3);
    expect(room.players[cara.id]?.score).toBe(0);
    expect(room.activeRound?.reveal?.scoreDeltas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: alice.id, points: 2, reason: "correct_guess" }),
        expect.objectContaining({ playerId: bob.id, points: 2, reason: "correct_guess" }),
        expect.objectContaining({ playerId: bob.id, points: 1, reason: "fooled_player" }),
      ]),
    );
  });

  it("auto-scores exact bible references case-insensitively and still requires exact chapter and verse", () => {
    const room = createRoom("VERSE", { name: "Host" });
    const guest = joinRoom(room, "Historian");
    const secondGuest = joinRoom(room, "Researcher");
    const thirdGuest = joinRoom(room, "Teacher");

    startGame(room, focusedPromptBanks, 1000);
    submitDefinition(room, guest.id, "A bell rung for late readers before supper.", 2000);
    submitDefinition(room, secondGuest.id, "A small ribbon tied around old hymnals.", 3000);
    submitDefinition(room, thirdGuest.id, "A candle kept beside the final pew.", 3500);

    const firstRoundRealOption = room.activeRound?.options.find((option: RoundOption) => option.kind === "real");
    expect(firstRoundRealOption).toBeDefined();
    castVote(room, guest.id, firstRoundRealOption!.id, 4000);
    castVote(room, secondGuest.id, firstRoundRealOption!.id, 5000);
    castVote(room, thirdGuest.id, firstRoundRealOption!.id, 5500);

    expect(room.phase).toBe("voting");

    advancePhase(room, focusedPromptBanks, 6000);
    advancePhase(room, focusedPromptBanks, 7000);
    advancePhase(room, focusedPromptBanks, 8000);

    expect(room.phase).toBe("submission");
    expect(room.activeRound?.prompt.kind).toBe("bibleVerse");

    const guestScoreBeforeSolve = room.players[guest.id]?.score ?? 0;
    submitDefinition(room, guest.id, "joHN: 3:16", 8000);
    submitDefinition(room, secondGuest.id, "John: 3:17", 9000);
    submitDefinition(room, thirdGuest.id, "Luke: 2:11", 9500);

    expect(room.players[guest.id]?.score).toBe(guestScoreBeforeSolve + 2);
    expect(room.phase).toBe("voting");
    expect(room.activeRound?.options.some((option) => option.text === "joHN: 3:16")).toBe(false);

    const guestVotingView = getRoomView(room, guest.id);
    const secondGuestVotingView = getRoomView(room, secondGuest.id);
    const thirdGuestVotingView = getRoomView(room, thirdGuest.id);
    expect(guestVotingView.round?.hasSolved).toBe(true);
    expect(guestVotingView.round?.canVote).toBe(false);
    expect(guestVotingView.round?.options).toHaveLength(0);
    expect(secondGuestVotingView.round?.promptKind).toBe("bibleVerse");
    expect(secondGuestVotingView.round?.options.some((option) => option.text === "John: 3:17")).toBe(false);
    expect(secondGuestVotingView.round?.options.some((option) => option.text === "John 3:16")).toBe(true);
    expect(thirdGuestVotingView.round?.options.some((option) => option.text === "Luke: 2:11")).toBe(false);
  });

  it("skips voting when only one eligible voter remains after submission solves", () => {
    const room = createRoom("LONE", { name: "Host" });
    const alice = joinRoom(room, "Alice");
    const bob = joinRoom(room, "Bob");
    const cara = joinRoom(room, "Cara");

    startGame(room, focusedPromptBanks, 1000);
    submitDefinition(room, alice.id, "Fear of running out of books to read", 2000);
    submitDefinition(room, bob.id, "The fear of running out of reading material", 3000);
    submitDefinition(room, cara.id, "A church custom for sorting printed bulletins.", 4000);

    expect(room.phase).toBe("reveal");
    expect(room.players[alice.id]?.score).toBe(2);
    expect(room.players[bob.id]?.score).toBe(2);
    expect(room.players[cara.id]?.score).toBe(0);
    expect(room.activeRound?.reveal?.scoreDeltas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: alice.id, points: 2, reason: "correct_guess" }),
        expect.objectContaining({ playerId: bob.id, points: 2, reason: "correct_guess" }),
      ]),
    );
    expect(room.activeRound?.reveal?.scoreDeltas).toHaveLength(2);
    expect(room.activeRound?.votes).toEqual({});
  });

  it("lets players change their vote before voting ends", () => {
    const room = createRoom("SWAP", { name: "Host" });
    const alice = joinRoom(room, "Alice");
    const bob = joinRoom(room, "Bob");
    const cara = joinRoom(room, "Cara");

    startGame(room, focusedPromptBanks, 1000);
    submitDefinition(room, alice.id, "A church custom for sorting printed bulletins.", 2000);
    submitDefinition(room, bob.id, "A bell rung before the choir enters.", 3000);
    submitDefinition(room, cara.id, "A brass token given to lighthouse keepers.", 4000);

    const realOption = room.activeRound?.options.find((option: RoundOption) => option.kind === "real");
    const bobBluff = room.activeRound?.options.find((option: RoundOption) => option.authorId === bob.id);
    const caraBluff = room.activeRound?.options.find((option: RoundOption) => option.authorId === cara.id);

    expect(realOption).toBeDefined();
    expect(bobBluff).toBeDefined();
    expect(caraBluff).toBeDefined();

    castVote(room, alice.id, bobBluff!.id, 5000);
    expect(room.phase).toBe("voting");
    expect(room.activeRound?.votes[alice.id]?.optionId).toBe(bobBluff!.id);

    castVote(room, alice.id, realOption!.id, 5500);
    expect(room.phase).toBe("voting");
    expect(room.activeRound?.votes[alice.id]?.optionId).toBe(realOption!.id);

    castVote(room, bob.id, realOption!.id, 6000);
    castVote(room, cara.id, bobBluff!.id, 7000);

    expect(room.phase).toBe("voting");

    advancePhase(room, focusedPromptBanks, 8000);
    expect(room.phase).toBe("reveal");
    expect(room.players[alice.id]?.score).toBe(2);
    expect(room.players[bob.id]?.score).toBe(3);
    expect(room.players[cara.id]?.score).toBe(0);

    const revealedRealOption = room.activeRound?.options.find((option: RoundOption) => option.kind === "real");
    const revealedBobBluff = room.activeRound?.options.find((option: RoundOption) => option.authorId === bob.id);
    expect(revealedRealOption?.voteCount).toBe(2);
    expect(revealedBobBluff?.voteCount).toBe(1);
  });

  it("persists snapshots for restart recovery", () => {
    const room = createRoom("SAVE", { name: "Archivist" });
    const guest = joinRoom(room, "Historian");
    const secondGuest = joinRoom(room, "Researcher");
    startGame(room, promptBanks, 1000);
    submitDefinition(room, guest.id, "A brass whistle used on old steamships.", 2000);
    submitDefinition(room, secondGuest.id, "A leather case for folding maps.", 3000);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lexibluff-"));
    tempPaths.push(tempDir);
    const store = new SqliteStore(path.join(tempDir, "game.sqlite"));

    store.saveRoom(room);
    const restoredRooms = store.loadRooms();
    const session = store.findSession(guest.sessionToken);
    store.close();

    expect(restoredRooms).toHaveLength(1);
    expect(restoredRooms[0]?.code).toBe(room.code);
    expect(session?.player_id).toBe(guest.id);
    expect(session?.room_code).toBe(room.code);
  });
});
