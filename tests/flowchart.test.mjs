import { test } from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeFlowchart,
  parseFlowchart,
  toFlowchart,
} from "../canvas/src/flowchart.ts";
import {
  decode,
  encode,
  emptyDocument,
  makeNode,
} from "../canvas/src/model.ts";
import { SHAPES } from "../canvas/src/shapes.ts";

const box = (doc, id) => doc.nodes.find((n) => n.id === id);
const valid = (doc) => decode(encode(doc));

test("書き出した図を貼り付けると、図形・ラベル・囲み・線を復元できる", () => {
  const doc = emptyDocument();
  const group = {
    ...makeNode("group", { x: 0, y: 0 }),
    title: '注文 [本番] "東" %%',
  };
  const shapes = SHAPES.map((shape, i) => ({
    ...makeNode("box", { x: i * 300, y: 20 }, shape),
    id: i === 0 ? "end" : "図形:" + i,
    title: i === 0 ? "" : i === 1 ? ' 受付 "["\n<br/> ' : shape,
    description: i === 0 ? "" : "  詳細 #35; | \\n\n\n次の行  ",
    groupId: i % 2 ? group.id : undefined,
    body: "非公開のメモ",
    fillColor: "#ccbbaa",
  }));
  shapes[2].title = ""; // Only the description is populated.
  const note = { ...makeNode("note", { x: 0, y: 0 }), body: "自由なテキスト" };
  doc.nodes = [group, ...shapes, note];
  doc.edges = shapes.map((n, i) => ({
    id: "edge" + i,
    from: n.id,
    to: shapes[(i + 1) % shapes.length].id,
    label: i % 2 ? '  注文 "|]" %% <br/>\n#124;  ' : "",
    dashed: !!(i % 2),
    arrowheads: [undefined, "both", "none"][i % 3],
  }));
  doc.edges.push({
    id: "note-edge",
    from: note.id,
    to: shapes[0].id,
    label: "",
    dashed: false,
  });
  const text = toFlowchart(doc);
  assert.doesNotMatch(text, /非公開のメモ|自由なテキスト|ccbbaa/);
  const restored = valid(parseFlowchart(text));
  const frame = restored.nodes.find((n) => n.kind === "group");
  assert.equal(frame.title, group.title);
  assert.equal(restored.nodes.length, shapes.length + 1);
  for (const original of shapes) {
    const n = restored.nodes.find(
      (n) => n.kind === "box" && n.shape === original.shape,
    );
    assert.equal(n.title, original.title);
    assert.equal(n.description, original.description);
    assert.equal(n.groupId, original.groupId ? frame.id : undefined);
  }
  const wires = (doc) =>
    doc.edges.map((e) => [
      box(doc, e.from).shape,
      box(doc, e.to).shape,
      e.label,
      e.dashed,
      e.arrowheads ?? "end",
    ]);
  assert.deepEqual(wires(restored), wires(doc).slice(0, -1));
});

test("図形と線を読み取る", () => {
  const doc = parseFlowchart(
    "flowchart LR\n  user[利用者] --> web[Web] --> db[(注文DB)]",
  );
  assert.deepEqual(
    doc.nodes.map((n) => [n.id, n.shape, n.title]),
    [
      ["user", "rectangle", "利用者"],
      ["web", "rectangle", "Web"],
      ["db", "cylinder", "注文DB"],
    ],
  );
  assert.deepEqual(
    doc.edges.map((e) => [e.from, e.to, e.label, e.dashed]),
    [
      ["user", "web", "", false],
      ["web", "db", "", false],
    ],
  );
  assert.ok(box(doc, "user").x < box(doc, "web").x);
  assert.ok(box(doc, "web").x < box(doc, "db").x);
  valid(doc);
});

test("名前だけの図形はそのまま名前になる", () => {
  const doc = parseFlowchart("A --> B");
  assert.deepEqual(
    doc.nodes.map((n) => n.title),
    ["A", "B"],
  );
});

test("括弧と ::: で図形を選ぶ", () => {
  const doc = parseFlowchart(`flowchart LR
    a([楕円]) --> b((円)) --> c{分岐} --> d[/伝票/]
    a --> e[利用者]:::person --> f[S3]:::cloud --> g[一覧]:::screen`);
  assert.deepEqual(
    doc.nodes.map((n) => n.shape),
    ["ellipse", "circle", "diamond", "document", "person", "cloud", "screen"],
  );
  valid(doc);
});

