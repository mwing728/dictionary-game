import crypto from "node:crypto";
import {
  DEFAULT_SETTINGS,
  SCORE_VALUES,
  type BibleVerseEntry,
  type CreateRoomPayload,
  type GamePhase,
  type GameSettings,
  type PlayerState,
  type PromptEntry,
  type PromptKind,
  type RoomSnapshot,
  type RoomView,
  type RoundOption,
  type RoundState,
  type ScoreDelta,
  type WordEntry,
} from "../../shared/dist/index.js";

export class GameError extends Error {}

export interface PromptBanks {
  words: WordEntry[];
  bibleVerses: BibleVerseEntry[];
}

const ROOM_CODE_LENGTH = 4;
const DEFINITION_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "out",
  "the",
  "to",
  "with",
  "act",
  "being",
  "having",
  "relating",
  "something",
  "state",
  "very",
]);

export function generateRoomCode(existingCodes: Set<string>): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let code = "";

    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    if (!existingCodes.has(code)) {
      return code;
    }
  }

  throw new GameError("Unable to generate a unique room code.");
}

export function createRoom(
  code: string,
  payload: CreateRoomPayload,
  settings: GameSettings = DEFAULT_SETTINGS,
  now = Date.now(),
): RoomSnapshot {
  const host = createPlayer(payload.name, true, now);

  return {
    code,
    phase: "lobby",
    hostId: host.id,
    createdAt: now,
    updatedAt: now,
    currentRoundIndex: 0,
    settings,
    players: {
      [host.id]: host,
    },
    activeRound: null,
    usedPromptIds: [],
    winnerIds: [],
  };
}

export function joinRoom(room: RoomSnapshot, name: string, now = Date.now()): PlayerState {
  assertPhase(room, "lobby", "New players can only join before the game starts.");

  const trimmedName = normalizeName(name);
  const existingNames = Object.values(room.players).map((player) => player.name.toLowerCase());

  if (existingNames.includes(trimmedName.toLowerCase())) {
    throw new GameError("That name is already taken in this room.");
  }

  if (getParticipantCount(room) >= room.settings.maxPlayers) {
    throw new GameError("That room is already full.");
  }

  const player = createPlayer(trimmedName, false, now);
  room.players[player.id] = player;
  touch(room, now);
  return player;
}

export function reconnectPlayer(room: RoomSnapshot, sessionToken: string, now = Date.now()): PlayerState {
  const player = Object.values(room.players).find((candidate) => candidate.sessionToken === sessionToken);

  if (!player) {
    throw new GameError("That session could not be restored.");
  }

  player.connected = true;
  player.lastSeenAt = now;
  touch(room, now);
  return player;
}

export function disconnectPlayer(room: RoomSnapshot, playerId: string, now = Date.now()): void {
  const player = room.players[playerId];

  if (!player) {
    return;
  }

  player.connected = false;
  player.lastSeenAt = now;
  touch(room, now);
}

export function startGame(room: RoomSnapshot, promptBanks: PromptBanks, now = Date.now()): void {
  assertPhase(room, "lobby", "The game has already started.");

  if (getParticipantCount(room) < 2) {
    throw new GameError("At least two players are required to start.");
  }

  room.currentRoundIndex = 0;
  room.winnerIds = [];
  room.usedPromptIds = [];
  startNextRound(room, promptBanks, now);
}

