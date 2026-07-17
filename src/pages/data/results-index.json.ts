// クライアントサイドの「マイ球団」機能から fetch() で読み込むための軽量な
// JSONエンドポイント。ビルド時に静的ファイルとして出力される
// (このリポジトリは output:"static" の静的サイトなので、サーバーは不要)。
// データ本体は scripts/fetch-results.mjs が定期実行で src/data/results.json
// に書き出したものをそのまま公開する(球団数×直近10件程度なのでサイズは小さく、
// news-index.json のように絞り込みを挟む必要がない)。
import type { APIRoute } from "astro";
import resultsData from "../../data/results.json";

export const prerender = true;

export const GET: APIRoute = () => {
  return new Response(JSON.stringify(resultsData), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
