# Curation NPB

広告ゼロで読める、NPB(日本プロ野球)12球団のニュース・まとめキュレーションサイトです。
Astro + Tailwind CSS で構築し、GitHub Pages の無料枠だけで完結するように作っています。

- 公開URL(予定): https://4getkun.github.io/Curation_NPB/
- リポジトリ: https://github.com/4getkun/Curation_NPB

## 特徴

- **広告・トラッキングなし** — バナー広告、アフィリエイト、アクセス解析は一切なし
- **NPB12球団のニュースを自動収集** — 野球専門メディアのRSSを定期取得し、球団別に自動振り分け
- **直近30日分をローリング蓄積** — RSSは「今取れる最新分」しか返さないため、実行のたびに過去データへ積み増し、30日を超えた分だけ捨てるアーカイブ方式
- **GitHub Actionsで自動更新＋自動デプロイ** — 30分ごとにニュースを取得し、そのままビルド・公開まで自動実行
- **記事本文はコピーしない** — 見出し・要約・リンクのみを掲載し、詳細は配信元サイトに送客(著作権に配慮)
- **サイト内検索** — タイトル・要約・球団名からニュースをクライアントサイドで検索
- **マイ球団(お気に入り)** — 応援球団を選ぶと、トップページにその球団のニュースと直近の試合結果だけを表示(端末内保存のみ)
- **話題から探す(トピックタグ)** — 「移籍」「故障」「契約更改」など、球団の枠を超えた話題別の横断閲覧
- **同一ニュースの統合表示** — 複数メディアが同じ出来事を報じている場合、1件にまとめて出典を併記
- **PWA対応** — ホーム画面への追加・オフライン時の簡易閲覧に対応

## 使用技術