test("線のラベルと点線、向きの反転", () => {
  const doc = parseFlowchart(`flowchart LR
    a[A] -->|注文する| b[B]
    b -- 保存する --> c[C]
    c -.-> d[D]
    d -. 通知 .-> a
    a <-- 返す -- c`);
  assert.deepEqual(
    doc.edges.map((e) => [e.from, e.to, e.label, e.dashed]),
    [
      ["a", "b", "注文する", false],
      ["b", "c", "保存する", false],
      ["c", "d", "", true],
      ["d", "a", "通知", true],
      ["c", "a", "返す", false],
    ],
  );
  valid(doc);
});

test("線の両端の矢印と破線を別々に読み取る", () => {
  const doc = parseFlowchart("a---b<-->|同期|c\nc-.->d-.-e<-.->f\nf <-- g");
  assert.deepEqual(
    valid(doc).edges.map((e) => [
      e.from,
      e.to,
      e.arrowheads,
      e.dashed,
      e.label,
    ]),
    [
      ["a", "b", "none", false, ""],
      ["b", "c", "both", false, "同期"],
      ["c", "d", "end", true, ""],
      ["d", "e", "none", true, ""],
      ["e", "f", "both", true, ""],
      ["g", "f", "end", false, ""],
    ],
  );
  assert.ok(looksLikeFlowchart("a <--> b"));
  assert.ok(looksLikeFlowchart("a --- b"));
});
test("2行目以降の文字は説明になる", () => {
  const doc = parseFlowchart("a[API<br/>注文を受け付ける] --> b[DB]");
  assert.equal(box(doc, "a").title, "API");
  assert.equal(box(doc, "a").description, "注文を受け付ける");
});

test("& で複数に分岐する", () => {
  const doc = parseFlowchart("api[API] --> db[(DB)] & cache[(キャッシュ)]");
  assert.deepEqual(
    doc.edges.map((e) => [e.from, e.to]),
    [
      ["api", "db"],
      ["api", "cache"],
    ],
  );
  assert.equal(box(doc, "db").x, box(doc, "cache").x);
  assert.notEqual(box(doc, "db").y, box(doc, "cache").y);
});

test("subgraph が囲みになる", () => {
  const doc = parseFlowchart(`flowchart LR
    user[利用者] --> web[Web]
    subgraph aws[AWS]
      web --> api[API] --> db[(DB)]
    end`);
  const group = box(doc, "aws");
  assert.equal(group.kind, "group");
  assert.equal(group.title, "AWS");
  assert.deepEqual(
    doc.nodes.filter((n) => n.groupId === "aws").map((n) => n.id),
    ["api", "db"],
  );
  const inside = doc.nodes.filter((n) => n.groupId === "aws");
  for (const node of inside) {
    assert.ok(group.x <= node.x && node.x + node.w <= group.x + group.w);
    assert.ok(group.y <= node.y && node.y + node.h <= group.y + group.h);
  }
  assert.ok(!doc.nodes.some((n) => n.id === "web" && n.groupId));
  valid(doc);
});

test("図形と囲みが重ならない", () => {
  const doc = parseFlowchart(`flowchart LR
    user[利用者]:::person --> web[Web]
    subgraph aws[AWS]
      web --> api[API] --> db[(注文DB)]
    end
    api -.-> queue[キュー]:::cloud --> mail[メール配信]
    db --> admin[管理画面]:::screen`);
  const overlap = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const boxes = doc.nodes.filter((n) => n.kind === "box");
  boxes.forEach((a, i) =>
    boxes.slice(i + 1).forEach((b) => {
      assert.ok(!overlap(a, b), `${a.id} と ${b.id} が重なっている`);
    }),
  );
  for (const group of doc.nodes.filter((n) => n.kind === "group"))
    for (const box of boxes)
      if (box.groupId !== group.id)
        assert.ok(
          !overlap(group, box),
          `${group.id} と ${box.id} が重なっている`,
        );
});

test("中身のない囲みは作らない", () => {
  const doc = parseFlowchart("subgraph vpc[VPC]\nend\na[A] --> b[B]");
  assert.ok(!doc.nodes.some((n) => n.kind === "group"));
});

test("graph TD は縦に並べる", () => {
  const doc = parseFlowchart("graph TD\n a[A] --> b[B]\n a --> c[C]");
  assert.ok(box(doc, "a").y < box(doc, "b").y);
  assert.equal(box(doc, "b").y, box(doc, "c").y);
  assert.notEqual(box(doc, "b").x, box(doc, "c").x);
});

