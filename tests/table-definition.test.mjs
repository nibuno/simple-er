import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { decodeDocument } from "../src/model.ts";
import { tableDefinition } from "../src/table-definition.ts";

const examples = new URL("../examples/", import.meta.url);
const read = (file) =>
  decodeDocument(readFileSync(new URL(file, examples), "utf8"));
const day = new Date(2026, 0, 2, 0, 1);

for (const file of readdirSync(examples).filter((name) =>
  name.endsWith(".json"),
)) {
  test(`definition includes each table and column from ${file}`, () => {
    const doc = read(file);
    const md = tableDefinition(doc, "md");
    const records = tableDefinition(doc, "csv")
      .trimEnd()
      .split("\r\n")
      .slice(1);
    let row = 0;
    for (const table of doc.schema.tables) {
      const section = md
        .split("\n## " + table.name + "\n")[1]
        ?.split("\n## ")[0];
      assert.ok(section, table.name);
      for (const column of table.columns) {
        assert.ok(
          section.includes(
            `| ${column.name} | ${column.logicalName} | ${column.type} |`,
          ),
        );
        assert.ok(
          records[row++].includes(
            `,${table.name},${table.logicalName},${table.note ?? ""},${column.name},${column.logicalName},`,
          ),
        );
      }
    }
    assert.equal(row, records.length);
  });
}

function orders() {
  const doc = read("composite-keys.json");
  doc.title = "注文管理";
  const [accounts, orders] = doc.schema.tables;
  accounts.schemaName = "sales";
  orders.logicalName = "注文";
  orders.note = '受注, "履歴"';
  Object.assign(orders.columns[2], {
    notNull: true,
    logicalName: "顧客番号",
    defaultValue: "'A,B'",
    note: "顧客|番号\n<必須>",
  });
  Object.assign(orders.foreignKeys[0], {
    onDelete: "CASCADE",
    onUpdate: "RESTRICT",
  });
  return doc;
}

test("Markdown lists names in display order and documents composite keys, attributes and notes", () => {
  const doc = orders();
  const [accounts, order] = doc.schema.tables;
  Object.assign(accounts.columns[0], { type: "bigserial" });
  Object.assign(accounts.columns[1], {
    type: "int",
    identity: "always",
    identityOptions: "START WITH 10",
  });
  Object.assign(order.columns[1], { type: "int", identity: "byDefault" });
  const md = tableDefinition(doc, "md", true, day);
  for (const text of [
    "# 注文管理\n\n出力日：2026-01-02",
    "## 注文\n",
    "| 論理名 | 物理名 | 説明 |",
    '| 注文 | orders | 受注, "履歴" |',
    "| 顧客番号 | account_id | uuid |  | ○ | 'A,B' |  | sales.accounts.id | 顧客&#124;番号<br>&#60;必須&#62; |",
    "| orders_account_fk | tenant_id, account_id | sales.accounts.tenant_id, sales.accounts.id | CASCADE | RESTRICT |",
    "| インデックス | orders_lookup | account_id, created_at |",
    "| 一意制約 | accounts_email_unique | tenant_id, email |",
    "| bigserial | ○ |  |  | SERIAL |",
    "| IDENTITY ALWAYS (START WITH 10) |",
    "| IDENTITY BY DEFAULT |",
    "| categories_parent_fk | parent_id | categories.id |",
  ])
    assert.ok(md.includes(text), text);
});

test("CSV quotes multiline fields and aligns references, actions and index membership on a single column record", () => {
  const doc = orders();
  const order = doc.schema.tables[1];
  order.foreignKeys.push({
    id: "unresolved",
    name: "pending_fk",
    columnIds: [order.columns[2].id],
  });
  doc.schema.tables[0].note = "=SUM(1)";
  const csv = tableDefinition(doc, "csv", false, day);
  assert.deepEqual([...Buffer.from(csv).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(
    csv.startsWith(
      "\uFEFF図の名前,出力日,テーブル物理名,テーブル論理名,テーブル説明,カラム物理名,カラム論理名,型,PK,NN,既定値,自動採番,FK 参照先,カラム説明,外部キー名,ON DELETE,ON UPDATE,インデックス,一意制約,主キー,外部キーの順序\r\n",
    ),
  );
  assert.ok(
    csv.includes(
      `注文管理,2026-01-02,orders,注文,"受注, ""履歴""",account_id,顧客番号,uuid,,○,"'A,B'",,"sales.accounts.id\n未設定","顧客|番号\n<必須>","orders_account_fk\npending_fk","CASCADE\n","RESTRICT\n","orders_lookup (account_id, created_at)",,,"1.2\n2.1"\r\n`,
    ),
  );
  assert.ok(
    csv.includes(
      `sales.accounts,,'=SUM(1),tenant_id,,uuid,○,,,,,,,,,,"accounts_email_unique (tenant_id, email)","accounts_pk (tenant_id, id)",\r\n`,
    ),
  );
});

test("Markdown and CSV restore references between tables with the same physical name", async () => {
  const { importTableDefinition } =
    await import("../src/table-definition-import.ts");
  const { importDDL } = await import("../src/ddl-import.ts");
  const { documentFromDiagram } = await import("../src/model.ts");
  const { diagram } = importDDL(
    "CREATE TABLE auth.users(id int PRIMARY KEY); CREATE TABLE public.users(id int PRIMARY KEY REFERENCES auth.users(id));",
  );
  for (const format of ["md", "csv"]) {
    const text = tableDefinition(documentFromDiagram(diagram), format);
    assert.match(text, /auth\.users\.id/);
    const [auth, pub] = importTableDefinition(text).schema.tables;
    assert.deepEqual([auth.schemaName, pub.schemaName], ["auth", "public"]);
    assert.deepEqual(pub.foreignKeys[0].target, {
      tableId: auth.id,
      columnIds: [auth.columns[0].id],
    });
  }
});