| 用途 | 技術 |
| --- | --- |
| サイト生成 | [Astro](https://astro.build/) 7 (静的サイト出力) |
| スタイリング | [Tailwind CSS](https://tailwindcss.com/) v4 |
| ニュース取得 | Node.js + [rss-parser](https://www.npmjs.com/package/rss-parser) |
| 試合結果取得 | Node.js + [cheerio](https://www.npmjs.com/package/cheerio)(WikipediaのHTMLをパース) |
| ホスティング | GitHub Pages (無料枠) |
| 自動更新・デプロイ | GitHub Actions (無料枠 / スケジュール実行) |

## セットアップ手順(GitHubへの公開まで)

### 1. このプロジェクトをリポジトリにpush

このリポジトリはデフォルトブランチを `master` として運用しています(`main` ではありません。
`.github/workflows/deploy.yml` のトリガーも `master` になっています)。

```bash
cd npb-curation
git init   # 既にgit initされている場合は不要
git add .
git commit -m "Initial commit: Curation NPB site"
git branch -M master
git remote add origin https://github.com/4getkun/Curation_NPB.git
git push -u origin master
```

### 2. GitHub PagesをActions経由で公開する設定にする

1. リポジトリの **Settings → Pages** を開く
2. "Build and deployment" の **Source** を **GitHub Actions** に変更する

### 3. Actionsに書き込み権限を与える(ニュース自動コミットに必要)

1. リポジトリの **Settings → Actions → General** を開く
2. "Workflow permissions" を **Read and write permissions** に変更して保存

### 4. github-pages環境でmasterからのデプロイを許可する

GitHub PagesをActions経由で有効化すると `github-pages` という環境(Environment)が自動作成されるが、
ここに「特定ブランチからのデプロイしか許可しない」という保護ルールが付いていることがある。
未設定のまま `master` にpushすると、ビルドは成功してもデプロイ側で
`Branch "master" is not allowed to deploy to github-pages due to environment protection rules`
というエラーになりデプロイが拒否される。

1. リポジトリの **Settings → Environments → github-pages** を開く
2. **Deployment branches and tags** の設定を確認し、`master` が許可されていなければ追加する
   (「No restriction」にするか、`master` を明示的に許可ブランチとして追加する)

### 5. ワークフローを実行する

- 何もしなくても `master` にpushした時点で `.github/workflows/deploy.yml` が自動実行されます
- 手動で今すぐ実行したい場合は **Actions** タブ → "Build and deploy to GitHub Pages" → **Run workflow**
- 以降は30分おきに自動でニュースを取得し直し、ビルド・再デプロイされます

数分待つと `https://4getkun.github.io/Curation_NPB/` でサイトが確認できます。

## ローカルでの開発

```bash
npm install
npm run dev        # http://localhost:4321/Curation_NPB/ で確認
npm run fetch-news    # RSSを取得して src/data/news.json を更新
npm run fetch-results   # Wikipediaから試合結果を取得して src/data/results.json を更新
npm run build       # dist/ に静的ファイルを生成
npm run preview      # ビルド結果をローカルで確認
```

## ディレクトリ構成

```
src/
  data/
    teams.json    球団マスタ(12球団の名称・カラー・判定キーワード)
    feeds.json    ニュース取得元のRSSフィード一覧
    topics.json    話題タグのマスタ(ラベル・判定キーワード)
    news.json     自動生成されるニュースデータ(fetch-newsで更新)
    results.json    自動生成される試合結果データ(fetch-resultsで更新)
  lib/         データ読み込み・整形用のユーティリティ(news.ts, results.ts, teams.ts, topics.ts, url.ts)
  components/     Header, Footer, NewsRow, FeaturedNews, TeamLinkRow, TeamChipLink,
             TopicLinkRow, TopicChipLink など
  layouts/       共通レイアウト(Base.astro)
  pages/
    index.astro         トップページ(マイ球団セクション・話題から探すを含む)
    news/index.astro     ニュース一覧(球団フィルター付き)
    team/index.astro      球団別ニュースのランディングページ
    team/[team].astro     球団別ページ(12球団分を自動生成)
    topic/index.astro     話題タグのランディングページ
    topic/[topic].astro    話題別ページ(話題タグ分を自動生成)
    search/index.astro     サイト内検索ページ
    data/news-index.json.ts  検索・マイ球団機能向けの軽量JSONエンドポイント
    data/results-index.json.ts マイ球団の試合結果機能向けの軽量JSONエンドポイント
    about/index.astro     このサイトについて
scripts/
  fetch-news.mjs     RSS取得→球団/話題分類→重複統合→news.json書き出しスクリプト
  fetch-results.mjs    Wikipedia取得→球団別に整形→results.json書き出しスクリプト
  generate-icons.py    PWAアイコン生成スクリプト(開発時に手動実行するツール)
public/
  manifest.webmanifest  PWA用マニフェスト
  sw.js          Service Worker(オフライン対応)
  offline.html      オフライン時のフォールバックページ
  icons/         PWAアイコン(192px/512px)
.github/workflows/
  deploy.yml       ニュース・試合結果更新→ビルド→GitHub Pagesデプロイを行うワークフロー
```

## ニュース取得元・分類ロジックをカスタマイズする

- `src/data/feeds.json` にRSSフィードを追加・削除できます
  - `"scoped": true` … そのフィード自体がNPB専門(カテゴリ絞り込み済み)。無条件で採用
  - `"scoped": false` … 総合スポーツ系など。球団名 or 一般NPBキーワードに一致した記事のみ採用
- `src/data/teams.json` の `strongKeywords`(曖昧さのない正式名称)・`shortKeywords`(略称。文脈判定つきで使用)を調整すると、記事の球団振り分け精度を調整できます
- `scripts/fetch-news.mjs` の `OUT_OF_SCOPE_KEYWORDS` で、高校野球など対象外にしたい記事のキーワードを追加できます(「超高校級」「球児」のように、「高校野球」という文字列自体は含まないが高校野球特有の言い回しであるものも含みます)。独立リーグ関連は「独立リーグ」という総称だけでなく、「アイランドリーグ」「BCリーグ」のような各リーグの固有名詞も個別に追加しています(総称でしか判定しないと、「四国アイランドリーグ」のジュニア世代の記事などを取りこぼすため)
- `scripts/fetch-news.mjs` の `OTHER_SPORTS_KEYWORDS` で、球団名にヒットしても対象外にしたい他競技の記事のキーワードを追加できます。「競馬」は単語自体が本文に出てこない競馬記事(レース結果・調教情報のみの記事)もあり、さらに競走馬の名前に球団の愛称がそのまま使われることがある(例:「リトルジャイアンツ」という馬名が「ジャイアンツ」＝巨人と誤判定される)ため、`JRA`・`新馬`・`栗東`・`美浦`のような競馬専門用語も追加し、「競馬」を含まない記事も確実に除外できるようにしています。同様にJリーグクラブの正式名称にも球団のshortKeywordsと同じ地名を含むもの(「サンフレッチェ広島」と広島東洋カープの「広島」、「横浜F・マリノス」とDeNAベイスターズの「横浜」)があり、見出しの「移籍」等に釣られて誤って球団タブに表示される事例が確認されたため、`サンフレッチェ`・`マリノス`のようなクラブの固有名詞も個別に追加しています
- `scripts/fetch-news.mjs` の `AD_MARKERS` で、PR・タイアップ記事を除外するための見出しマーカー(`【PR】`等)を追加・調整できます(広告ゼロ方針のため、該当記事は取得時点で除外しています)
- `scripts/fetch-news.mjs` の `ENTERTAINMENT_NOISE_KEYWORDS` で、球団名にヒットしても野球そのものとは無関係な芸能・エンタメ系の記事(始球式イベントに来場したアイドルのファンミーティング記事など)を除外できます
- `scripts/fetch-news.mjs` の `MLB_KEYWORDS` で、MLB(メジャーリーグ)関連の記事を除外しています。本サイトはNPB専門サイトのため、MLB球団名・「メジャーリーグ」等のキーワードを含む記事は球団名一致の有無に関わらず対象外にしています(MLB専門の姉妹サイト「[Curation MLB](https://github.com/4getkun/Curation_MLB)」を別途運営)。「タイガース」(阪神と衝突)「ジャイアンツ」(巨人と衝突)のようにNPB球団の愛称と重複するMLB球団名は、都市名付きの表記(「デトロイト・タイガース」等)にして誤爆を避けています
- `scripts/fetch-news.mjs` の `isRetiredPlayerBusinessProfile`(`FORMER_PLAYER_SIGNALS` × `EXECUTIVE_CAREER_SIGNALS`)で、元プロ野球選手が実業家に転身した経緯を紹介するインタビュー記事を除外しています。「元選手であることを示す語彙」と「経営者になったことを示す語彙」が両方そろった場合だけ除外するAND条件にしており、「先発から中継ぎに転身」のような現役選手の通常ニュースまで巻き込まないようにしています
- `scripts/fetch-news.mjs` の `isRosterTransactionRoundup`(`ROSTER_TRANSACTION_TITLE_RE` / `ROSTER_TRANSACTION_BODY_MARKERS`)で、「◯◯登録、△△抹消／16日公示」のようなセ・パ全12球団分の出場選手登録・抹消をまとめて報じる定型記事を検出し、この形式に該当する記事は球団タグを一切付けません(=全球団のタブに同時掲載されるのを防ぎ、総合ニュース一覧・話題タグ「登録・抹消」でのみ扱います)
- `scripts/fetch-news.mjs` の `isSchedulePreviewRoundup`(`SCHEDULE_PREVIEW_TITLE_RE` / `SCHEDULE_PREVIEW_BODY_MARKERS`)で、「【きょうのプロ野球】◯月◯日の対戦カード・試合開始時間・予告先発投手は？」のようなその日の全カードをまとめて報じる定型記事を検出し、`isRosterTransactionRoundup`と同様に球団タグを一切付けません(全球団のタブに同時掲載されず、総合ニュース一覧に表示されます)

これらの除外ルールは、既存アーカイブ(`src/data/news.json`)に対しても実行のたびに再適用されるため、ルールを追加すれば次回実行時に該当記事が自動的に取り除かれます。

球団判定は「見出し(タイトル)を優先し、本文はタイトルに球団名が一つもない場合だけ補助的に見る」方式になっています。
これは、試合結果記事の本文には必ず対戦相手の球団名が出てくる(例:「阪神タイガース戦に先発出場」)ため、本文まで
均等に見てしまうと対戦相手まで一緒にタグ付けされてしまう問題を避けるためです。「◯◯戦」という言い回しでの言及、
「阪神―中日（2026年7月16日 バンテリンドーム）」のような対戦カード表記(`MATCHUP_SEPARATORS`で判定)、および
「巨人3―1ヤクルト（2026年7月16日 神宮）」のように区切り文字の両側に得点が挟まる試合結果見出し(`SCORE_GAP_AFTER_RE`
/ `SCORE_GAP_BEFORE_RE`で判定)での言及は、いずれも対戦相手としての言及とみなして除外する処理が入っています
(`isMatchupCardMention`)。これらは、見出しに主役の球団名しかなくても、本文冒頭の対戦カード表記経由で相手球団まで
一緒にタグ付けされてしまう問題への対策です。この球団分類ロジックの改善も、既存アーカイブに対して実行のたびに
再適用され、過去に誤ってタグ付けされた記事を遡って修正します。また、「巨人」「楽天」「ソフトバンク」のように球団の
略称が企業名・地名としても広く使われる曖昧な単語である点を踏まえ、見出しのみでの緩い判定(stage2)では
`BASEBALL_ACTION_KEYWORDS`(先発・本塁打・移籍など実際の試合展開/選手動向を示す語彙)が見出しに含まれている
場合だけヒット扱いにし、「横浜スタートでアジア6都市」のような地名としての言及だけを拾ってしまわないようにしています。
分類の精度に関わる部分なので、キーワードを追加する際は
`node scripts/fetch-news.mjs` を実行したあと `src/data/news.json` の中身を見て、意図通りに球団が振り分けられているか
確認することをおすすめします。

## ニュースのアーカイブ(直近30日分の蓄積)について

RSSフィードは「その時点で配信元が公開している最新N件」しか返さない仕組みで、フィード側に過去ログは残っていません。
そのため `scripts/fetch-news.mjs` は実行のたびに次のように動作します。

1. 直前にコミットされている `src/data/news.json`(=これまでに蓄積した記事)を読み込む
2. 今回RSSから新しく取得した記事とリンクでマージする(同じ記事は新しい取得結果で上書き)
3. `RETENTION_DAYS`(既定30日)より古い記事は間引く
4. 念のための安全弁として `MAX_ITEMS`(既定4000件)を超えた分も間引く
5. 結果を `src/data/news.json` に書き戻す(GitHub Actionsがこれをコミット)

**注意点**: この仕組みは「これから運用開始した時点から」少しずつ記事が積み上がっていく方式です。RSS自体に
過去1ヶ月分のログが残っているわけではないため、公開した瞬間にいきなり1ヶ月分のニュースが揃うわけではありません。
30分おきの自動更新を繰り返すことで、だいたい1ヶ月ほど運用すると直近30日分のアーカイブが揃った状態になります。
保持期間を変えたい場合は `scripts/fetch-news.mjs` 冒頭の `RETENTION_DAYS` を書き換えてください。

## 追加機能について

参考サイト(プロ野球Freak)には無い、便利機能をいくつか追加しています。いずれもサーバーを必要とせず、静的サイトのまま実現しています。

### サイト内検索

`/search/` ページで、タイトル・要約・球団名からニュースを検索できます。ビルド時に `src/pages/data/news-index.json.ts` が
`/data/news-index.json` という軽量なJSONファイルを静的出力し、検索ページがブラウザ上でこれを読み込んでクライアントサイドの
部分一致検索を行っています(サーバーには何も送信されません)。

### マイ球団(お気に入り球団)

ヘッダー右上の「★ マイ球団」から応援球団を選ぶと、選択内容がブラウザの`localStorage`に保存され、トップページに
「マイ球団の最新ニュース」と「直近の試合結果」のセクションが表示されます。ログイン不要・サーバー送信なしの、端末内
だけで完結する機能です。未設定の場合は、案内文のみを表示します。

### 直近の試合結果

マイ球団を設定すると、トップページの「マイ球団の最新ニュース」の下に、直近1試合の結果がスコアカード形式
(球場・対戦カード・スコア・勝敗投手・セーブ投手)で表示されます。

**データ元について**: NPB公式サイト(npb.jp)は全ページのフッターに「掲載の情報...の二次利用および無断転載を
固く禁じます」と明記しており、主要スポーツサイト(Yahoo!スポーツ、SPAIA等)も同様かそれ以上に厳格な禁止条項を
持つため、いずれも自動取得の対象にできません(本サイトがRSS再配信機能を日刊スポーツの規約違反で撤去した経緯と
同じ判断です)。一方、日本語版Wikipediaの各球団の年度別ページ(例:「[2026年の阪神タイガース](https://ja.wikipedia.org/wiki/2026年の阪神タイガース)」)
に掲載されている試合結果表はCC BY-SA 4.0ライセンスで、再利用が明示的に許可されています。`scripts/fetch-results.mjs`
がMediaWiki APIとcheerioでこの表をパースし、`src/data/results.json` に書き出します。

**勝敗投手の補完について**: 各球団の年度別ページには、そのチーム自身が絡む決着投手(勝った試合の勝利投手・
セーブ投手、負けた試合の敗戦投手)しか載っておらず、相手チーム側の決着投手は載っていません(例:中日が阪神に
負けた試合の中日ページには敗戦投手(中日の投手)しか載らず、勝利投手(阪神の投手)は阪神自身のページにしか
載っていません)。スコアカードは両チーム分の決着投手を表示したいため、`scripts/fetch-results.mjs` の
`fillOpponentPitchers` で、同じ試合(同日付・対戦相手が逆になっている行)を相手チームの取得結果から探して
空欄のフィールドだけを補完しています。同日に同一カードのダブルヘッダーがある場合、日付だけでは1試合目・2試合目を
区別できず誤って組み合わせる可能性がある点は既知の制約です(NPBでは稀なケースです)。

トレードオフとして、ボランティア編集のため試合終了から反映までに数時間〜1日程度のラグが生じることがあります。
また表の形式が将来変わる可能性を踏まえ、ヘッダー行のテキスト一致で対象の表を判定する作りにしており、個別球団の
取得に失敗した場合は(表の形式変更や一時的なネットワークエラーなどで)、その回は前回取得済みの値をそのまま
維持します(`npb-curation-bot` によるコミットが毎回発生するとは限りません)。対戦相手の球団判定は
`src/data/teams.json` の `short` フィールド(またはフォールバックで `shortKeywords`)との照合で行っています。

### 話題から探す(トピックタグ)

`scripts/fetch-news.mjs` が記事のタイトル・要約から「移籍・トレード」「故障・負傷」「登録・抹消」「契約更改」「ドラフト」
「監督・コーチ人事」「引退」の話題タグを自動判定し、`/topic/` 以下のページで球団の枠を超えて横断閲覧できます。
判定キーワードは `src/data/topics.json` の `keywords` で調整できます。

### 同一ニュースの統合表示

複数の野球専門メディアが同じ出来事を報じている場合、タイトルの類似度・公開時刻の近さ・球団タグの一致という3条件を
すべて満たした記事だけを1件に統合し、代表記事の下に「ほか◯社」として他の出典リンクを併記します(`scripts/fetch-news.mjs`
内の`dedupeSameEventItems`)。誤って無関係な記事を統合してしまう方が実害が大きいため、条件はかなり保守的にしてあります。
しきい値は `DEDUPE_TITLE_SIMILARITY` / `DEDUPE_WINDOW_MS` で調整できます。

### PWA対応(ホーム画面追加・オフライン閲覧)

`public/manifest.webmanifest` と `public/sw.js` により、スマートフォンのブラウザから「ホーム画面に追加」でアプリのように
起動できます。Service Workerは「アクセスした分だけキャッシュする」方式(runtime caching)になっており、ビルドのたびに
プリキャッシュ一覧を更新する必要はありません。オフライン時は、以前に開いたページか `public/offline.html` が表示されます。
アイコンは `scripts/generate-icons.py`(Pillow製の簡易生成スクリプト、開発時に手動実行するツールでビルドには含まれません)
で作成しています。

## デザインについて

Claude Designで作成したモックアップ(エディトリアル/マガジン調、クリーム地+アクセントオレンジ)をベースに実装しています。
配色はすべて `src/styles/global.css` の `:root` / `.dark` に定義したCSS変数(`--page-bg` `--text` `--accent` など)にまとまっているため、
この変数を書き換えるだけでライト/ダーク両方の配色を一括調整できます。コンポーネント側は `var(--xxx)` を参照しているだけなので、
`dark:` バリアントを個別に書き足す必要はありません。

さらにデザインを調整する場合は、`src/styles/global.css` のテーマ変数と `src/components/` 配下(特に `NewsRow.astro` `FeaturedNews.astro`
`TeamLinkRow.astro` `TeamChipLink.astro`)を中心に編集してください。

## 免責事項

掲載しているニュースの著作権は各配信元メディアに帰属します。本サイトは見出し・要約・リンクのみを掲載するキュレーション(リンク集)であり、
記事本文の転載は行っていません。RSS配信元の利用規約に変更があった場合は、`src/data/feeds.json` の見直しが必要になることがあります。

配信元のRSS利用規約(例: 日刊スポーツ)には「プログラム等によるRSSの再配信・再提供」を禁止する条項があるため、
本サイトは取得したニュースをHTMLページとして掲載するのみで、サイト自体がRSS/Atom等の形で再配信するエンドポイントは
持たせていません(かつて `/feed.xml` として提供していましたが、この理由により削除しています)。