test("RL は向きを逆にする", () => {
  const doc = parseFlowchart("flowchart RL\n a[A] --> b[B]");
  assert.ok(box(doc, "a").x > box(doc, "b").x);
});

test("コメントと見た目の指定は読み飛ばす", () => {
  const doc = parseFlowchart(`flowchart LR
    %% これはコメント
    classDef big fill:#f00
    a[A] --> b[B]
    style a fill:#0f0`);
  assert.equal(doc.nodes.length, 2);
});

test("循環があっても止まる", () => {
  const doc = parseFlowchart("a[A] --> b[B] --> c[C] --> a");
  assert.equal(doc.edges.length, 3);
  valid(doc);
});

test("読み取れないときは行番号を伝える", () => {
  assert.throws(() => parseFlowchart("a[A] --> b[B]\n!!!"), /2行目/);
  assert.throws(() => parseFlowchart("a[A] --> b[B] ]]]"), /1行目/);
  assert.throws(() => parseFlowchart("a[A] -->|ラベル b[B]"), /1行目/);
  assert.throws(() => parseFlowchart("a[A]:::square --> b[B]"), /1行目/);
  assert.throws(() => parseFlowchart("a[A] -->"), /つなぎ先/);
});

test("囲みにはつなげない", () => {
  assert.throws(
    () => parseFlowchart("subgraph aws[AWS]\n a[A]\nend\n b[B] --> aws"),
    /囲み/,
  );
});

test("end のない subgraph は読み取れない", () => {
  assert.throws(
    () => parseFlowchart("subgraph aws[AWS]\n a[A] --> b[B]"),
    /end/,
  );
});

test("図形がなければ読み取れない", () => {
  assert.throws(() => parseFlowchart("flowchart LR"), /図形/);
});

test("mermaidの書き方かどうかを見分ける", () => {
  assert.ok(looksLikeFlowchart("flowchart LR\n a --> b"));
  assert.ok(looksLikeFlowchart("a[A] --> b[B]"));
  assert.ok(looksLikeFlowchart("a -.-> b"));
  assert.ok(!looksLikeFlowchart("あとで図にする - 注文の流れ"));
  assert.ok(!looksLikeFlowchart("1. 受け付ける\n2. 保存する"));
});

test("区切り、タブ、引用符付きラベルを読み取る", () => {
  const doc = parseFlowchart(
    'graph BT;\n  front-end["画面 [一覧] %%"]\t-->\tapi; %% コメント',
  );
  assert.equal(box(doc, "front-end").title, "画面 [一覧] %%");
  assert.ok(box(doc, "front-end").y > box(doc, "api").y);
  assert.ok(looksLikeFlowchart("a[開始] --- b[終了]"));
  assert.ok(!looksLikeFlowchart("発表の資料に 矢印 --> を書く"));
});

test("線の記号や分岐、囲みの誤りは元の行番号で知らせる", () => {
  for (const line of [
    "a - b",
    "a --> b &",
    "end extra",
    "subgraph",
    "flowchart XYZ",
    "flowchart LR !!!",
    "subgraph group[未完",
    "subgraph group",
  ]) {
    assert.throws(
      () => parseFlowchart("%% コメント\n\n" + line + "\na --> b"),
      /3行目/,
    );
  }
});

test("分岐で線の上限を超える行を知らせる", () => {
  const refs = Array.from({ length: 21 }, (_, i) => "a" + i).join(" & ");
  assert.throws(
    () => parseFlowchart("graph LR\n" + refs + " --> " + refs),
    /2行目.*400本/,
  );
});

test("複数の囲みが同じ段にあっても枠が重ならない", () => {
  const doc = parseFlowchart(
    "graph LR\nsubgraph g1\na --> b\nend\nsubgraph g2\nc --> d & e\nend\nb --> c",
  );
  const g1 = box(doc, "g1"),
    g2 = box(doc, "g2");
  assert.ok(g1.y + g1.h < g2.y);
});

test("Mermaid と HTML の参照は一度だけ戻す", () => {
  const graph = parseFlowchart(
    'flowchart LR\n a["A &amp; B &lt;C&gt; &amp;amp;"] -->|"&#x3042; #quot;"| b["#38;amp;"]',
  );
  assert.equal(graph.nodes[0].title, "A & B <C> &amp;");
  assert.equal(graph.nodes[1].title, "&amp;");
  assert.equal(graph.edges[0].label, 'あ "');
});
