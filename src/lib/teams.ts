import teamsData from "../data/teams.json";

export interface Team {
  id: string;
  league: "central" | "pacific";
  name: string;
  short: string;
  shortKeywords: string[];
  strongKeywords: string[];
  color: string;
}

export const teams: Team[] = teamsData as Team[];

export const teamsById: Record<string, Team> = Object.fromEntries(
  teams.map((t) => [t.id, t]),
);

export const centralTeams = teams.filter((t) => t.league === "central");
export const pacificTeams = teams.filter((t) => t.league === "pacific");

export function getTeam(id: string): Team | undefined {
  return teamsById[id];
}

// 明るい球団カラー(黄色系など)の上に白文字を乗せると読めなくなるため、
// バッジ・チップの文字色をカラーごとに出し分ける。
const LIGHT_TEAM_COLORS = new Set(["#FFC800", "#E8B900"]);

export function textOnTeamColor(color: string): string {
  return LIGHT_TEAM_COLORS.has(color) ? "#1b263b" : "#ffffff";
}

// ロッテ(#1a1a1a)のようにほぼ黒に近い球団カラーは、ダークモードの背景と
// 同化して見えなくなるため、色ドット・色スクエアにだけ細いリングを足す。
// (チップのように隣接テキストがある要素は視認性が保たれるので対象外)
export function needsContrastRing(color: string): boolean {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.15;
}