export function submitDefinition(room: RoomSnapshot, playerId: string, text: string, now = Date.now()): void {
  assertPhase(room, "submission", "You can only submit during the submission phase.");
  assertParticipant(room, playerId);

  const round = assertRound(room);

  if (hasSolvedRound(round, playerId)) {
    throw new GameError("You already solved this round.");
  }

  const trimmed = normalizeSubmission(text);
  const normalized = getSubmissionComparisonValue(round.prompt.kind, trimmed);

  validateSubmission(round.prompt, trimmed, normalized);
  const isCorrect = isCorrectSubmission(round.prompt, trimmed, normalized);

  if (!isCorrect) {
    const duplicate = Object.values(round.submissions).some((submission) => {
      return submission.playerId !== playerId && getSubmissionComparisonValue(round.prompt.kind, submission.text) === normalized;
    });

    if (duplicate) {
      throw new GameError(getDuplicateMessage(round.prompt.kind));
    }
  }

  round.submissions[playerId] = {
    playerId,
    text: trimmed,
    createdAt: now,
  };

  if (isCorrect) {
    round.solvedPlayerIds.push(playerId);
    room.players[playerId]!.score += SCORE_VALUES.correctGuess;
    round.submissionScoreDeltas.push({
      playerId,
      points: SCORE_VALUES.correctGuess,
      reason: "correct_guess",
    });
  }

  touch(room, now);

  if (Object.keys(round.submissions).length >= getParticipantCount(room)) {
    moveToVoting(room, now);
  }
}

export function castVote(room: RoomSnapshot, playerId: string, optionId: string, now = Date.now()): void {
  assertPhase(room, "voting", "You can only vote during the voting phase.");
  assertParticipant(room, playerId);

  const round = assertRound(room);

  if (!canPlayerVote(round, playerId)) {
    throw new GameError("You already solved this round and cannot vote.");
  }

  const option = round.options.find((candidate) => candidate.id === optionId);

  if (!option) {
    throw new GameError("That answer option does not exist.");
  }

  if (option.authorId === playerId) {
    throw new GameError("You cannot vote for your own submitted answer.");
  }

  round.votes[playerId] = {
    voterId: playerId,
    optionId,
    createdAt: now,
  };

  touch(room, now);

  if (Object.keys(round.votes).length >= getEligibleVoterCount(room, round)) {
    moveToReveal(room, now);
  }
}

export function advancePhase(room: RoomSnapshot, promptBanks: PromptBanks, now = Date.now()): void {
  switch (room.phase) {
    case "submission":
      moveToVoting(room, now);
      return;
    case "voting":
      moveToReveal(room, now);
      return;
    case "reveal":
      moveToScoreboard(room, now);
      return;
    case "scoreboard":
      if (room.currentRoundIndex + 1 >= room.settings.totalRounds) {
        finishGame(room, now);
        return;
      }

      room.currentRoundIndex += 1;
      startNextRound(room, promptBanks, now);
      return;
    case "finished":
      return;
    case "lobby":
      throw new GameError("Only the host can start the game from the lobby.");
    default:
      throw new GameError(`Unsupported phase transition: ${room.phase}`);
  }
}

export function getRoomView(room: RoomSnapshot, playerId: string): RoomView {
  const player = assertPlayer(room, playerId);
  const round = room.activeRound;
  const participants = getParticipants(room);
  const hasSolved = Boolean(round && hasSolvedRound(round, playerId));
  const canVote = Boolean(round && !player.isHost && canPlayerVote(round, playerId));
  const visibleOptions =
    round && room.phase === "voting"
      ? canVote
        ? round.options.filter((option) => option.authorId !== playerId)
        : []
      : round?.options ?? [];
  const players = Object.values(room.players)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      score: candidate.score,
      isHost: candidate.isHost,
      connected: candidate.connected,
    }))
    .sort((left, right) => {
      if (left.isHost !== right.isHost) {
        return left.isHost ? 1 : -1;
      }

      return right.score - left.score || left.name.localeCompare(right.name);
    });

  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    meId: player.id,
    meSessionToken: player.sessionToken,
    players,
    settings: room.settings,
    roundNumber: round?.roundNumber ?? 0,
    totalRounds: room.settings.totalRounds,
    canStart: room.phase === "lobby" && player.id === room.hostId && participants.length >= 2,
    canAdvance:
      player.id === room.hostId &&
      (room.phase === "submission" ||
        room.phase === "voting" ||
        room.phase === "reveal" ||
        room.phase === "scoreboard"),
    winnerIds: room.winnerIds,
    round: round
      ? {
          roundNumber: round.roundNumber,
          totalRounds: room.settings.totalRounds,
          promptKind: round.prompt.kind,
          promptLabel: getPromptLabel(round.prompt.kind),
          promptText: getPromptText(round.prompt),
          category: round.prompt.category,
          difficulty: round.prompt.difficulty,
          deadlineAt: round.phaseDeadlineAt,
          submissionsCount: Object.keys(round.submissions).length,
          playersNeeded: participants.length,
          hasSubmitted: Boolean(round.submissions[playerId]),
          hasSolved,
          canVote,
          hasVoted: Boolean(round.votes[playerId]),
          selectedOptionId: round.votes[playerId]?.optionId,
          yourSubmission: round.submissions[playerId]?.text,
          options: visibleOptions.map((option) => ({
            id: option.id,
            text: option.text,
            locked: room.phase !== "voting",
            voteCount:
              room.phase === "reveal" || room.phase === "scoreboard" || room.phase === "finished"
                ? option.voteCount
                : undefined,
            authorId:
              room.phase === "reveal" || room.phase === "scoreboard" || room.phase === "finished"
                ? option.authorId
                : undefined,
            isCorrect:
              room.phase === "reveal" || room.phase === "scoreboard" || room.phase === "finished"
                ? option.kind === "real"
                : undefined,
          })),
          reveal: round.reveal
            ? {
                correctOptionId: round.reveal.correctOptionId,
                scoreDeltas: round.reveal.scoreDeltas,
              }
            : undefined,
        }
      : null,
  };
}

