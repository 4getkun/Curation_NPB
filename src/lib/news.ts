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

// 「18分前」「3時間前」のような相対表記。ビルド時点(=直近の自動更新時点)を
// 基準に計算するため、サイトを見るタイミングによっては多少ずれる場合がある
// (最大でも自動更新の間隔=30分程度)。
export function formatRelative(pubDate: string | null, now: Date): string {
  if (!pubDate) return "";
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}日前`;

  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

const generatedAtDate = new Date(newsGeneratedAt);
const relativeBase = Number.isNaN(generatedAtDate.getTime())
  ? new Date()
  : generatedAtDate;

/** ニュース取得時刻(=ほぼビルド時刻)を基準にした相対表記のショートハンド */
export function formatRelativeShort(pubDate: string | null): string {
  return formatRelative(pubDate, relativeBase);
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
