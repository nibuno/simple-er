# 開発ガイド

## 必要環境

- Node.js 22.18 以降
- Python 3（ローカル配信用の `serve.py` / `serve_canvas.py`）

## コマンド

```sh
npm ci                # 依存関係のインストール
npm run dev           # 開発サーバー: http://127.0.0.1:5173/
npm run dev:canvas    # SimpleCanvas の開発サーバー: http://127.0.0.1:5174/
npm run build         # 型チェックと dist/ の生成（SimpleER + SimpleCanvas）
npm run build:pages   # GitHub Pages 用に SimpleER のみを dist-pages/ へ生成
npm run typecheck     # 型チェックのみ
npm test              # テスト（保存・接続・整頓・履歴・React の操作）
npm run format        # Prettier で整形
```

`start.command` は生成済みの `dist/` を配信するため、ソースを変更したら `npm run build` で更新してください。`dist/` は生成物なので直接編集しません。開発サーバーは保存領域が異なるため、既存の図を確認する場合はビルド後に http://127.0.0.1:8765/ を再読み込みしてください。

## ディレクトリ構成

```
src/
  App.tsx            図の状態・履歴・保存・ツールバー
  DiagramCanvas.tsx  SVG 描画、ドラッグ、拡大縮小
  Dialogs.tsx        テーブル編集と自動接続の候補
  Panels.tsx         テーブル一覧と詳細パネル
  ddl.ts             DDL プレビューの生成
  types.ts           テーブル・カラム・接続の型
  model.ts           保存形式の検証・編集・接続推測
  geometry.ts        線の経路計算
  layout.ts          整頓
  history.ts         元に戻す・やり直す
shared/              SimpleER と SimpleCanvas の共通処理（履歴、別タブ変更の検知）
canvas/              SimpleCanvas
tests/               テスト
examples/            サンプルの図
docs/                ドキュメント
experiments/         配線アルゴリズムの比較実験
```

## データモデル

実行時の正本は `DiagramDocument` です。Undo・Redo、自動保存、ファイル出力はこの文書を扱います。

- `schema`：テーブル・名前付きの `Column`・キー・外部キー
- `presentation`：テーブル ID ごとの座標と、外部キー ID＋参照元カラム ID ごとの経路
- `unresolvedEdges`：旧データから移行できなかった線

描画・レイアウト・編集フォームは `projectDocument` が生成する `Diagram` を使います。行番号、PK/FK 表示、描画用の線は派生データで、正本には保存しません。編集結果は `documentFromDiagram` で正本へ戻します。v1 のタプル形式の Column は `migrateLegacyDiagram` で変換します。

内部処理は旧形式の準備・制約検証・描画用の線生成・キー表示更新に分かれています。

## 保存形式

`format: "er-sketch"`, `version: 2`。定義を `schema`、座標・経路を `presentation` に分離し、テーブルとカラムの識別子を名前から分離しているため、名前を変更しても関係を保ちます。

不正な表示情報（重複・存在しない参照・座標や経路の型違い）は読み込み時にエラーとし、現在の図を保持します。

## Web 版の公開

1. デフォルトブランチへ push する
2. GitHub Actions の「Publish SimpleER」から「Run workflow」を実行する
3. テストと型チェックが成功すると GitHub Pages へ配信される

push だけでは公開内容は変わりません。リポジトリ設定で Pages の Source を「GitHub Actions」にしてください。公開方針は [Web公開方針](web-publishing-plan.md) を参照してください。

## 関連資料

- [IMPLEMENTATION.md](../IMPLEMENTATION.md)：設計と検証の記録
- [配線の比較調査](routing-comparison-research.md)：既存エンジンと ELK・libavoid の比較
- [比較実験](../experiments/routing-comparison/README.md)：比較の再実行方法
