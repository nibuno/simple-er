/** The diagrams in examples/, opened from 「サンプルを開く」. */
export const samples = [
  {
    name: "注文の基本",
    description: "利用者、注文、注文明細の3テーブル",
    load: async () => ({
      default: (await import("./initial.ts")).initialDocument,
    }),
  },
  {
    name: "複合キー",
    description: "複合主キー、複合外部キー、一意制約、自己参照",
    load: () => import("../examples/composite-keys.json"),
  },
  {
    name: "ライブ配信",
    description: "関係ラベルと鳥の足記法",
    load: () => import("../examples/live-streams.json"),
  },
  {
    name: "通販の注文",
    description: "11テーブルの分岐と長い参照",
    load: () => import("../examples/layout-branches.json"),
  },
  {
    name: "イベント予約",
    description: "旧形式（version 1）のファイル",
    load: () => import("../examples/event-reservations.json"),
  },
];

export async function loadSample(index: number) {
  return JSON.stringify((await samples[index].load()).default);
}
