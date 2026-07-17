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
const TOPICS = JSON.parse(
  await readFile(path.join(ROOT, "src/data/topics.json"), "utf-8"),
);

const OUTPUT_PATH = path.join(ROOT, "src/data/news.json");
// RSSは「今取れる最新N件」しか返さない(=フィード側に過去ログは残っていない)。
// そのため実行のたびに取得結果を過去のnews.jsonへ積み増し(マージ)し、
// 直近RETENTION_DAYS日分をローリングウィンドウとして保持する。
// GitHub Actionsが30分おきにこのスクリプト→コミットを繰り返すことで、
// 運用開始からおよそ1ヶ月かけて手元のアーカイブが積み上がっていく。
const RETENTION_DAYS = 30;
const MAX_ITEMS = 4000; // 保険用の上限(想定件数を大きく超えないよう安全弁として設定)
const MAX_PER_FEED = 60;
const FETCH_TIMEOUT_MS = 30000;
const FEED_RETRY_COUNT = 1; // タイムアウト等の一時的な失敗に備え、1回だけ再試行する
const FEED_RETRY_DELAY_MS = 2000;

// npb-official-freefielder(freefielder.jp)は、手元の検証環境からは
// 常に瞬時に取得できる一方、GitHub Actionsのランナー(Azureのデータセンター
// IP)からは30秒+1回のリトライでも100%タイムアウトすることを実際のログで
// 確認した。応答が単に遅いのではなく、サイト側がクラウド/データセンター
// 帯のIPを弾いている(あるいは意図的に応答を遅延させ続ける)可能性が高い。
// タイムアウト値をどれだけ伸ばしても解決しない類の問題と判断し、
// feeds.json側で "viaProxy": true が付いたフィードだけ、公開の
// CORSプロキシ(allorigins.win)を経由して取得する(プロキシ側のIPからの
// アクセスになるため、この種のIP帯ブロックを回避できる)。
// 外部サービス依存が増える代償はあるが、失敗時も他フィード同様
// catchで空配列を返すだけなので、プロキシがダウンしていてもサイト全体には
// 影響しない。
const PROXY_URL_TEMPLATE = "https://api.allorigins.win/raw?url=";

function resolveFeedUrl(feed) {
  if (!feed.viaProxy) return feed.url;
  return PROXY_URL_TEMPLATE + encodeURIComponent(feed.url);
}

// 「同一ニュースの重複統合」機能のしきい値。複数メディアが同じ出来事を
// 報じた記事を1件にまとめて表示するための判定パラメータ。
// 精度(=誤って別の出来事をまとめてしまわないこと)を優先し、かなり保守的な
// 値にしている。球団タグが1つも重ならない記事同士や、日付不明な記事同士は
// そもそも統合対象にしない。
const DEDUPE_TITLE_SIMILARITY = 0.6; // タイトルの2文字Jaccard類似度のしきい値
const DEDUPE_WINDOW_MS = 4 * 60 * 60 * 1000; // 公開時刻の差がこの範囲内のみ統合対象

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
//
// 「超高校級」「球児」は「高校野球」という文字列そのものは含まないが、
// プロ野球選手にはまず使われない高校野球特有の言い回しなので、単独の
// キーワードとして追加している(例:「横浜の超高校級2投手から3安打」の
// ような、実況・結果記事の見出しは「高校野球」を含まないことが多い)。
const OUT_OF_SCOPE_KEYWORDS = [
  "高校野球",
  "甲子園",
  "大学野球",
  "独立リーグ",
  "社会人野球",
  "リトルシニア",
  "少年野球",
  "超高校級",
  "球児",
];

// 球団の略称は「巨人」「楽天」「ソフトバンク」「ロッテ」「西武」のように、
// 企業名・地名・一般名詞としても使われる曖昧な単語が多い。始球式やイベント
// 来場などをきっかけに、野球そのものとはほぼ無関係な芸能・エンタメ系の記事
// (アイドルのファンミーティング等)が球団名にヒットして紛れ込むことがある
// ため、そうした記事は野球関連キーワードの有無に関わらず除外する。
const ENTERTAINMENT_NOISE_KEYWORDS = [
  "始球式",
  "ファンミーティング",
  "舞台挨拶",
  "来日公演",
  "主演",
  "ドラマ化",
  "映画化",
  "K-POP",
  "Kポップ",
  "韓流",
  "アイドル",
  "AKB48",
  "乃木坂46",
  "欅坂46",
  "日向坂46",
  "櫻坂46",
  "NMB48",
  "HKT48",
  "SKE48",
];

