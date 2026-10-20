# SimpleERのWeb公開方針

調査日: 2026-10-20。対象: HEAD `07edb96` と現在の未コミット変更（React 19 / Vite 7構成）。コードと公式資料を確認した計画であり、公開環境での動作検証は未実施。

## 公開準備の進捗

2026-10-20にソース公開の了承を得て、`nibuno/simple-er` を公開先として準備した。相対base、`npm run build:pages`、手動実行のPages用Actionsを追加済み。公開用ビルドはSimpleERのみを直接 `dist-pages/` へ生成する方式とし、下記のステージングへのコピー案を置き換えた。

ローカルでは158件のテストと型チェック・公開用ビルドが成功。`/simple-er/` 配下をブラウザで開き、テーブル追加と再読み込み後の復元を確認した。以下は当初計画の記録であり、公開結果はREADMEとGitHub Actionsの実行履歴を参照する。

## 推奨方針

デザインと基本操作が整った段階で、GitHub Pagesへ静的サイトとして公開する。個人で試す間は `https://<account>.github.io/<repository>/` を使い、継続利用や人への案内を始める前に `er.nibuno.dev` へ切り替える。サブドメイン名は候補であり、未決定。

独自ドメインへの変更後もGitHub Pagesを配信元として使えるため、サーバーの移転は必要ない。最初からドメイン設定ができるなら、初回公開から `er.nibuno.dev` を使うほうが保存データの移行を一度減らせる。[GitHubの独自ドメイン設定](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

初回は現在の「ブラウザ内で編集し、ブラウザ内に自動保存し、JSONで持ち出す」構成を維持する。ログイン、クラウド保存、共同編集は、必要になった段階で別途設計する。

## 現在の実装から確認できたこと

| 項目 | 確認結果と公開への影響 |
| --- | --- |
| 配信方式 | [serve.py](../serve.py) は `dist/` の静的配信のみ。アプリ用のサーバーAPIは必要ない。 |
| ビルド | [package.json](../package.json) の `npm run build` は型チェック後、SimpleERとSimpleCanvasをビルドする。 |
| SimpleERのパス | 現在の `dist/index.html` は `/assets/...` を参照する。GitHub Pagesのリポジトリ配下へそのまま置くと参照先がずれるため、Viteの `base` 設定が必要。 |
| SimpleCanvas | [vite.canvas.config.ts](../vite.canvas.config.ts) は `base: "./"`、出力先は `dist/canvas/`。`dist/` 全体を公開するとCanvasも公開対象になる。 |
| 保存 | [src/App.tsx](../src/App.tsx) は `localStorage` を使う。Canvasは別キーを使う。JSONの保存・読み込み機能が既にある。 |
| GitHubとの接続 | このチェックアウトの `git remote -v` は空。公開先のアカウント・リポジトリ・契約プランは未確認。 |

## 公開前に行う実装

1. SimpleERのVite設定へ `base: "./"` を追加する。現在の単一画面構成では、相対アセット参照にしておけばリポジトリ配下と独自ドメイン直下で同じ成果物を使いやすい。将来パスを使う画面遷移を導入する場合は再検討する。[Viteの相対base](https://vite.dev/guide/build#relative-base)
2. 初回の公開対象はSimpleERとする。専用のステージングディレクトリへ `dist/index.html` と `dist/assets/` をコピーし、そこだけを配信する。将来画像などを追加する場合はコピー対象も更新する。SimpleCanvasも公開すると決めた場合は `dist/` 全体を配信し、`/canvas/` で確認する。
3. GitHub Actionsで、Node.jsの対応バージョンを固定し、`npm ci` → `npm test` → `npm run build` → 公開成果物の作成 → Pagesへのデプロイを行う。初回は手動実行にし、運用が安定したら公開用ブランチへのpushでも実行する。
4. Pagesの公開元をGitHub Actionsにする。`configure-pages`、`upload-pages-artifact`、`deploy-pages` を使い、デプロイには `pages: write` と `id-token: write`、`github-pages` 環境を設定する。Actionのバージョンは実装時の公式例で確認する。[ViteのGitHub Pages公開手順](https://vite.dev/guide/static-deploy#github-pages)
5. 画面内の保存案内を「このブラウザに保存」「別端末へはJSONで移動」と分かるようにする。公開しても図のデータが端末間で同期されるわけではない。

生成済みの `dist/` は現在Git管理されているが、公開成果物はActions内でソースから作り直す。生成物をGit管理から外すかどうかは、npmなしで動かせる現在のローカル起動との関係を踏まえて別途決める。

## 初回公開の完了条件

- リポジトリ配下のURLを直接開き、再読み込みしてもJS/CSSが404にならない。
- テーブルの追加・編集・接続・移動・元に戻すができる。
- 再読み込み後に自動保存した図が復元される。
- JSONを保存し、別ブラウザで読み込んで図を復元できる。
- 保存に失敗した場合の案内が表示される。
- 普段使うSafariとChrome、狭い画面で主要操作を確認する。
- 更新を配信した後も保存データを読める。問題があれば既知の正常なコミットを再デプロイする。ただしコードを戻すだけでは保存形式の互換性を戻せないため、形式変更時はJSONバックアップと互換性を確認する。

## `nibuno.dev` のサブドメインへの移行

候補は `er.nibuno.dev`。短く用途が分かり、将来SimpleCanvasを別公開する場合も `canvas.nibuno.dev` と揃えられる。両方を別サブドメインで運用する段階では、それぞれのPagesサイトと公開成果物を分ける。

設定時は次の順序とする。

1. GitHubアカウント側で `nibuno.dev` の所有確認を行う。
2. 対象リポジトリのPages設定に `er.nibuno.dev` を登録する。
3. DNSに `er` のCNAMEを追加し、値を `<account>.github.io` にする。リポジトリ名やURLパスは含めない。
4. DNSと証明書の準備が整ったらHTTPSを強制し、独自ドメインで初回公開時と同じ操作を確認する。

GitHub Actionsによる公開では、リポジトリ内の `CNAME` ファイルは不要。DNSのCNAMEレコードと、Pages設定のCustom domainを設定する。[GitHubの設定手順](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

## 保存データの移行

`localStorage` はオリジン（スキーム・ホスト・ポート）単位で分かれる。ローカル版、`github.io` 版、`er.nibuno.dev` 版の保存領域は別であり、URLを転送しても図は引き継がれない。同じホスト内のパス変更だけなら保存領域は共通なので、同一アプリの試用版を別パスで並べる際にも注意する。[MDNのlocalStorage仕様](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)

ドメイン切り替え前に旧URLでJSONを書き出し、新URLで読み込む。旧URLからの転送が始まると旧オリジンで書き出すことが難しくなるため、バックアップは切り替え前に済ませる。利用者が増えてから変更する場合は、事前に移行期間と保存手順を案内する。

## 公開時に確定する事項

- 公開先アカウント、リポジトリ名、ソースコードの公開可否。GitHub Freeでは公開リポジトリが対象。非公開リポジトリを使う場合は対応プランを確認する。非公開リポジトリと閲覧制限付きサイトは別の条件であり、今回の計画は一般公開を前提とする。[GitHub Pagesの提供条件](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- `er.nibuno.dev` の採用可否、DNSの管理先と既存レコード。今回DNSは調査・変更していない。
- SimpleCanvasも同時公開するか。初回はSimpleERのみを提案する。

次の作業は、デザインが整った時点で相対baseを設定し、ローカルのサブディレクトリ配信でアセット読み込みとJSON保存・復元を確認すること。その結果を確認してから公開用Actionsを追加する。今回は計画の作成のみで、ビルド設定・公開設定・DNSの変更やデプロイは行っていない。
