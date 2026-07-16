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

// 「広告ゼロ」を掲げているサイトなので、タイアップ・PR記事(スポンサード
// コンテンツ)は取得元フィードに含まれていても除外する。
const AD_MARKERS = [
  "【PR】",
  "[PR]",
  "(PR)",
  "（PR）",
  "ＰＲ】",
  "PR)",
  "PR】",
];

function isAdContent(title) {
  const upper = title.toUpperCase();
  return AD_MARKERS.some((marker) => upper.includes(marker.toUpperCase()));
}

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; NPBCurationBot/1.0; +https://github.com/4getkun/Curation_NPB)",
  },
});

/** keywords それぞれがテキスト中に出現する [開始位置, 終了位置) を全て返す */
function findAllSpans(scanText, keywords) {
  const spans = [];
  for (const kw of keywords) {
    let searchFrom = 0;
    while (searchFrom <= scanText.length) {
      const idx = scanText.indexOf(kw, searchFrom);
      if (idx === -1) break;
      spans.push([idx, idx + kw.length]);
      searchFrom = idx + kw.length;
    }
  }
  return spans;
}

/**
 * キーワード群それぞれについて、テキスト中の「主役としての言及」の位置を返す。
 * 除外する言及が2種類ある。
 *  1.「◯◯戦」(=◯◯を相手にした試合、という意味の言い回し)としてしか
 *    出てこないキーワードは、記事の主役ではなく対戦相手を指しているとみなす。
 *  2. excludeSpansの範囲内に入っている言及(例:「千葉ロッテマリーンズ」という
 *    長い一致の内部にたまたま含まれる「ロッテ」)は、実体としては1つの言及を
 *    重複カウントしているだけなので除外する。
 * それ以外の言及が一つでもあれば、その最初の位置を返す。
 */
function findSubjectIndex(scanText, keywords, excludeSpans = []) {
  let subjectIndex = -1;
  for (const kw of keywords) {
    let searchFrom = 0;
    while (searchFrom <= scanText.length) {
      const idx = scanText.indexOf(kw, searchFrom);
      if (idx === -1) break;
      searchFrom = idx + kw.length;

      const withinExcluded = excludeSpans.some(([start, end]) => idx >= start && idx < end);
      if (withinExcluded) continue;

      const isOpponentMention = scanText.slice(idx + kw.length, idx + kw.length + 1) === "戦";
      if (!isOpponentMention && (subjectIndex === -1 || idx < subjectIndex)) {
        subjectIndex = idx;
      }
    }
  }
  return subjectIndex;
}

/**
 * 指定したテキストの中から該当する球団を、文中での出現位置が早い順に返す。
 * strongKeywords（正式名称・愛称。他分野と混同しにくい）は単独でヒット扱い。
 * shortKeywords（「巨人」「中日」「楽天」など、企業名・地名としても使われる
 * 曖昧な略称）は、bracketHit（見出し冒頭の【○○】表記）か野球文脈の裏付けが
 * ある場合のみヒット扱いにする。
 * どちらのキーワード種別でも、「◯◯戦」形の対戦相手としての言及しかない
 * 場合はヒットさせない(findSubjectIndex参照)。また、shortKeywordsの一致が
 * strongKeywordsの一致の内部に埋もれている場合(「千葉ロッテマリーンズ」の
 * 中の「ロッテ」等)も、二重カウントを避けるため除外する。
 */
function collectTeamHits(scanText, bracketText, hasBaseballContext) {
  const hits = [];

  for (const team of TEAMS) {
    const strongSpans = findAllSpans(scanText, team.strongKeywords);
    const strongIndex = findSubjectIndex(scanText, team.strongKeywords);
    if (strongIndex !== -1) {
      hits.push({ id: team.id, index: strongIndex });
      continue;
    }

    const shortKw = team.shortKeywords.find((kw) => scanText.includes(kw));
    if (!shortKw) continue;

    const bracketHit = team.shortKeywords.some((kw) => bracketText.includes(kw));
    if (bracketHit || hasBaseballContext) {
      const shortIndex = findSubjectIndex(scanText, team.shortKeywords, strongSpans);
      if (shortIndex !== -1) {
        hits.push({ id: team.id, index: shortIndex });
      }
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return hits.map((h) => h.id);
}

/**
 * 球団判定のメイン処理。3段階のフォールバックで判定する。
 *
 * 試合結果系の記事は、本文(summary)側に必ず対戦相手の球団名が出てくる
 * (例:「阪神タイガース戦に先発出場」)。タイトル+本文をまとめて1つの
 * テキストとして判定すると、記事の主役ではない「対戦相手」まで一緒に
 * 球団タグとして付いてしまい、その球団のページに無関係な記事が
 * 紛れ込む原因になっていた。
 *
 * 1. タイトルだけで判定(通常ルール: 曖昧な略称は野球文脈が必要)
 * 2. 1で何もヒットしない場合、タイトルだけで再判定(略称の野球文脈チェックを
 *    外す)。タイトルは本文と違って簡潔なので、多少緩めても「巨人の4番…」の
 *    ような自然な見出しを拾える
 * 3. 2でもヒットしない場合(見出しに球団名が一切ない)だけ、本文も含めて
 *    通常ルールで判定する
 */
function matchTeamsForItem(title, summary, feedScoped) {
  const bracketMatch = title.match(/^[【\[]([^】\]]+)[】\]]/);
  const bracketText = bracketMatch ? bracketMatch[1] : "";

  const titleHits = collectTeamHits(title, bracketText, feedScoped || matchesGeneralNpb(title));
  if (titleHits.length > 0) return titleHits;

  const titleHitsRelaxed = collectTeamHits(title, bracketText, true);
  if (titleHitsRelaxed.length > 0) return titleHitsRelaxed;

  const combined = `${title} ${summary}`;
  const hasBaseballContext = feedScoped || matchesGeneralNpb(combined);
  return collectTeamHits(combined, bracketText, hasBaseballContext);
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

      // 「広告ゼロ」が差別化点なので、PR・タイアップ記事は取得元フィードに
      // 含まれていても掲載しない
      if (isAdContent(title)) continue;

      const teamHits = matchTeamsForItem(title, summary, feed.scoped);
      const generalHit = matchesGeneralNpb(haystack);

      // scoped=true のフィード(専門メディアのNPBカテゴリ)は無条件で採用。
      // scoped=false (総合スポーツフィード)は「球団ヒットあり」「一般NPB
      // キーワードあり」のいずれかがある記事だけを採用し、他競技・他分野の
      // 記事(例:「楽天」→通販、「中日」→新聞社 等)を除外する。
      if (!feed.scoped) {
        const isRelevant = teamHits.length > 0 || generalHit;
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
