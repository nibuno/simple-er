# SimpleER

線や配置の調整に手間をかけず、ER図を書くためのツール。

**[Web版を試す →](https://nibuno.github.io/simple-er/)**

## 特徴

- **自動配線と整頓**：線はテーブルを避けて自動で引かれ、「整頓」で参照関係に沿って配置を揃えます
- **ドラッグで外部キー**：カラム端の点から参照先カラムへドラッグするだけで接続
- **名前から自動接続**：`user_id → users.id` のような命名から外部キー候補を提案
- **物理名／論理名の切り替え**：日本語の論理名で図を表示
- **複合キー・一意制約・インデックス・自己参照**に対応
- **DDL プレビュー**：PostgreSQL 形式でコピー可能
- **ローカル完結**：データはブラウザ内に保存し、外部へ送信しません。JSON ファイルで保存・復元できます

## はじめに

### Web 版

https://nibuno.github.io/simple-er/ を開くだけで使えます。

### ローカル版

必要なもの：Python 3

```sh
git clone https://github.com/nibuno/simple-er.git
cd simple-er
./start.command
```

ローカルサーバーが起動し、ブラウザで http://127.0.0.1:8765/ が開きます（macOS では `start.command` のダブルクリックでも起動できます）。終了は Ctrl+C です。ビルド済みの `dist/` を配信するため、npm は不要です。

> [!NOTE]
> 図はブラウザごと・URLごとに保存されます。Web 版とローカル版、別の端末の間では同期されないため、移行するときは「ファイルに保存」で JSON を書き出し、移行先で「ファイルを開く」を使ってください。

## 使い方

| 操作 | 方法 |
| --- | --- |
| テーブルを追加 | `T` またはツールバー |
| 外部キーを登録 | カラム端の点から参照先カラムへドラッグ |
| 名前を編集 | テーブル名・カラム名をダブルクリック |
| 削除 | 選択して `Delete` / `⌫` |
| 元に戻す / やり直す | `⌘Z` / `⇧⌘Z` |
| ズーム / 移動 | ピンチ / 2本指スクロール・空白をドラッグ |

詳しい操作、保存の仕組み、複合キーの扱いは [docs/usage.md](docs/usage.md) を参照してください。

### サンプル

`examples/` の JSON を「ファイルを開く」で読み込むと、機能を試せます。

| ファイル | 内容 |
| --- | --- |
| [composite-keys.json](examples/composite-keys.json) | 複合主キー・複合外部キー・一意制約・複数カラムのインデックス・自己参照 |
| [live-streams.json](examples/live-streams.json) | 関係ラベルと鳥の足記法 |
| [layout-branches.json](examples/layout-branches.json) | 11 テーブルの分岐と長い参照の整頓 |
| [event-reservations.json](examples/event-reservations.json) | イベント予約のモデル例（旧形式 v1 の読み込み） |

## SimpleCanvas

同じ見た目で構成図とメモを扱う姉妹ツールです。`start-canvas.command` で起動します（http://127.0.0.1:8766/）。SimpleER とは画面・保存領域が別です。詳しくは [canvas/README.md](canvas/README.md) を参照してください。

## ロードマップ

- [ ] Mermaid 形式への出力（関係情報のみ。手動配置や線の経路は再現しません）
- [ ] SVG・PNG での画像出力
- [ ] 大きな図での速度改善

## 開発

React + TypeScript（strict）+ Vite で実装しています。Node.js 22.18 以降が必要です。

```sh
npm ci
npm run dev    # http://127.0.0.1:5173/
npm test
npm run build
```

ディレクトリ構成、データモデル、Web 版の公開手順は [docs/development.md](docs/development.md) を参照してください。設計と検証の記録は [IMPLEMENTATION.md](IMPLEMENTATION.md) にあります。

## ライセンス

[MIT](LICENSE)
