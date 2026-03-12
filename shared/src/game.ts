export const GAME_PHASES = [
  "lobby",
  "submission",
  "voting",
  "reveal",
  "scoreboard",
  "finished",
] as const;

export type GamePhase = (typeof GAME_PHASES)[number];
export type PromptDifficulty = "easy" | "medium" | "hard";
export type PromptKind = "word" | "bibleVerse";

export interface WordEntry {
  kind: "word";
  id: string;
  word: string;
  definition: string;
  category: string;
  difficulty: PromptDifficulty;
}

export interface BibleVerseEntry {
  kind: "bibleVerse";
  id: string;
  verse: string;
  reference: string;
  category: string;
  difficulty: PromptDifficulty;
}

export type PromptEntry = WordEntry | BibleVerseEntry;

export interface GameSettings {
  totalRounds: number;
  maxPlayers: number;
  submissionSeconds: number;
  votingSeconds: number;
  revealSeconds: number;
  scoreboardSeconds: number;
}

export interface PlayerState {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  connected: boolean;
  sessionToken: string;
  joinedAt: number;
  lastSeenAt: number;
}

export interface Submission {
  playerId: string;
  text: string;
  createdAt: number;
}

export interface Vote {
  voterId: string;
  optionId: string;
  createdAt: number;
}

export interface RoundOption {
  id: string;
  text: string;
  authorId?: string;
  kind: "real" | "fake";
  voteCount: number;
  voterIds: string[];
}

export interface ScoreDelta {
  playerId: string;
  points: number;
  reason: "correct_guess" | "fooled_player";
}

export interface RevealSummary {
  correctOptionId: string;
  scoreDeltas: ScoreDelta[];
}

export interface RoundState {
  roundNumber: number;
  prompt: PromptEntry;
  phaseStartedAt: number;
  phaseDeadlineAt: number | null;
  submissions: Record<string, Submission>;
  solvedPlayerIds: string[];
  submissionScoreDeltas: ScoreDelta[];
  options: RoundOption[];
  votes: Record<string, Vote>;
  reveal?: RevealSummary;
}

export interface RoomSnapshot {
  code: string;
  phase: GamePhase;
  hostId: string;
  createdAt: number;
  updatedAt: number;
  currentRoundIndex: number;
  settings: GameSettings;
  players: Record<string, PlayerState>;
  activeRound: RoundState | null;
  usedPromptIds: string[];
  winnerIds: string[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  connected: boolean;
}

export interface RoundView {
  roundNumber: number;
  totalRounds: number;
  promptKind: PromptKind;
  promptLabel: string;
  promptText: string;
  category: string;
  difficulty: PromptDifficulty;
  deadlineAt: number | null;
  submissionsCount: number;
  playersNeeded: number;
  hasSubmitted: boolean;
  hasSolved: boolean;
  canVote: boolean;
  hasVoted: boolean;
  selectedOptionId?: string;
  yourSubmission?: string;
  options: Array<{
    id: string;
    text: string;
    locked: boolean;
    voteCount?: number;
    authorId?: string;
    isCorrect?: boolean;
  }>;
  reveal?: {
    correctOptionId: string;
    scoreDeltas: ScoreDelta[];
  };
}

export interface RoomView {
  code: string;
  phase: GamePhase;
  hostId: string;
  meId: string;
  meSessionToken: string;
  players: PublicPlayer[];
  settings: GameSettings;
  roundNumber: number;
  totalRounds: number;
  canStart: boolean;
  canAdvance: boolean;
  winnerIds: string[];
  round: RoundView | null;
}

export interface JoinPayload {
  code: string;
  name: string;
}

export interface ReconnectPayload {
  code: string;
  sessionToken: string;
}

export interface CreateRoomPayload {
  name: string;
}

export interface SubmitPayload {
  text: string;
}

export interface VotePayload {
  optionId: string;
}

export interface RoomJoinedEvent {
  room: RoomView;
}

export interface RoomErrorEvent {
  message: string;
}

export const DEFAULT_SETTINGS: GameSettings = {
  totalRounds: 20,
  maxPlayers: 8,
  submissionSeconds: 90,
  votingSeconds: 30,
  revealSeconds: 10,
  scoreboardSeconds: 8,
};

export const SCORE_VALUES = {
  correctGuess: 2,
  fooledPlayer: 1,
} as const;