function isEntertainmentNoise(haystack) {
  return ENTERTAINMENT_NOISE_KEYWORDS.some((kw) => haystack.includes(kw));
}

// このサイトはNPB(プロ野球)専門なので、総合スポーツフィード経由で紛れ込む
// 他競技の記事(ゴルフ・サッカー・相撲等)は、球団名にヒットしていても除外
// する。「中日」のように、球団の略称が新聞・メディア名(中日スポーツ)とも
// 一致する場合、Yahoo!ニュース配信の見出し末尾に必ず付く「(中日スポーツ)」
// のような出典表記だけを根拠に、無関係な他競技記事へ球団タグが付いてしまう
// ことがある(matchTeamsForItem呼び出し側でこの出典表記を除去してはいるが、
// 二重の安全策としてここでも競技名そのもので除外する)。
const OTHER_SPORTS_KEYWORDS = [
  "女子ゴルフ",
  "男子ゴルフ",
  "ゴルフ",
  "サッカー",
  "Jリーグ",
  "テニス",
  "バレーボール",
  "バスケットボール",
  "Bリーグ",
  "ラグビー",
  "卓球",
  "大相撲",
  "競馬",
  "ボクシング",
  "フィギュアスケート",
  "eスポーツ",
];

function isOtherSportsContent(haystack) {
  return OTHER_SPORTS_KEYWORDS.some((kw) => haystack.includes(kw));
}

// Yahoo!ニュース経由のRSSは、見出し末尾に配信元メディア名を
// 「(◯◯スポーツ)」のように括弧書きで必ず付与してくる。この出典表記は
// 表示上は有用だが、分類用のテキストにそのまま含めると、メディア名が
// たまたま球団の略称と一致するケース(例:「中日スポーツ」と中日ドラゴンズ
// の略称「中日」)で、記事内容とは無関係に球団タグが付いてしまう。
// 分類・除外判定用のテキストからはこの末尾の括弧書きを取り除く
// (保存・表示用のtitleそのものは変更しない)。
function stripTrailingSourceSuffix(title) {
  return title.replace(/[（(][^（）()]*[）)]\s*$/, "").trim();
}

// このサイトはNPB(日本プロ野球)専門なので、MLB(メジャーリーグ)の記事は
// 対象外として除外する(MLB専門の姉妹サイト「Curation MLB」を別途運営)。
// 総合スポーツ系フィード(BASEBALL KING等)はMLBニュースも配信しており、
// 「オールスターゲーム」のような一般野球キーワードにヒットして紛れ込む
// ことがあるため、MLB球団名・MLB特有の用語を検知したら無条件で除外する。
//
// 「ジャイアンツ」(巨人と衝突)「タイガース」(阪神と衝突)は、球団名を
// 都市名付きの表記にすることでNPB球団との誤爆を避けている。
const MLB_KEYWORDS = [
  "メジャーリーグ",
  "米大リーグ",
  "大リーグ",
  "MLB",
  "ナ・リーグ",
  "ア・リーグ",
  "ワールドシリーズ",
  // MLB30球団(NPBの愛称と衝突しないもののみ、都市名なしの愛称で列挙)
  "ヤンキース",
  "レッドソックス",
  "ブルージェイズ",
  "レイズ",
  "オリオールズ",
  "ガーディアンズ",
  "ホワイトソックス",
  "ロイヤルズ",
  "ツインズ",
  "アストロズ",
  "エンゼルス",
  "アスレチックス",
  "マリナーズ",
  "レンジャーズ",
  "ブレーブス",
  "マーリンズ",
  "メッツ",
  "フィリーズ",
  "ナショナルズ",
  "カブス",
  "レッズ",
  "ブリュワーズ",
  "パイレーツ",
  "カージナルス",
  "ダイヤモンドバックス",
  "ロッキーズ",
  "ドジャース",
  "パドレス",
  // NPB球団の愛称と衝突する2球団は都市名付きで判定
  "デトロイト・タイガース",
  "サンフランシスコ・ジャイアンツ",
  "SFジャイアンツ",
];

