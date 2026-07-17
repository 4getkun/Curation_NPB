// scripts/fetch-results.mjs
//
// 各球団の直近の試合結果(日付・対戦相手・スコア・勝敗・球場)を取得し、
// src/data/results.json に書き出すスクリプト。GitHub Actionsから
// fetch-news.mjs と同じタイミングで定期実行される想定。
//
// 【なぜWikipediaから取得しているか】
// データ品質だけで言えばNPB公式サイト(npb.jp)が最良だが、npb.jpは全ページの
// フッターに「掲載の情報、画像、映像等の二次利用および無断転載を固く禁じます」
// と明記しており、自動取得しての再掲載は明確に規約違反になる。Yahoo!スポーツ
// やSPAIA等の主要スポーツサイトの利用規約も同様かそれ以上に厳格(SPAIAは
// 「スクレイピング、クローリング等を禁じます」と名指しで禁止している)。
// 一方、日本語版Wikipediaの各球団の年度別ページ(例:「2026年の阪神タイガース」)
// に掲載されている試合結果表はCC BY-SAライセンスで、再利用が明示的に許可
// されている数少ないデータ源。この経緯は本サイトのRSS再配信機能を日刊スポーツ
// の規約違反で撤去した件と同種の判断であり、「公開されているから自由に使える」
// と思い込まないよう、取得元ごとに規約を確認したうえでこちらを選んでいる。
//
// トレードオフとして、ボランティア編集のため試合終了から反映まで数時間〜1日
// 程度のラグが生じることがある。また表の形式が将来変わる可能性があるため、
// ヘッダー行のテキスト一致で対象の表を判定する(class名やテーブルの並び順には
// 依存しない)防御的な作りにしている。取得に失敗した球団は、既存の
// src/data/results.json の値をそのまま維持する(「結果なし」に戻って表示が
// 不安定になるのを防ぐため)。
//
// MediaWiki API (action=parse) 経由でページのレンダリング済みHTMLを取得し、
// cheerioで table.wikitable のうち試合結果表(ヘッダー行が既知の列名と一致
// するもの)だけをパースする。シーズンの試合結果表は月ごとに分かれている
// (4月表・5月表…)ため、該当する全ての表を走査して連結する。

import * as cheerio from "cheerio";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TEAMS = JSON.parse(
  await readFile(path.join(ROOT, "src/data/teams.json"), "utf-8"),
);

const OUTPUT_PATH = path.join(ROOT, "src/data/results.json");

const RESULTS_PER_TEAM = 10; // 直近何試合分を書き出すか(表示側でさらに絞ってもよい)
const FETCH_TIMEOUT_MS = 20000;

// Wikipedia側の実際のテーブルヘッダーと一致させる(2026年の阪神タイガース
// ページで実際に確認した表記)。この並び・文言が一致する表だけを「試合結果表」
// とみなす。ロースター表・成績表など、ページ内の他のwikitableを誤って
// 拾わないための唯一の手がかりなので、Wikipedia側の見出し変更があれば
// ここも追従が必要。
const GAME_LOG_HEADERS = ["#", "日付", "対戦相手", "スコア", "勝利投手", "敗戦投手", "セーブ", "本塁打", "球場", "勝敗"];

// MediaWikiのAPI利用規約(WP:BOTPOL)に沿い、用途が分かるUser-Agentを付与する。
const USER_AGENT = "CurationNPB-ResultsBot/1.0 (+https://github.com/4getkun/Curation_NPB; static site, polls ~30min)";

function wikipediaPageTitle(team) {
  // 球団の正式名称(teams.jsonのstrongKeywords[0])がそのままページ名になる
  // (例:「阪神タイガース」→ https://ja.wikipedia.org/wiki/2026年の阪神タイガース)
  const year = new Date().getFullYear();
  return `${year}年の${team.strongKeywords[0]}`;
}

function findOpponentTeamId(opponentText) {
  const byShort = TEAMS.find((t) => t.short === opponentText);
  if (byShort) return byShort.id;
  const byShortKeyword = TEAMS.find((t) => t.shortKeywords.includes(opponentText));
  if (byShortKeyword) return byShortKeyword.id;
  return null;
}

