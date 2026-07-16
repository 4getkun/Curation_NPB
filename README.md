# NPB Curation

広告ゼロで読める、NPB(日本プロ野球)12球団のニュース・まとめキュレーションサイトです。
Astro + Tailwind CSS で構築し、GitHub Pages の無料枠だけで完結するように作っています。

- 公開URL(予定): https://4getkun.github.io/Curation_NPB/
- リポジトリ: https://github.com/4getkun/Curation_NPB

## 特徴

- **広告・トラッキングなし** — バナー広告、アフィリエイト、アクセス解析は一切なし
- **NPB12球団のニュースを自動収集** — 野球専門メディアのRSSを定期取得し、球団別に自動振り分け
- **GitHub Actionsで自動更新＋自動デプロイ** — 30分ごとにニュースを取得し、そのままビルド・公開まで自動実行
- **記事本文はコピーしない** — 見出し・要約・リンクのみを掲載し、詳細は配信元サイトに送客(著作権に配慮)

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
    news.json     自動生成されるニュースデータ(fetch-newsで更新)
  lib/         データ読み込み・整形用のユーティリティ
  components/     Header, Footer, NewsCard, TeamBadge など
  layouts/       共通レイアウト(Base.astro)
  pages/
    index.astro         トップページ
    news/index.astro     ニュース一覧(球団フィルター付き)
    team/[team].astro     球団別ページ(12球団分を自動生成)
    about/index.astro     このサイトについて
scripts/
  fetch-news.mjs     RSS取得→球団分類→news.json書き出しスクリプト
.github/workflows/
  deploy.yml       ニュース更新→ビルド→GitHub Pagesデプロイを行うワークフロー
```

## ニュース取得元・分類ロジックをカスタマイズする

- `src/data/feeds.json` にRSSフィードを追加・削除できます
  - `"scoped": true` … そのフィード自体がNPB専門(カテゴリ絞り込み済み)。無条件で採用
  - `"scoped": false` … 総合スポーツ系など。球団名 or 一般NPBキーワードに一致した記事のみ採用
- `src/data/teams.json` の `strongKeywords`(曖昧さのない正式名称)・`shortKeywords`(略称。文脈判定つきで使用)を調整すると、記事の球団振り分け精度を調整できます
- `scripts/fetch-news.mjs` の `OUT_OF_SCOPE_KEYWORDS` で、高校野球など対象外にしたい記事のキーワードを追加できます

## デザインについて

初期状態はシンプルな実装を優先しています。今後 [Claude Code](https://www.anthropic.com/claude-code) 等でデザインを調整する場合は、
`src/styles/global.css`(配色・テーマ変数)と `src/components/` 配下のコンポーネントを中心に編集してください。
Tailwind CSS v4 を採用しているため、`@theme` ブロックの変数を変更するだけでもサイト全体の配色を一括調整できます。

## 免責事項

掲載しているニュースの著作権は各配信元メディアに帰属します。本サイトは見出し・要約・リンクのみを掲載するキュレーション(リンク集)であり、
記事本文の転載は行っていません。RSS配信元の利用規約に変更があった場合は、`src/data/feeds.json` の見直しが必要になることがあります。