function isMlbContent(haystack) {
  return MLB_KEYWORDS.some((kw) => haystack.includes(kw));
}

// stage2(タイトルのみ・野球文脈チェックなしの緩和判定)で、shortKeywords
// (曖昧な略称)を無条件でヒット扱いにしてしまうと、「横浜スタートで
// アジア6都市」のような地名としての「横浜」まで拾ってしまう。GENERAL_NPB_
// KEYWORDSほど大掛かりでなくても、見出しに実際の試合展開・選手動向を示す
// 語彙が含まれていれば、それを「緩和条件下での野球文脈」とみなす。
const BASEBALL_ACTION_KEYWORDS = [
  "先発",
  "登板",
  "救援",
  "中継ぎ",
  "抑え",
  "代打",
  "代走",
  "スタメン",
  "先発出場",
  "本塁打",
  "満塁弾",
  "二塁打",
  "三塁打",
  "安打",
  "猛打賞",
  "打点",
  "打率",
  "盗塁",
  "四球",
  "死球",
  "三振",
  "勝利投手",
  "敗戦投手",
  "セーブ",
  "ホールド",
  "防御率",
  "完投",
  "完封",
  "被弾",
  "監督",
  "コーチ",
  "采配",
  "移籍",
  "トレード",
  "契約更改",
  "年俸",
  "ドラフト",
  "戦力外",
  "自由契約",
  "FA宣言",
  "優勝",
  "連覇",
  "首位",
  "貯金",
  "借金",
  "マジック",
  "登録抹消",
  "一軍昇格",
  "二軍降格",
  "故障",
  "離脱",
  "手術",
  "号アーチ",
  "号本塁打",
  "逆転",
  "サヨナラ",
];

function matchesBaseballAction(text) {
  return BASEBALL_ACTION_KEYWORDS.some((kw) => text.includes(kw));
}

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

// 「元プロ野球選手が実業家に転身した」的な経歴紹介・インタビュー記事は、
// 記事本文に強いキーワード(「読売ジャイアンツ」等)が出典表記として
// 出てくることが多く、現役選手のNPBニュースと誤って球団タグ付けされて
// しまう。ただし「引退」「転身」単体は、実際には「先発から中継ぎに転身」
// のような現役選手の現役続行ニュースでも普通に使われる語彙なので、単独の
// キーワードとして除外リストに入れるのはリスクが高い(=他記事を巻き込む)。
//
// そのため、ここだけは「元選手であることを示す語彙」と「経営者になった
// ことを示す語彙」の両方が同時に含まれている場合のみ除外する、という
// AND条件にしている。ビジネス系の実業家インタビュー記事はこの組み合わせが
// ほぼ確実に揃う一方、実際の試合展開・移籍ニュースの記事にこの組み合わせが
// 偶然揃うことはまず無いため、他の除外リストより誤爆リスクを抑えられる。
const FORMER_PLAYER_SIGNALS = [
  "元プロ",
  "プロ野球から転身",
  "プロ野球選手から転身",
  "現役引退後",
  "引退後は",
];

const EXECUTIVE_CAREER_SIGNALS = [
  "代表取締役",
  "経営者",
  "社長に",
  "起業",
  "会社を設立",
];

