import type { PromptDifficulty, WordEntry } from "../../../shared/dist/index.js";
import words from "./words.json" with { type: "json" };

interface WordSeed {
  id: string;
  word: string;
  definition: string;
  category: string;
  difficulty: PromptDifficulty;
}

export const wordBank = (words as WordSeed[]).map((word) => ({
  ...word,
  kind: "word" as const,
})) satisfies WordEntry[];
