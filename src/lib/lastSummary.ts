import type { MatchSummaryJson } from "@/types/game";

const KEY = "outbreak_last_summary";

export interface LastSummary {
  roomCode: string;
  roomId: string | null;
  summary: MatchSummaryJson;
  savedAt: number;
}

export function saveLastSummary(entry: Omit<LastSummary, "savedAt">): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...entry, savedAt: Date.now() }));
  } catch {
    /* quota — skip */
  }
}

export function loadLastSummary(): LastSummary | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as LastSummary;
    return v && v.summary ? v : null;
  } catch {
    return null;
  }
}