function isRetiredPlayerBusinessProfile(haystack) {
  const hasFormerPlayerSignal = FORMER_PLAYER_SIGNALS.some((kw) => haystack.includes(kw));
  if (!hasFormerPlayerSignal) return false;
  return EXECUTIVE_CAREER_SIGNALS.some((kw) => haystack.includes(kw));
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

// 「阪神―中日」「阪神-中日」「阪神vs中日」のような対戦カード表記で使われる
// 区切り文字。長音記号(ー)も見出しでは簡易的なダッシュとして使われることが
// 多いため含めている。
const MATCHUP_SEPARATORS = ["―", "—", "–", "－", "ー", "-", "対", "vs", "VS", "ｖｓ"];

// 全球団の正式名称・略称をまとめたもの(対戦カード表記の判定で、区切り文字の
// 反対側が「別の球団名」かどうかを調べるために使う)。TEAMSはこのファイルの
// 先頭で読み込み済みのモジュールスコープ変数。
const ALL_TEAM_KEYWORDS = TEAMS.flatMap((t) => [...t.strongKeywords, ...t.shortKeywords]);

/**
 * scanText中のidx位置にある(長さkwLengthの)球団名言及が、「TeamA・区切り文字・
 * TeamB」形式の対戦カード表記(例:「阪神―中日」「阪神vs中日」)の一部として
 * 登場しているかどうかを判定する。
 *
 * 試合結果・試合前情報系の記事では、見出しの冒頭やリード文に必ず
 * 「◇セ・リーグ 阪神―中日（日付、球場）」のような対戦カード表記が入る。
 * これは「◯◯戦」と同じく対戦相手としての言及であり、この表記の中にしか
 * 出てこない球団は記事の主役ではない(=対戦相手として本拠地球場になって
 * いるだけ、等)とみなして除外する。
 */
// 「巨人3―1ヤクルト（2026年7月16日 神宮）」のように、対戦カード表記の
// 区切り文字の両側に得点(1〜3桁)が挟まる試合結果見出しのパターン。
// 区切り文字が球団名に直接隣接しないため、MATCHUP_SEPARATORSの単純な
// 前後一致だけでは検出できず、実際にこの形式の記事が対戦相手側のタブにも
// 誤って表示される不具合が確認されたため追加した。
const SCORE_GAP_AFTER_RE = /^\d{1,3}\s*[―—–－ー-]\s*\d{1,3}/;
const SCORE_GAP_BEFORE_RE = /\d{1,3}\s*[―—–－ー-]\s*\d{1,3}$/;

function isMatchupCardMention(scanText, idx, kwLength) {
  for (const sep of MATCHUP_SEPARATORS) {
    const beforeSepStart = idx - sep.length;
    if (beforeSepStart >= 0 && scanText.slice(beforeSepStart, idx) === sep) {
      const beforeText = scanText.slice(0, beforeSepStart);
      if (ALL_TEAM_KEYWORDS.some((kw) => beforeText.endsWith(kw))) return true;
    }

    const afterSepStart = idx + kwLength;
    if (scanText.slice(afterSepStart, afterSepStart + sep.length) === sep) {
      const afterText = scanText.slice(afterSepStart + sep.length);
      if (ALL_TEAM_KEYWORDS.some((kw) => afterText.startsWith(kw))) return true;
    }
  }

  // 得点入りの対戦カード表記(例:「巨人3―1ヤクルト」「巨人 3-1 ヤクルト」)
  const afterText = scanText.slice(idx + kwLength);
  const scoreAfter = afterText.match(SCORE_GAP_AFTER_RE);
  if (scoreAfter && ALL_TEAM_KEYWORDS.some((kw) => afterText.slice(scoreAfter[0].length).startsWith(kw))) {
    return true;
  }

  const beforeText = scanText.slice(0, idx);
  const scoreBefore = beforeText.match(SCORE_GAP_BEFORE_RE);
  if (scoreBefore && ALL_TEAM_KEYWORDS.some((kw) => beforeText.slice(0, beforeText.length - scoreBefore[0].length).endsWith(kw))) {
    return true;
  }

  return false;
}

/**
 * キーワード群それぞれについて、テキスト中の「主役としての言及」の位置を返す。
 * 除外する言及が3種類ある。
 *  1.「◯◯戦」(=◯◯を相手にした試合、という意味の言い回し)としてしか
 *    出てこないキーワードは、記事の主役ではなく対戦相手を指しているとみなす。
 *  2.「阪神―中日」のような対戦カード表記としてしか出てこないキーワードも、
 *    1と同様に対戦相手(または単なる本拠地表記)としての言及とみなす
 *    (isMatchupCardMention参照)。
 *  3. excludeSpansの範囲内に入っている言及(例:「千葉ロッテマリーンズ」という
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
      const isMatchupMention = isMatchupCardMention(scanText, idx, kw.length);
      if (!isOpponentMention && !isMatchupMention && (subjectIndex === -1 || idx < subjectIndex)) {
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

// 「◯◯登録、△△抹消／16日公示」のような見出しは、NPBの日々の出場選手登録
// (支配下・一軍/二軍の入れ替え)をまとめて報じる定型記事で、1本の記事の中に
// セ・パ全12球団分の異動が列挙されていることが多い。この形式は見出しの
// 「／◯日公示」というほぼ固定の言い回しと、本文の「登録と抹消は以下の通り」
// 「＜登録＞」「＜抹消＞」という定型見出しでほぼ確実に識別できる。
// 全球団名義でヒットしてしまうと、実質「その球団固有のニュース」ではない
// 事務的な一覧記事が全12球団のタブに同時に表示されてしまうため、この形式に
// 該当する記事は球団タグを一切付けず(=総合ニュース一覧のみに表示)、
// 話題タグ(topics.json の "roster")の分類だけで扱う。
const ROSTER_TRANSACTION_TITLE_RE = /／\s*\d{1,2}日公示/;
const ROSTER_TRANSACTION_BODY_MARKERS = [
  "登録と抹消は以下の通り",
  "＜登録＞",
  "＜抹消＞",
];

function isRosterTransactionRoundup(title, haystack) {
  if (ROSTER_TRANSACTION_TITLE_RE.test(title)) return true;
  return ROSTER_TRANSACTION_BODY_MARKERS.some((marker) => haystack.includes(marker));
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
 *    「プロ野球等の一般キーワード」から「先発・本塁打・移籍等の実際の試合
 *    展開/選手動向を示す語彙」に緩める)。タイトルは本文と違って簡潔なので、
 *    多少緩めても「巨人の4番…5号アーチ」のような自然な見出しを拾える一方、
 *    「横浜スタートでアジア6都市」のような地名としての言及までは拾わない
 * 3. 2でもヒットしない場合(見出しに球団名が一切ない)だけ、本文も含めて
 *    通常ルールで判定する
 *
 * ただし全球団分の異動をまとめて報じる登録抹消の定型記事(下記
 * isRosterTransactionRoundup参照)は、この判定に入る前に無条件で
 * 「球団タグなし」を返す。
 */
function matchTeamsForItem(title, summary, feedScoped) {
  if (isRosterTransactionRoundup(title, `${title} ${summary}`)) return [];

  const bracketMatch = title.match(/^[【\[]([^】\]]+)[】\]]/);
  const bracketText = bracketMatch ? bracketMatch[1] : "";

  const titleHits = collectTeamHits(title, bracketText, feedScoped || matchesGeneralNpb(title));
  if (titleHits.length > 0) return titleHits;

  const titleHitsRelaxed = collectTeamHits(title, bracketText, matchesBaseballAction(title));
  if (titleHitsRelaxed.length > 0) return titleHitsRelaxed;

  const combined = `${title} ${summary}`;
  const hasBaseballContext = feedScoped || matchesGeneralNpb(combined);
  return collectTeamHits(combined, bracketText, hasBaseballContext);
}

