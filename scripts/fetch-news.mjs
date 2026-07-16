// scripts/fetch-news.mjs
//
// NPBニュース自動収集スクリプト。
// GitHub Actions (.github/workflows/update-news.yml) から定期実行され、
// 各RSSフィードを取得 → 12球団に分類 → 重複排除 → 新しい順に並べて
// src/data/news.json に書き出す。
//
// このリポジトリは静的サイト(GitHub Pages)なのでサーバーは動かせない。
// 代わりに「ビルド時点の最新ニュース」をこのJSONに固定し、Astroが
// 静的HTMLとして出力する。定期的にこのスクリプト→ビルド→デプロイを
// 繰り返すことで疑似リアルタイム更新を実現する。
//
// 収集した記事は「タイトル・要約・リンク・出典」のみを保持し、本文は
// 一切コピーしない（著作権に配慮し、参照元サイトへ送客する設計）。

import Parser from "rss-parser";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TEAMS = JSON.parse(
  await readFile(path.join(ROOT, "src/data/teams.json"), "utf-8"),
);
const FEEDS = JSON.parse(
  await readFile(path.join(ROOT, "src/data/feeds.json"), "utf-8"),
);

const OUTPUT_PATH = path.join(ROOT, "src/data/news.json");
const MAX_ITEMS = 400;
const MAX_PER_FEED = 60;
const FETCH_TIMEOUT_MS = 15000;

// 記事がNPB関連かどうかの判定に使う一般キーワード
// (球団名にマッチしなくても、これらを含めばNPB全般ニュースとして採用)
const GENERAL_NPB_KEYWORDS = [
  "プロ野球",
  "NPB",
  "セ・リーグ",
  "パ・リーグ",
  "セリーグ",
  "パリーグ",
  "12球団",
  "ドラフト会議",
  "交流戦",
  "オールスターゲーム",
  "クライマックスシリーズ",
  "CS",
  "日本シリーズ",
];

// NPB(プロ野球)を対象とするサイトなので、同じ「野球」でも対象外のものは
// 球団名にヒットしていても記事ごと除外する（例:「横浜」高校野球の記事が
// DeNAベイスターズ関連と誤判定されるのを防ぐ）。
const OUT_OF_SCOPE_KEYWORDS = [
  "高校野球",
  "甲子園",
  "大学野球",
  "独立リーグ",
  "社会人野球",
  "リトルシニア",
  "少年野球",
];

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; NPBCurationBot/1.0; +https://github.com/4getkun/Curation_NPB)",
  },
});

/**
 * タイトル+説明文から該当する球団を判定する。
 * strongKeywords（正式名称・愛称。他分野と混同しにくい）は単独でヒット扱い。
 * shortKeywords（「巨人」「中日」「楽天」など、企業名・地名としても使われる
 * 曖昧な略称）は、bracketHit（見出し冒頭の【○○】表記）か野球文脈の裏付けが
 * ある場合のみヒット扱いにする。
 */
function matchTeamsDetailed(title, haystack) {
  const bracketMatch = title.match(/^[【\[]([^】\]]+)[】\]]/);
  const bracketText = bracketMatch ? bracketMatch[1] : "";
  const hasBaseballContext =
    haystack.includes("プロ野球") || matchesGeneralNpb(haystack);

  const strong = [];
  const weak = [];

  for (const team of TEAMS) {
    const strongHit = team.strongKeywords.some((kw) => haystack.includes(kw));
    if (strongHit) {
      strong.push(team.id);
      continue;
    }
    const shortHit = team.shortKeywords.some((kw) => haystack.includes(kw));
    if (!shortHit) continue;

    const bracketHit = team.shortKeywords.some((kw) => bracketText.includes(kw));
    if (bracketHit || hasBaseballContext) {
      weak.push(team.id);
    }
  }

  return { strong, weak, all: [...new Set([...strong, ...weak])] };
}

function matchesGeneralNpb(text) {
  return GENERAL_NPB_KEYWORDS.some((kw) => text.includes(kw));
}

function stripHtml(input) {
  if (!input) return "";
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8211;/g, "–")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max = 120) {
  if (text.length <= max) return text;
  return text.slice(0, max).trim() + "…";
}

async function fetchFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    const items = (parsed.items ?? []).slice(0, MAX_PER_FEED);
    const results = [];

    for (const item of items) {
      const title = stripHtml(item.title ?? "");
      const summary = truncate(
        stripHtml(item.contentSnippet ?? item.content ?? item.summary ?? ""),
      );
      const link = item.link ?? "";
      if (!title || !link) continue;

      const haystack = `${title} ${summary}`;

      // 高校野球など対象外カテゴリの記事は、球団名を含んでいても除外する
      if (OUT_OF_SCOPE_KEYWORDS.some((kw) => haystack.includes(kw))) continue;

      const { strong, weak, all: teamHits } = matchTeamsDetailed(title, haystack);
      const generalHit = matchesGeneralNpb(haystack);

      // scoped=true のフィード(専門メディアのNPBカテゴリ)は無条件で採用。
      // scoped=false (総合スポーツフィード)は「強キーワード一致」「弱キーワード
      // ＋野球文脈」「一般NPBキーワード」のいずれかがある記事だけを採用し、
      // 他競技・他分野の記事(例:「楽天」→通販、「中日」→新聞社 等)を除外する。
      if (!feed.scoped) {
        const isRelevant = strong.length > 0 || weak.length > 0 || generalHit;
        if (!isRelevant) continue;
      }

      const pubDate = item.isoDate ?? item.pubDate ?? null;

      results.push({
        title,
        summary,
        link,
        pubDate,
        source: feed.name,
        sourceId: feed.id,
        teams: teamHits,
      });
    }

    console.log(`  取得成功: ${feed.name} (${results.length}件)`);
    return results;
  } catch (err) {
    console.warn(`  取得失敗: ${feed.name} — ${err.message}`);
    return [];
  }
}

async function main() {
  console.log(`NPBニュース収集を開始します (${FEEDS.length}フィード)`);

  const allResults = (
    await Promise.all(FEEDS.map((feed) => fetchFeed(feed)))
  ).flat();

  // リンクで重複排除（同じ記事が複数フィードに出ることがある）
  const seen = new Set();
  const deduped = [];
  for (const item of allResults) {
    const key = item.link.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  // 日付降順ソート（日付不明は末尾へ）
  deduped.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });

  const trimmed = deduped.slice(0, MAX_ITEMS);

  const output = {
    generatedAt: new Date().toISOString(),
    count: trimmed.length,
    items: trimmed,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(`完了: ${trimmed.length}件を src/data/news.json に書き出しました`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
