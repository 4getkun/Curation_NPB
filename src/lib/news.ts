import newsData from "../data/news.json";

export interface NewsItem {
  title: string;
  summary: string;
  link: string;
  pubDate: string | null;
  source: string;
  sourceId: string;
  teams: string[];
}

export interface NewsData {
  generatedAt: string;
  count: number;
  items: NewsItem[];
}

const data = newsData as NewsData;

export const allNews: NewsItem[] = data.items;
export const newsGeneratedAt: string = data.generatedAt;

export function newsForTeam(teamId: string): NewsItem[] {
  return allNews.filter((item) => item.teams.includes(teamId));
}

export function formatRelativeOrDate(pubDate: string | null): string {
  if (!pubDate) return "";
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

export function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(date);
}
