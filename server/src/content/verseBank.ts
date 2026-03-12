import type { BibleVerseEntry, PromptDifficulty } from "../../../shared/dist/index.js";
import verses from "./verses.json" with { type: "json" };

interface VerseSeed {
  id: string;
  verse: string;
  reference: string;
  category: string;
  difficulty: PromptDifficulty;
}

export const verseBank = (verses as VerseSeed[]).map((verse) => ({
  ...verse,
  kind: "bibleVerse" as const,
})) satisfies BibleVerseEntry[];