function createPlayer(name: string, isHost: boolean, now: number): PlayerState {
  return {
    id: crypto.randomUUID(),
    name: normalizeName(name),
    score: 0,
    isHost,
    connected: true,
    sessionToken: crypto.randomUUID(),
    joinedAt: now,
    lastSeenAt: now,
  };
}

function startNextRound(room: RoomSnapshot, promptBanks: PromptBanks, now: number): void {
  const roundNumber = room.currentRoundIndex + 1;
  const prompt = drawPrompt(roundNumber, room, promptBanks);

  room.phase = "submission";
  room.activeRound = {
    roundNumber,
    prompt,
    phaseStartedAt: now,
    phaseDeadlineAt: now + room.settings.submissionSeconds * 1000,
    submissions: {},
    solvedPlayerIds: [],
    submissionScoreDeltas: [],
    options: [],
    votes: {},
  };
  room.usedPromptIds.push(prompt.id);
  touch(room, now);
}

function moveToVoting(room: RoomSnapshot, now: number): void {
  const round = assertRound(room);
  const options = buildOptions(round);

  if (options.length < 2 || getEligibleVoterCount(room, round) < 2) {
    moveToReveal(room, now);
    return;
  }

  room.phase = "voting";
  round.options = shuffle(options);
  round.phaseStartedAt = now;
  round.phaseDeadlineAt = now + room.settings.votingSeconds * 1000;
  touch(room, now);
}

function moveToReveal(room: RoomSnapshot, now: number): void {
  const round = assertRound(room);

  if (round.options.length === 0) {
    round.options = buildOptions(round);
  }

  const scoreDeltas: ScoreDelta[] = [...round.submissionScoreDeltas];
  let correctOptionId = "";

  round.options = round.options.map((option) => {
    const voterIds = Object.values(round.votes)
      .filter((vote) => vote.optionId === option.id)
      .map((vote) => vote.voterId);

    if (option.kind === "real") {
      correctOptionId = option.id;

      for (const voterId of voterIds) {
        room.players[voterId]!.score += SCORE_VALUES.correctGuess;
        scoreDeltas.push({
          playerId: voterId,
          points: SCORE_VALUES.correctGuess,
          reason: "correct_guess",
        });
      }
    } else if (option.authorId) {
      const fooledPoints = voterIds.length * SCORE_VALUES.fooledPlayer;

      if (fooledPoints > 0) {
        room.players[option.authorId]!.score += fooledPoints;
        scoreDeltas.push({
          playerId: option.authorId,
          points: fooledPoints,
          reason: "fooled_player",
        });
      }
    }

    return {
      ...option,
      voteCount: voterIds.length,
      voterIds,
    };
  });

  room.phase = "reveal";
  round.reveal = {
    correctOptionId,
    scoreDeltas,
  };
  round.phaseStartedAt = now;
  round.phaseDeadlineAt = now + room.settings.revealSeconds * 1000;
  touch(room, now);
}

