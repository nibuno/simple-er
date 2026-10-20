# 配置・配線の比較実験

本体を置き換えずに、現在の整頓、現在の配置＋libavoid、ELK Layered、ELK配置＋libavoidを同じデータで比較する。

[結論と検証条件](../../docs/routing-comparison-research.md) / [生成済み比較画面](output/comparison.html) / [数値と全座標](output/results.json)

## 再生成

リポジトリのルートで実行する。Node.js 22.18以降が必要。本体の開発依存（tsx、React）が未導入なら先にルートで `npm ci` を実行する。

```sh
npm ci --prefix experiments/routing-comparison --registry=https://registry.npmjs.org --ignore-scripts
npm --prefix experiments/routing-comparison run compare
node --import tsx --test experiments/routing-comparison/metrics.test.mjs
```

`output/results.json` と自己完結した `output/comparison.html` が生成される。HTMLを開く際に外部サービスやエンジンのダウンロードは不要。図形の計算は生成時にNode.js上で行い、ブラウザは保存済み結果を表示する。

本体のローカルサーバーで見たい場合:

```sh
npm --prefix experiments/routing-comparison run compare -- --serve-copy
```

生成したHTMLを `dist/comparison.html` へコピーする。既存のサーバーを起動した状態で http://127.0.0.1:8765/comparison.html を開く。本体のビルドを行うとdist内のコピーは消えるため、このコマンドで再生成する。比較は本体の保存領域を読み書きしない。

数値を再測定せず、比較ページの描画だけ更新するとき:

```sh
node --import tsx experiments/routing-comparison/render-saved.mjs --serve-copy
```

## ファイル

- `current-input.json`: 比較開始時の3テーブルを固定したデータ。
- `cases.mjs`: 6種類の図と障害物追加・移動の入力。
- `engines.mjs`: 固定ポート、端点の28px余白、エンジンごとの設定。
- `metrics.mjs`: 交差、重なり、長さ、貫通、接続位置、ラベル衝突などの集計。
- `compare.mjs`: 実行、反復計測、入力順の検証、差分更新、出力。
- `render.mjs`: 本体と同じ寸法・配色・鳥の足を使う比較画面。

時間・結果はライブラリ設定と入力に依存する。ライブラリ全体の優劣ではなく、SimpleERの条件で組み込んだ今回の構成を比較している。端点の余白を外す補助実験も結果JSONへ残す。未コミットの本体実装を読み込むため、比較時の本体ソースのハッシュをJSONへ記録する。
