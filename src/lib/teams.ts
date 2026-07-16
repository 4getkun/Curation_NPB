import teamsData from "../data/teams.json";

export interface Team {
  id: string;
  league: "central" | "pacific";
  name: string;
  short: string;
  shortKeywords: string[];
  strongKeywords: string[];
  color: string;
  colorDark: string;
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