function moveToScoreboard(room: RoomSnapshot, now: number): void {
  const round = assertRound(room);

  room.phase = "scoreboard";
  round.phaseStartedAt = now;
  round.phaseDeadlineAt = null;
  touch(room, now);
}

function finishGame(room: RoomSnapshot, now: number): void {
  const sorted = getParticipants(room).sort((left, right) => right.score - left.score);
  const topScore = sorted[0]?.score ?? 0;

  room.phase = "finished";
  room.winnerIds = sorted.filter((player) => player.score === topScore).map((player) => player.id);

  if (room.activeRound) {
    room.activeRound.phaseStartedAt = now;
    room.activeRound.phaseDeadlineAt = null;
  }

  touch(room, now);
}

function assertRound(room: RoomSnapshot): RoundState {
  if (!room.activeRound) {
    throw new GameError("There is no active round right now.");
  }

  return room.activeRound;
}

function assertPlayer(room: RoomSnapshot, playerId: string): PlayerState {
  const player = room.players[playerId];

  if (!player) {
    throw new GameError("That player is not part of this room.");
  }

  return player;
}

function assertParticipant(room: RoomSnapshot, playerId: string): PlayerState {
  const player = assertPlayer(room, playerId);

  if (player.isHost) {
    throw new GameError("The host moderates the room and does not play in rounds.");
  }

  return player;
}

function assertPhase(room: RoomSnapshot, phase: GamePhase, message: string): void {
  if (room.phase !== phase) {
    throw new GameError(message);
  }
}

function validateSubmission(prompt: PromptEntry, trimmed: string, normalized: string): void {
  if (prompt.kind === "word") {
    if (normalized.length < 8) {
      throw new GameError("Definitions must be at least 8 characters.");
    }

    if (normalized.length > 180) {
      throw new GameError("Definitions must be 180 characters or less.");
    }

    if (normalized.includes(normalizeForCompare(prompt.word))) {
      throw new GameError("Try not to include the actual word in your response.");
    }

    return;
  }

  if (normalized.length < 5) {
    throw new GameError("Bible references must include a book, chapter, and verse.");
  }

  if (!/\b\d+\b/.test(normalized)) {
    throw new GameError("Bible references must include chapter and verse numbers.");
  }

}

function getDuplicateMessage(promptKind: PromptKind): string {
  return promptKind === "word"
    ? "That definition is already in play this round."
    : "That Bible reference is already in play this round.";
}

function normalizeName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");

  if (trimmed.length < 2 || trimmed.length > 24) {
    throw new GameError("Names must be between 2 and 24 characters.");
  }

  return trimmed;
}

