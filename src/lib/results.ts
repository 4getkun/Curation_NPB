import resultsData from "../data/results.json";

export interface GameResult {
  gameNumber: number;
  date: string;
  opponentTeamId: string | null;
  opponentText: string;
  score: string;
  result: "win" | "loss" | "draw" | "unknown";
  venue: string;
  record: string;
}

export interface ResultsData {
  generatedAt: string | null;
  teams: Record<string, GameResult[]>;
}

const data = resultsData as ResultsData;

export const resultsGeneratedAt: string | null = data.generatedAt;

/** 指定した球団の直近の試合結果を、新しい順で返す(scripts/fetch-results.mjs 側で既に新しい順に並んでいる)。 */
export function resultsForTeam(teamId: string): GameResult[] {
  return data.teams[teamId] ?? [];
}
