import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDiagram,
  encode,
  decode,
  editTable,
  inferConnections,
  makeEdge,
} from "../src/model.ts";
import { route, rounded } from "../src/geometry.ts";

function fixture() {
  return validateDiagram({
    tables: [
      {
        id: "users",
        name: "users",
        x: 0,
        y: 0,
        columns: [
          { name: "id", type: "uuid", key: "PK", id: "u-id" },
          { name: "name", type: "text", key: "", id: "u-name" },
        ],
      },
      {
        id: "orders",
        name: "orders",
        x: 480,
        y: 160,
        columns: [
          { name: "id", type: "uuid", key: "PK", id: "o-id" },
          { name: "user_id", type: "uuid", key: "FK", id: "o-user" },
        ],
      },
    ],
    edges: [],
  });
}
function connected() {
  const data = fixture();
  const edge = makeEdge(
    data,
    { table: "users", row: 0 },
    { table: "orders", row: 1 },
  );
  edge.trunk = 375;
  edge.manual = true;
  data.edges.push(edge);
  return data;
}
test("saved diagram round-trips names, stable IDs, positions and manually adjusted lines", () => {
  const data = connected();
  assert.deepEqual(decode(encode(data)), data);
});
test("editing a table and reordering a column preserves the relation and manual route", () => {
  const original = connected(),
    t = structuredClone(original.tables[1]);
  t.name = "purchases";
  t.columns.reverse();
  t.columns[0].name = "customer_id";
  const updated = editTable(original, t);
  assert.equal(updated.edges[0].to.row, 0);
  assert.equal(updated.edges[0].to.table, "orders");
  assert.equal(updated.edges[0].trunk, 375);
  assert.equal(updated.edges[0].manual, true);
  assert.equal(updated.tables[1].columns[0].id, "o-user");
  assert.equal(original.tables[1].name, "orders");
});
test("deleting a connected column removes only its relation", () => {
  const original = connected(),
    t = structuredClone(original.tables[1]);
  t.columns = t.columns.filter((c) => c.id !== "o-user");
  assert.equal(editTable(original, t).edges.length, 0);
  assert.equal(original.edges.length, 1);
});
test("adding a column does not move existing tables or detach edges", () => {
  const original = connected(),
    t = structuredClone(original.tables[1]);
  t.columns.unshift({ name: "number", type: "text", key: "", id: "o-number" });
  const next = editTable(original, t);
  assert.equal(next.edges[0].to.row, 2);
  assert.deepEqual(
    next.tables.map((t) => [t.x, t.y]),
    original.tables.map((t) => [t.x, t.y]),
  );
});
test("auto connection proposes foreign key to unique primary key without mutating data", () => {
  const data = fixture(),
    before = encode(data),
    result = inferConnections(data);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].from, { table: "users", row: 0 });
  assert.deepEqual(result.candidates[0].to, { table: "orders", row: 1 });
  assert.equal(encode(data), before);
});
test("already connected columns are not proposed again", () =>
  assert.equal(inferConnections(connected()).candidates.length, 0));