function normalizeSubmission(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeReferenceForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bfirst\b/g, "1")
    .replace(/\bsecond\b/g, "2")
    .replace(/\bthird\b/g, "3")
    .replace(/\b1st\b/g, "1")
    .replace(/\b2nd\b/g, "2")
    .replace(/\b3rd\b/g, "3")
    .replace(/\biii\b/g, "3")
    .replace(/\bii\b/g, "2")
    .replace(/\bi\b/g, "1")
    .replace(/\bchapter\b/g, " ")
    .replace(/\bverse\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSubmissionComparisonValue(promptKind: PromptKind, text: string): string {
  return promptKind === "word" ? normalizeForCompare(text) : normalizeReferenceForCompare(text);
}

function touch(room: RoomSnapshot, now: number): void {
  room.updatedAt = now;
}

function getParticipants(room: RoomSnapshot): PlayerState[] {
  return Object.values(room.players).filter((player) => !player.isHost);
}

function getParticipantCount(room: RoomSnapshot): number {
  return getParticipants(room).length;
}

function getEligibleVoterCount(room: RoomSnapshot, round: RoundState): number {
  return getParticipants(room).filter((player) => canPlayerVote(round, player.id)).length;
}

function drawPrompt(roundNumber: number, room: RoomSnapshot, promptBanks: PromptBanks): PromptEntry {
  return getPromptKindForRound(roundNumber) === "word"
    ? drawFromBank(room, promptBanks.words)
    : drawFromBank(room, promptBanks.bibleVerses);
}

function drawFromBank<T extends PromptEntry>(room: RoomSnapshot, prompts: T[]): T {
  const pool = prompts.filter((prompt) => !room.usedPromptIds.includes(prompt.id));
  const source = pool.length > 0 ? pool : prompts;

  if (source.length === 0) {
    throw new GameError("No prompts are available.");
  }

  return source[Math.floor(Math.random() * source.length)]!;
}

function getPromptKindForRound(roundNumber: number): PromptKind {
  return roundNumber % 2 === 1 ? "word" : "bibleVerse";
}

function buildOptions(round: RoundState): RoundOption[] {
  const fakeOptions = Object.values(round.submissions)
    .filter((submission) => !hasSolvedRound(round, submission.playerId))
    .map((submission) => ({
      id: crypto.randomUUID(),
      text: submission.text,
      authorId: submission.playerId,
      kind: "fake" as const,
      voteCount: 0,
      voterIds: [],
    }));

  return [
    ...fakeOptions,
    {
      id: crypto.randomUUID(),
      text: getCorrectAnswerText(round.prompt),
      kind: "real" as const,
      voteCount: 0,
      voterIds: [],
    },
  ];
}

function getCorrectAnswerText(prompt: PromptEntry): string {
  return prompt.kind === "word" ? prompt.definition : prompt.reference;
}

function getPromptLabel(promptKind: PromptKind): string {
  return promptKind === "word" ? "Mystery word" : "Bible verse";
}

function getPromptText(prompt: PromptEntry): string {
  return prompt.kind === "word" ? prompt.word : prompt.verse;
}

function shuffle<T>(values: T[]): T[] {
  const copy = [...values];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex]!, copy[index]!];
  }

  return copy;
}

function canPlayerVote(round: RoundState, playerId: string): boolean {
  return !hasSolvedRound(round, playerId);
}

function hasSolvedRound(round: RoundState, playerId: string): boolean {
  return round.solvedPlayerIds.includes(playerId);
}

function isCorrectSubmission(prompt: PromptEntry, submission: string, normalized: string): boolean {
  if (prompt.kind === "bibleVerse") {
    return normalized === normalizeReferenceForCompare(prompt.reference);
  }

  return isCloseEnoughDefinition(submission, prompt.definition);
}

function isCloseEnoughDefinition(submission: string, definition: string): boolean {
  const normalizedSubmission = normalizeForCompare(submission);
  const normalizedDefinition = normalizeForCompare(definition);

  if (normalizedSubmission === normalizedDefinition) {
    return true;
  }

  const submissionTokens = tokenizeDefinition(normalizedSubmission);
  const definitionTokens = tokenizeDefinition(normalizedDefinition);

  if (submissionTokens.length === 0 || definitionTokens.length === 0) {
    return false;
  }

  const submissionSet = new Set(submissionTokens);
  const definitionSet = new Set(definitionTokens);
  const overlapCount = [...submissionSet].filter((token) => definitionSet.has(token)).length;

  if (overlapCount === 0) {
    return false;
  }

  const precision = overlapCount / submissionSet.size;
  const recall = overlapCount / definitionSet.size;
  const overlapScore = (2 * precision * recall) / (precision + recall);

  return overlapCount >= Math.min(2, definitionSet.size) && overlapScore >= 0.72;
}

function tokenizeDefinition(text: string): string[] {
  return text
    .split(" ")
    .map((token) => stemDefinitionToken(token))
    .filter((token) => token.length > 1 && !DEFINITION_STOP_WORDS.has(token));
}

function stemDefinitionToken(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }

  if (token.length > 4 && token.endsWith("ied")) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.length > 4 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }

  if (token.length > 4 && token.endsWith("es")) {
    return token.slice(0, -2);
  }

  if (token.length > 3 && token.endsWith("s")) {
    return token.slice(0, -1);
  }

  return token;
}