/**
 * スコア表記("3-1" 通常形式、「2x-1」のようにサヨナラ勝ち(x)を示す接尾辞が
 * 得点の直後に付く形式、「1-2x」のように相手側に付く形式など)から自チーム・
 * 相手の得点を取り出す。自チームのページに載っている表なので、常に
 * 「自チームの得点-相手の得点」の順で表記されている(実データで確認済み:
 * 例えば「2-0」で勝った試合は通算成績の勝ち数が1増えている)。
 * 数字の直後に付く"x"等の接尾辞・区切り文字周辺の空白を許容するため、
 * 数字と区切り文字の間は\D*(非数字0文字以上)としている。
 */
function parseScore(scoreText) {
  const match = scoreText.match(/^(\d+)\D*-\D*(\d+)/);
  if (!match) return null;
  return { own: Number(match[1]), opponent: Number(match[2]) };
}

function resultFromScore(score) {
  if (!score) return "unknown";
  if (score.own > score.opponent) return "win";
  if (score.own < score.opponent) return "loss";
  return "draw";
}

/**
 * 試合結果表の1行(<tr>)をパースする。以下の行は結果に含めない(nullを返す):
 *  - 列数が10でない行(中止試合の行は colspan で列が減るため6列などになる)
 *  - 1列目(試合番号)が数字でない行(未消化=未来の試合はここが空欄になる)
 */
function parseGameRow(cells) {
  if (cells.length !== 10) return null;
  const gameNumber = cells[0];
  if (!/^\d+$/.test(gameNumber)) return null;

  const scoreText = cells[3];
  const score = parseScore(scoreText);

  return {
    gameNumber: Number(gameNumber),
    date: cells[1],
    opponentTeamId: findOpponentTeamId(cells[2]),
    opponentText: cells[2],
    score: scoreText,
    result: resultFromScore(score),
    venue: cells[8],
    record: cells[9],
  };
}

async function fetchTeamResults(team) {
  const title = wikipediaPageTitle(team);
  const apiUrl =
    `https://ja.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}` +
    `&format=json&prop=text&formatversion=2`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (data.error) throw new Error(data.error.info || "MediaWiki APIエラー");
    if (!data.parse?.text) throw new Error("ページ本文が取得できませんでした");

    const $ = cheerio.load(data.parse.text);

    const rows = [];
    $("table.wikitable").each((_, table) => {
      const headerCells = $(table)
        .find("tr")
        .first()
        .find("th")
        .map((__, th) => $(th).text().trim())
        .get();
      const isGameLogTable = GAME_LOG_HEADERS.every((h) => headerCells.includes(h));
      if (!isGameLogTable) return;

      $(table)
        .find("tr")
        .each((__, tr) => {
          const cells = $(tr)
            .find("td")
            .map((___, td) => $(td).text().trim())
            .get();
          const parsed = parseGameRow(cells);
          if (parsed) rows.push(parsed);
        });
    });

    rows.sort((a, b) => a.gameNumber - b.gameNumber);
    const recent = rows.slice(-RESULTS_PER_TEAM).reverse(); // 新しい試合が先頭

    console.log(`  取得成功: ${team.short} (通算${rows.length}試合中、直近${recent.length}件)`);
    return { teamId: team.id, games: recent };
  } catch (err) {
    console.warn(`  取得失敗: ${team.short} — ${err.message}`);
    return { teamId: team.id, games: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadExistingResults() {
  try {
    const raw = await readFile(OUTPUT_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.teams ?? {};
  } catch {
    return {};
  }
}

async function main() {
  console.log(`NPB試合結果を取得します (${TEAMS.length}球団, Wikipedia)`);

  const results = await Promise.all(TEAMS.map((team) => fetchTeamResults(team)));
  const existingTeams = await loadExistingResults();

  // 取得に失敗した球団は、既存の結果をそのまま維持する(毎回の一時的な失敗で
  // 表示が消えたり不安定になったりしないようにするため)。
  const teams = { ...existingTeams };
  let updatedCount = 0;
  for (const r of results) {
    if (r.games !== null) {
      teams[r.teamId] = r.games;
      updatedCount++;
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    teams,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(
    `完了: ${Object.keys(teams).length}球団分をsrc/data/results.jsonに書き出しました` +
      `(今回更新 ${updatedCount}球団 / 取得失敗により前回値を維持 ${TEAMS.length - updatedCount}球団)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