test("ambiguous table names are skipped instead of connecting arbitrarily", () => {
  const data = fixture();
  data.tables.push({
    id: "another",
    name: "user",
    x: 900,
    y: 0,
    columns: [{ name: "id", type: "uuid", key: "PK", id: "another-id" }],
  });
  const result = inferConnections(data);
  assert.equal(result.candidates.length, 0);
  assert.match(result.skipped[0], /複数/);
});
test("type mismatch and composite primary keys are skipped", () => {
  const data = fixture();
  data.tables[0].columns[0].type = "integer";
  assert.match(inferConnections(data).skipped[0], /型/);
  data.tables[0].columns[0].type = "uuid";
  data.tables[0].keys[0].columnIds.push("u-name");
  assert.match(inferConnections(data).skipped[0], /主キー/);
});
test("basic -ies plural matching finds category_id to categories", () => {
  const data = fixture();
  data.tables[0].name = "categories";
  data.tables[1].columns[1].name = "category_id";
  assert.equal(inferConnections(data).candidates.length, 1);
});
test("invalid or unsupported files fail without changing the original state", () => {
  const original = connected(),
    before = encode(original);
  assert.throws(() => decode("{"));
  assert.throws(() => decode('{"format":"er-sketch","version":99}'));
  const invalid = JSON.parse(before);
  invalid.schema.tables[1].foreignKeys[0].target.columnIds = ["missing"];
  assert.throws(() => decode(JSON.stringify(invalid)), /存在しない/);
  assert.equal(encode(original), before);
});
test("duplicate trimmed names and unsafe table IDs are rejected", () => {
  const data = fixture();
  data.tables[1].name = " users ";
  assert.throws(() => validateDiagram(data), /重複/);
  const columns = fixture();
  columns.tables[0].columns.push({
    name: " id ",
    type: "text",
    key: "",
    id: "dup",
  });
  assert.throws(() => validateDiagram(columns), /重複/);
  const ids = fixture();
  ids.tables[0].id = 'bad"]';
  assert.throws(() => validateDiagram(ids));
});
test("empty diagrams can be saved and restored", () =>
  assert.deepEqual(decode(encode({ tables: [], edges: [] })), {
    tables: [],
    edges: [],
    schemaVersion: 2,
    unresolvedEdges: [],
  }));
test("after rename, reorder and reload the route still attaches to the intended row", () => {
  const data = connected(),
    t = structuredClone(data.tables[1]);
  t.columns.reverse();
  const next = decode(encode(editTable(data, t))),
    path = route(next.edges[0], next.tables);
  assert.equal(path.points.at(-1).y, 160 + 52 + 19);
  assert.equal(path.handle.x, 375);
  assert.match(rounded(path.points), /Q/);
});

test("logical names survive editing and file save without changing connection identity", () => {
  const data = connected(),
    table = structuredClone(data.tables[1]);
  table.logicalName = "注文";
  table.columns[1].logicalName = "ユーザーID";
  const restored = decode(encode(editTable(data, table)));
  assert.equal(restored.tables[1].logicalName, "注文");
  assert.equal(restored.tables[1].columns[1].logicalName, "ユーザーID");
  assert.deepEqual(restored.edges, data.edges);
});
test("logical names do not affect automatic relation inference; older files remain readable", () => {
  const data = fixture();
  data.tables[0].logicalName = "会員";
  data.tables[1].columns[1].logicalName = "会員番号";
  assert.equal(inferConnections(data).candidates.length, 1);
  for (const t of data.tables) {
    delete t.logicalName;
    t.columns = t.columns.map((c) => [c.name, c.type, c.key, c.id]);
  }
  const restored = decode(
    JSON.stringify({ format: "er-sketch", version: 1, diagram: data }),
  );
  assert.equal(restored.tables[0].logicalName, "");
  assert.equal(restored.tables[1].columns[1].logicalName, "");
});

test("manual relations reject pairs without a unique target and allow identifying relationships", () => {
  const data = fixture();
  assert.throws(
    () =>
      makeEdge(data, { table: "users", row: 1 }, { table: "orders", row: 1 }),
    /主キー/,
  );
  assert.ok(
    makeEdge(data, { table: "users", row: 0 }, { table: "orders", row: 0 }),
  );
  assert.ok(
    makeEdge(data, { table: "orders", row: 1 }, { table: "users", row: 0 }),
  );
});
test("long names expand table bounds and connection anchors", async () => {
  const { tableWidth, port, boxes } = await import("../src/geometry.ts");
  const data = fixture(),
    table = data.tables[0],
    before = tableWidth(table);
  table.name = "live_stream_information_details";
  table.columns[1].name = "live_stream_information_identifier";
  assert.ok(tableWidth(table) > before);
  assert.equal(port(table, 0, "right").x, table.x + tableWidth(table));
  assert.equal(boxes([table])[0].r, table.x + tableWidth(table) + 18);
  const physical = tableWidth(table);
  table.logicalName = "ライブ配信の管理に利用する詳細情報テーブル";
  assert.ok(tableWidth(table) >= physical);
});