function matchesGeneralNpb(text) {
  return GENERAL_NPB_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * 記事のタイトル+要約から、話題タグ(移籍・故障・契約更改など)を判定する。
 * 球団判定のような「主役/対戦相手」の区別は不要な単純なキーワード一致で良い
 * (話題の判定に「対戦相手」という概念がないため)。1記事に複数の話題タグが
 * つくこともある(例:「故障離脱していた選手がFA宣言」)。
 */
function classifyTopics(haystack) {
  const hits = [];
  for (const topic of TOPICS) {
    if (topic.keywords.some((kw) => haystack.includes(kw))) {
      hits.push(topic.id);
    }
  }
  return hits;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// parser.parseURL単体を切り出し、タイムアウト等の一時的な失敗時に
// FEED_RETRY_COUNT回まで再試行する。「タイムアウト」は接続自体は
// できているが応答が遅いだけのケースが多く、1回の再試行で拾えることが
// 多いため(サイト側が明確にブロックしている場合は再試行しても無駄だが、
// 再試行のコスト自体は小さいので、区別せず一律で試みる)。
async function parseWithRetry(feed) {
  const url = resolveFeedUrl(feed);
  let lastErr;
  for (let attempt = 0; attempt <= FEED_RETRY_COUNT; attempt++) {
    try {
      return await parser.parseURL(url);
    } catch (err) {
      lastErr = err;
      if (attempt < FEED_RETRY_COUNT) {
        console.warn(`  取得リトライ: ${feed.name} — ${err.message}`);
        await sleep(FEED_RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

async function fetchFeed(feed) {
  try {
    const parsed = await parseWithRetry(feed);
    const items = (parsed.items ?? []).slice(0, MAX_PER_FEED);
    const results = [];

    for (const item of items) {
      const title = stripHtml(item.title ?? "");
      const summary = truncate(
        stripHtml(item.contentSnippet ?? item.content ?? item.summary ?? ""),
      );
      const link = item.link ?? "";
      if (!title || !link) continue;

      // 分類・除外判定は「(中日スポーツ)」等の出典表記を取り除いたテキストで
      // 行う(表示用のtitle自体はそのまま保持する)。理由はstripTrailingSourceSuffix
      // のコメント参照。
      const titleForMatching = stripTrailingSourceSuffix(title);
      const haystack = `${titleForMatching} ${summary}`;

      // 高校野球など対象外カテゴリの記事は、球団名を含んでいても除外する
      if (OUT_OF_SCOPE_KEYWORDS.some((kw) => haystack.includes(kw))) continue;

      // ゴルフ・サッカー等、野球ではない他競技の記事は除外する
      if (isOtherSportsContent(haystack)) continue;

      // 始球式のアイドル来場・ファンミーティング等、球団名にヒットしても
      // 実質的には野球と無関係な芸能・エンタメ記事は除外する
      if (isEntertainmentNoise(haystack)) continue;

      // MLB(メジャーリーグ)の記事はこのサイトの対象外なので除外する
      // (総合スポーツフィードが「オールスターゲーム」等の一般野球キーワード
      // 経由で拾ってしまうことがあるため、球団名一致の有無に関わらず除外)
      if (isMlbContent(haystack)) continue;

      // 「広告ゼロ」が差別化点なので、PR・タイアップ記事は取得元フィードに
      // 含まれていても掲載しない
      if (isAdContent(title)) continue;

      // 元選手の実業家転身インタビュー等、試合・チームの動向とは無関係な
      // 経歴紹介記事は除外する(isRetiredPlayerBusinessProfile参照)
      if (isRetiredPlayerBusinessProfile(haystack)) continue;

      const teamHits = matchTeamsForItem(titleForMatching, summary, feed.scoped);
      const generalHit = matchesGeneralNpb(haystack);
      const topicHits = classifyTopics(haystack);

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
        topics: topicHits,
        sources: [{ name: feed.name, sourceId: feed.id, link }],
      });
    }

    console.log(`  取得成功: ${feed.name} (${results.length}件)`);
    return results;
  } catch (err) {
    console.warn(`  取得失敗: ${feed.name} — ${err.message}`);
    return [];
  }
}

/** 既存の src/data/news.json を読み込む。無い/壊れている場合は空配列扱い */
async function loadExistingItems() {
  try {
    const raw = await readFile(OUTPUT_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

function linkKey(link) {
  return link.split("?")[0];
}

// ---- 同一ニュースの重複統合(マルチソース化) ----------------------------
//
// 複数の野球専門メディアが同じ出来事(移籍発表・故障離脱など)を報じた場合、
// タイトルはメディアごとに言い回しが異なるためlinkKeyでは重複と判定できない。
// ここでは「タイトルの2文字(バイグラム)Jaccard類似度」「公開時刻の近さ」
// 「球団タグの重なり」の3条件がすべて揃った記事だけを同一ニュースとみなし、
// 1件にまとめて複数の出典リンク(sources)を持たせる。
// 条件を厳しめにしているのは、無関係な2つのニュースを誤って1件に統合して
// しまう方が、統合し損ねるより悪いため(見せかけの1件に情報が隠れてしまう)。

function normalizeTitleForCompare(title) {
  return title
    // 見出し冒頭の【西武】のような球団プレフィックスは類似度判定のノイズになるため除去
    .replace(/^[【\[][^】\]]*[】\]]/, "")
    // 全角英数記号を半角へ寄せる
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]/g, "")
    .toLowerCase();
}

function titleBigrams(text) {
  const set = new Set();
  if (text.length < 2) {
    if (text.length === 1) set.add(text);
    return set;
  }
  for (let i = 0; i < text.length - 1; i++) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function itemSources(item) {
  if (Array.isArray(item.sources) && item.sources.length > 0) return item.sources;
  return [{ name: item.source, sourceId: item.sourceId, link: item.link }];
}

/** Union-Find(素集合データ構造)。同一ニュース判定されたインデックス同士を連結する */
function createUnionFind(size) {
  const parent = Array.from({ length: size }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  return { find, union };
}

function mergeDuplicateGroup(groupItems) {
  if (groupItems.length === 1) {
    const only = groupItems[0];
    return { ...only, sources: itemSources(only) };
  }

  // 一番要約が長い(=情報量が多い)記事を代表記事として採用する
  const primary = groupItems.reduce((best, current) =>
    (current.summary?.length ?? 0) > (best.summary?.length ?? 0) ? current : best,
  );

  // 表示用の公開時刻は「一番早く報じられた時刻」を採用する
  const dated = groupItems.filter(
    (it) => it.pubDate && !Number.isNaN(new Date(it.pubDate).getTime()),
  );
  const earliestPubDate =
    dated.length > 0
      ? dated.reduce((a, b) => (new Date(a.pubDate) < new Date(b.pubDate) ? a : b)).pubDate
      : (groupItems[0].pubDate ?? null);

  const seenSourceKey = new Set();
  const mergedSources = [];
  for (const it of groupItems) {
    for (const src of itemSources(it)) {
      const key = `${src.sourceId}|${src.link}`;
      if (seenSourceKey.has(key)) continue;
      seenSourceKey.add(key);
      mergedSources.push(src);
    }
  }
  // 代表記事の出典を先頭に並べ替える
  mergedSources.sort((a, b) => {
    const aIsPrimary = a.sourceId === primary.sourceId && a.link === primary.link;
    const bIsPrimary = b.sourceId === primary.sourceId && b.link === primary.link;
    return aIsPrimary === bIsPrimary ? 0 : aIsPrimary ? -1 : 1;
  });

  const primaryTeams = primary.teams ?? [];
  const otherTeams = groupItems.flatMap((it) => it.teams ?? []).filter((t) => !primaryTeams.includes(t));
  const teams = [...primaryTeams, ...new Set(otherTeams)];
  const topics = [...new Set(groupItems.flatMap((it) => it.topics ?? []))];

  return {
    title: primary.title,
    summary: primary.summary,
    link: primary.link,
    pubDate: earliestPubDate,
    source: primary.source,
    sourceId: primary.sourceId,
    teams,
    topics,
    sources: mergedSources,
  };
}

function dedupeSameEventItems(items) {
  // 日付不明の記事は判定材料が不足するため統合対象から外す(そのまま残す)
  const comparable = [];
  const untouched = [];
  items.forEach((item, i) => {
    if (item.pubDate && !Number.isNaN(new Date(item.pubDate).getTime()) && (item.teams?.length ?? 0) > 0) {
      comparable.push(i);
    } else {
      untouched.push(item);
    }
  });

  const uf = createUnionFind(items.length);
  const normalized = items.map((it) => normalizeTitleForCompare(it.title));
  const bigramCache = normalized.map((t) => titleBigrams(t));

  // 同じ日(JST)ごとにバケット化して比較回数を抑える
  const dayBuckets = new Map();
  for (const i of comparable) {
    const dayKey = new Date(items[i].pubDate).toISOString().slice(0, 10);
    if (!dayBuckets.has(dayKey)) dayBuckets.set(dayKey, []);
    dayBuckets.get(dayKey).push(i);
  }

  for (const bucket of dayBuckets.values()) {
    for (let a = 0; a < bucket.length; a++) {
      for (let b = a + 1; b < bucket.length; b++) {
        const i = bucket[a];
        const j = bucket[b];
        const timeDiff = Math.abs(
          new Date(items[i].pubDate).getTime() - new Date(items[j].pubDate).getTime(),
        );
        if (timeDiff > DEDUPE_WINDOW_MS) continue;

        const teamsOverlap = items[i].teams.some((t) => items[j].teams.includes(t));
        if (!teamsOverlap) continue;

        const similarity = jaccardSimilarity(bigramCache[i], bigramCache[j]);
        if (similarity >= DEDUPE_TITLE_SIMILARITY) {
          uf.union(i, j);
        }
      }
    }
  }

  const groups = new Map();
  for (const i of comparable) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(items[i]);
  }

  const mergedResults = [...groups.values()].map(mergeDuplicateGroup);
  return [...mergedResults, ...untouched];
}

async function main() {
  console.log(`NPBニュース収集を開始します (${FEEDS.length}フィード)`);

  const allResults = (
    await Promise.all(FEEDS.map((feed) => fetchFeed(feed)))
  ).flat();

  const existingItemsRaw = await loadExistingItems();

  // 除外ルール(AD_MARKERS・OUT_OF_SCOPE_KEYWORDS・ENTERTAINMENT_NOISE_KEYWORDS・
  // MLB_KEYWORDS)は運用中に追加・調整されることがある。ルール変更後もRSSの
  // 取得範囲から外れてしまった古い記事は再取得されず、最大30日間アーカイブに
  // 残り続けてしまうため、既存アーカイブに対しても同じ除外ルールを毎回かけ直し、
  // 該当する記事はその場で取り除く。
  //
  // また、球団分類ロジック(matchTeamsForItem)自体が改善された場合
  // (例:「阪神―中日」のような対戦カード表記を対戦相手として除外するルールの
  // 追加)も、既存アーカイブの記事を毎回再分類することで、過去に誤って
  // 対戦相手の球団タグが付いた記事を遡って修正できるようにしている。
  const existingItems = existingItemsRaw
    .filter((item) => {
      const titleForMatching = stripTrailingSourceSuffix(item.title);
      const haystack = `${titleForMatching} ${item.summary}`;
      if (OUT_OF_SCOPE_KEYWORDS.some((kw) => haystack.includes(kw))) return false;
      if (isOtherSportsContent(haystack)) return false;
      if (isEntertainmentNoise(haystack)) return false;
      if (isMlbContent(haystack)) return false;
      if (isAdContent(item.title)) return false;
      if (isRetiredPlayerBusinessProfile(haystack)) return false;
      return true;
    })
    .map((item) => {
      const feedScoped = FEEDS.find((f) => f.id === item.sourceId)?.scoped ?? false;
      const titleForMatching = stripTrailingSourceSuffix(item.title);
      const teams = matchTeamsForItem(titleForMatching, item.summary, feedScoped);
      return { ...item, teams };
    });
  const removedByRuleUpdate = existingItemsRaw.length - existingItems.length;
  console.log(
    `  既存アーカイブ: ${existingItemsRaw.length}件` +
      (removedByRuleUpdate > 0 ? ` (除外ルール更新により${removedByRuleUpdate}件を除去)` : ""),
  );

  // 新規取得分を優先しつつ、既存アーカイブとリンクで重複排除してマージする。
  // (同じ記事を新しい取得結果で上書きすることで、分類ロジック改善時に
  //  まだRSSの取得範囲内にある記事は再分類の恩恵を受けられる)
  const merged = new Map();
  for (const item of existingItems) {
    merged.set(linkKey(item.link), item);
  }
  for (const item of allResults) {
    merged.set(linkKey(item.link), item);
  }

  // 直近RETENTION_DAYS日分だけを残すローリングウィンドウ。日付不明の記事は
  // (稀なケースなので)念のため残しておき、MAX_ITEMSの上限で吸収する。
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const withinRetention = [...merged.values()].filter((item) => {
    if (!item.pubDate) return true;
    const t = new Date(item.pubDate).getTime();
    return Number.isNaN(t) || t >= cutoff;
  });

  // 複数メディアが同じ出来事を報じている記事を1件に統合する(マルチソース化)
  const deduped = dedupeSameEventItems(withinRetention);
  const mergedAwayCount = withinRetention.length - deduped.length;

  // 日付降順ソート（日付不明は末尾へ）
  deduped.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });

  const trimmed = deduped.slice(0, MAX_ITEMS);
  const prunedByAge = merged.size - withinRetention.length;
  const prunedByCap = deduped.length - trimmed.length;

  const output = {
    generatedAt: new Date().toISOString(),
    count: trimmed.length,
    items: trimmed,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(
    `完了: ${trimmed.length}件を src/data/news.json に書き出しました` +
      `(今回の新規取得 ${allResults.length}件 / ${RETENTION_DAYS}日超で除外 ${prunedByAge}件` +
      `${mergedAwayCount > 0 ? ` / 同一ニュース統合で ${mergedAwayCount}件を集約` : ""}` +
      `${prunedByCap > 0 ? ` / 上限超過で除外 ${prunedByCap}件` : ""})`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
