import { test } from "node:test";
import assert from "node:assert/strict";
import { diagramDDL, tableDDL, identifier } from "../src/ddl.ts";

const users = {
  id: "users",
  name: "users",
  logicalName: "利用者",
  note: "ユーザー",
  x: 0,
  y: 0,
  columns: [
    { id: "u-id", name: "id", type: "uuid", key: "PK", logicalName: "" },
    { id: "u-mail", name: "email", type: "text", key: "", logicalName: "" },
  ],
  keys: [
    { id: "pk", name: "", kind: "primary", columnIds: ["u-id"] },
    { id: "uq", name: "", kind: "unique", columnIds: ["u-mail"] },
  ],
  foreignKeys: [],
};
const orders = {
  id: "orders",
  name: "orders",
  logicalName: "",
  x: 400,
  y: 0,
  columns: [
    { id: "o-id", name: "id", type: "uuid", key: "PK", logicalName: "" },
    {
      id: "o-user",
      name: "user_id",
      type: "uuid",
      key: "FK",
      logicalName: "利用者番号",
      note: "ユーザーID",
    },
  ],
  keys: [
    { id: "opk", name: "", kind: "primary", columnIds: ["o-id"] },
    { id: "ix", name: "", kind: "index", columnIds: ["o-user"] },
  ],
  foreignKeys: [
    {
      id: "fk",
      name: "",
      columnIds: ["o-user"],
      target: { tableId: "users", columnIds: ["u-id"] },
    },
  ],
};
const state = { tables: [users, orders], edges: [] };

test("DDL lists columns, keys, references, indexes and comments", () => {
  const ddl = tableDDL(orders, state);
  assert.match(
    ddl,
    /^CREATE TABLE orders \(\n {2}id {6}uuid,\n {2}user_id uuid,/,
  );
  assert.match(ddl, /PRIMARY KEY \(id\)/);
  assert.match(ddl, /FOREIGN KEY \(user_id\) REFERENCES users \(id\)\n\);/);
  assert.match(ddl, /CREATE INDEX orders_idx_1 ON orders \(user_id\);/);
  assert.match(ddl, /COMMENT ON COLUMN orders\.user_id IS 'ユーザーID';/);
  assert.match(tableDDL(users, state), /UNIQUE \(email\)/);
  assert.match(tableDDL(users, state), /COMMENT ON TABLE users IS 'ユーザー';/);
});

test("DDL skips incomplete drafts instead of failing", () => {
  const draft = structuredClone(orders);
  draft.columns.push({
    id: "blank",
    name: " ",
    type: "",
    key: "",
    logicalName: "",
  });
  draft.foreignKeys.push({ id: "pending", name: "", columnIds: ["o-id"] });
  draft.keys.push({ id: "ix2", name: "", kind: "index", columnIds: ["blank"] });
  const ddl = tableDDL(draft, state);
  assert.equal(ddl.match(/FOREIGN KEY/g).length, 1);
  assert.equal(ddl.match(/CREATE INDEX/g).length, 1);
  assert.doesNotMatch(ddl, /blank/);
});

test("identifiers are quoted only when needed", () => {
  assert.equal(identifier("order_items"), "order_items");
  assert.equal(identifier("user"), '"user"');
  assert.equal(identifier("column"), '"column"');
  assert.equal(identifier("join"), '"join"');
  assert.equal(identifier("注文"), '"注文"');
  assert.equal(identifier('a"b'), '"a""b"');
});

test("diagram DDL joins the previews and defers forward references in a cycle", () => {
  assert.equal(
    diagramDDL(state),
    [users, orders].map((t) => tableDDL(t, state)).join("\n\n"),
  );
  const cycle = structuredClone(state);
  cycle.tables[0].foreignKeys.push({
    id: "later",
    name: "最新注文",
    columnIds: ["u-id"],
    target: { tableId: "orders", columnIds: ["o-id"] },
  });
  const ddl = diagramDDL(cycle);
  assert.equal(ddl.match(/CREATE TABLE /g).length, 2);
  assert.equal(ddl.match(/FOREIGN KEY /g).length, 2);
  assert.ok(
    ddl.endsWith(
      'ALTER TABLE users ADD CONSTRAINT "最新注文" FOREIGN KEY (id) REFERENCES orders (id);',
    ),
  );
  assert.match(
    tableDDL(cycle.tables[0], cycle),
    /CONSTRAINT "最新注文" FOREIGN KEY/,
  );
  assert.equal(diagramDDL({ tables: [], edges: [] }), "");
});
