import { readFileSync } from "node:fs";
import { decode } from "../../src/model.ts";
import { graph, branching } from "../../tests/layout-fixtures.mjs";
export const actual = JSON.parse(
  readFileSync(new URL("./current-input.json", import.meta.url), "utf8"),
);
export const cases = [
  {
    id: "live",
    name: "今の3テーブル",
    note: "Users / LiveStreams / Comments。現在の図と同じ定義・カラム寸法。",
    diagram: actual,
  },
  {
    id: "labels",
    name: "動詞ラベルあり",
    note: "同じ3テーブルに「配信する」「投稿する」「コメントが付く」を設定。",
    diagram: decode(
      readFileSync(
        new URL("../../examples/live-streams.json", import.meta.url),
        "utf8",
      ),
    ),
  },
  {
    id: "branches",
    name: "分岐する11テーブル",
    note: "注文・商品・配送。列をまたぐ参照と独立したテーブルを含む。",
    diagram: branching(),
  },
  {
    id: "fanout",
    name: "同じidに8本集中",
    note: "Users.idを8テーブルが参照。共通部分の重なりは許可。",
    diagram: graph([
      ["Users", [], 2],
      ...[
        "Comments",
        "Likes",
        "Posts",
        "Sessions",
        "Profiles",
        "Uploads",
        "Messages",
        "Events",
      ].map((n, i) => [n, ["Users"], i % 4]),
    ]),
  },
  {
    id: "cycles",
    name: "循環・自己参照",
    note: "A → B → C → A と、自己参照を持つD。",
    diagram: graph([
      ["A", ["C"], 2],
      ["B", ["A"], 1],
      ["C", ["B"], 3],
      ["D", ["D", "A"], 2],
    ]),
  },
  {
    id: "composite",
    name: "複合外部キー",
    note: "tenant_idとidの組。複合キーの対応と自己参照を含む。",
    diagram: decode(
      readFileSync(
        new URL("../../examples/composite-keys.json", import.meta.url),
        "utf8",
      ),
    ),
  },
];
export const editsBase = graph([
  ["Users", [], 2],
  ["Comments", ["Users"], 4],
]);
editsBase.tables[0].x = 80;
editsBase.tables[0].y = 220;
editsBase.tables[1].x = 960;
editsBase.tables[1].y = 220;
export const obstacle = graph([["Archive", [], 12]]).tables[0];
obstacle.x = 490;
obstacle.y = 80;
