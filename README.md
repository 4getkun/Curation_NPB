# NPB Curation

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
- **マイ球団(お気に入り)** — 応援球団を選ぶと、トップページにその球団のニュースだけを表示(端末内保存のみ)
- **話題から探す(トピックタグ)** — 「移籍」「故障」「契約更改」など、球団の枠を超えた話題別の横断閲覧
- **同一ニュースの統合表示** — 複数メディアが同じ出来事を報じている場合、1件にまとめて出典を併記
- **独自RSS配信** — `feed.xml` でこのサイト自体をRSSリーダーから購読可能
- **PWA対応** — ホーム画面への追加・オフライン時の簡易閲覧に対応

## 使用技術

| 用途 | 技術 |
| --- | --- |
| サイト生成 | [Astro](https://astro.build/) 7 (静的サイト出力) |
| スタイリング | [Tailwind CSS](https://tailwindcss.com/) v4 |
| ニュース取得 | Node.js + [rss-parser](https://www.npmjs.com/package/rss-parser) |
| ホスティング | GitHub Pages (無料枠) |
| 自動更新・デプロイ | GitHub Actions (無料枠 / スケジュール実行) |

## セットアップ手順(GitHubへの公開まで)

### 1. このプロジェクトをリポジトリにpush

```bash
cd npb-curation
git init   # 既にgit initされている場合は不要
git add .
git commit -m "Initial commit: NPB Curation site"
git branch -M main
git remote add origin https://github.com/4getkun/Curation_NPB.git
git push -u origin main
```

### 2. GitHub PagesをActions経由で公開する設定にする

1. リポジトリの **Settings → Pages** を開く
2. "Build and deployment" の **Source** を **GitHub Actions** に変更する

### 3. Actionsに書き込み権限を与える(ニュース自動コミットに必要)

1. リポジトリの **Settings → Actions → General** を開く
2. "Workflow permissions" を **Read and write permissions** に変更して保存

### 4. ワークフローを実行する

- 何もしなくても `main` にpushした時点で `.github/workflows/deploy.yml` が自動実行されます
- 手動で今すぐ実行したい場合は **Actions** タブ → "Build and deploy to GitHub Pages" → **Run workflow**
- 以降は30分おきに自動でニュースを取得し直し、ビルド・再デプロイされます

数分待つと `https://4getkun.github.io/Curation_NPB/` でサイトが確認できます。

## ローカルでの開発

```bash
npm install
npm run dev       # http://localhost:4321/Curation_NPB/ で確認
npm run fetch-news   # RSSを取得して src/data/news.json を更新
npm run build      # dist/ に静的ファイルを生成
npm run preview     # ビルド結果をローカルで確認
```

## ディレクトリ構成

```
src/
  data/
    teams.json    球団マスタ(12球団の名称・カラー・判定キーワード)
    feeds.json    ニュース取得元のRSSフィード一覧
    topics.json    話題タグのマスタ(ラベル・判定キーワード)
    news.json     自動生成されるニュースデータ(fetch-newsで更新)
  lib/         データ読み込み・整形用のユーティリティ(news.ts, teams.ts, topics.ts, url.ts)
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
    feed.xml.ts        このサイト自体のRSS配信エンドポイント
    about/index.astro     このサイトについて
scripts/
  fetch-news.mjs     RSS取得→球団/話題分類→重複統合→news.json書き出しスクリプト
  generate-icons.py    PWAアイコン生成スクリプト(開発時に手動実行するツール)
public/
  manifest.webmanifest  PWA用マニフェスト
  sw.js          Service Worker(オフライン対応)
  offline.html      オフライン時のフォールバックページ
  icons/         PWAアイコン(192px/512px)
.github/workflows/
  deploy.yml       ニュース更新→ビルド→GitHub Pagesデプロイを行うワークフロー
```

## ニュース取得元・分類ロジックをカスタマイズする

- `src/data/feeds.json` にRSSフィードを追加・削除できます
  - `"scoped": true` … そのフィード自体がNPB専門(カテゴリ絞り込み済み)。無条件で採用
  - `"scoped": false` … 総合スポーツ系など。球団名 or 一般NPBキーワードに一致した記事のみ採用
- `src/data/teams.json` の `strongKeywords`(曖昧さのない正式名称)・`shortKeywords`(略称。文脈判定つきで使用)を調整すると、記事の球団振り分け精度を調整できます
- `scripts/fetch-news.mjs` の `OUT_OF_SCOPE_KEYWORDS` で、高校野球など対象外にしたい記事のキーワードを追加できます
- `scripts/fetch-news.mjs` の `AD_MARKERS` で、PR・タイアップ記事を除外するための見出しマーカー(`【PR】`等)を追加・調整できます(広告ゼロ方針のため、該当記事は取得時点で除外しています)
- `scripts/fetch-news.mjs` の `ENTERTAINMENT_NOISE_KEYWORDS` で、球団名にヒットしても野球そのものとは無関係な芸能・エンタメ系の記事(始球式イベントに来場したアイドルのファンミーティング記事など)を除外できます。これらの除外ルールは、既存アーカイブ(`src/data/news.json`)に対しても実行のたびに再適用されるため、ルールを追加すれば次回実行時に該当記事が自動的に取り除かれます

球団判定は「見出し(タイトル)を優先し、本文はタイトルに球団名が一つもない場合だけ補助的に見る」方式になっています。
これは、試合結果記事の本文には必ず対戦相手の球団名が出てくる(例:「阪神タイガース戦に先発出場」)ため、本文まで
均等に見てしまうと対戦相手まで一緒にタグ付けされてしまう問題を避けるためです。「◯◯戦」という言い回しでの言及は
対戦相手としての言及とみなして除外する処理も入っています。また、「巨人」「楽天」「ソフトバンク」のように球団の
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
「マイ球団の最新ニュース」セクションが表示されます。ログイン不要・サーバー送信なしの、端末内だけで完結する機能です。

### 話題から探す(トピックタグ)

`scripts/fetch-news.mjs` が記事のタイトル・要約から「移籍・トレード」「故障・負傷」「登録・抹消」「契約更改」「ドラフト」
「監督・コーチ人事」「引退」の話題タグを自動判定し、`/topic/` 以下のページで球団の枠を超えて横断閲覧できます。
判定キーワードは `src/data/topics.json` の `keywords` で調整できます。

### 同一ニュースの統合表示

複数の野球専門メディアが同じ出来事を報じている場合、タイトルの類似度・公開時刻の近さ・球団タグの一致という3条件を
すべて満たした記事だけを1件に統合し、代表記事の下に「ほか◯社」として他の出典リンクを併記します(`scripts/fetch-news.mjs`
内の`dedupeSameEventItems`)。誤って無関係な記事を統合してしまう方が実害が大きいため、条件はかなり保守的にしてあります。
しきい値は `DEDUPE_TITLE_SIMILARITY` / `DEDUPE_WINDOW_MS` で調整できます。

### 独自RSS配信

`/feed.xml` にアクセスすると、このサイトの最新ニュース(直近100件)をRSS 2.0形式で取得できます。お使いのRSSリーダーに
登録すれば、広告ゼロで整理されたNPBニュースをいつも使っているアプリで読めます。

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
