// このサイト自体が発行するRSSフィード。ユーザーが自分の好きなRSSリーダーで
// 「広告ゼロで整理済みのNPBニュース」を購読できるようにするためのエンドポイント。
// news.json をもとにビルド時に静的なXMLとして出力する(サーバー不要)。
import type { APIRoute } from "astro";
import { allNews } from "../lib/news";

export const prerender = true;

function escapeXml(str: string): string {
  return (str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL ?? "/";
  const origin = site ? site.origin ?? site.toString().replace(/\/$/, "") : "https://4getkun.github.io";
  const siteUrl = `${origin}${base}`.replace(/\/+$/, "");

  const items = allNews.slice(0, 100);
  const itemsXml = items
    .map((item) => {
      const pubDate = item.pubDate && !Number.isNaN(new Date(item.pubDate).getTime())
        ? new Date(item.pubDate).toUTCString()
        : null;
      return `
    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="true">${escapeXml(item.link)}</guid>${pubDate ? `\n      <pubDate>${pubDate}</pubDate>` : ""}
      <description>${escapeXml(item.summary)}</description>
      <source>${escapeXml(item.source)}</source>
    </item>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Curation NPB</title>
    <link>${siteUrl}/</link>
    <description>広告ゼロで読める、NPB(日本プロ野球)12球団の最新ニュース・まとめキュレーションサイト</description>
    <language>ja</language>
    <generator>Curation NPB</generator>
    <atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml" />${itemsXml}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=1800",
    },
  });
};
