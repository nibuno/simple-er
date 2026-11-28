import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { importDDL } from "../src/ddl-import.ts";
import { decode, encode } from "../src/model.ts";
import { diagramDDL } from "../src/ddl.ts";

test("pg_dump settings, sequence ownership, identity, comments, and btree indexes", () => {
  const { diagram, issues, ignoredCount } = importDDL(String.raw`\restrict token
CREATE SCHEMA sales;
CREATE TABLE sales.items(id integer NOT NULL, code integer, amount integer);
CREATE SEQUENCE sales.items_id_seq AS integer;
ALTER SEQUENCE sales.items_id_seq OWNER TO postgres;
ALTER SEQUENCE sales.items_id_seq OWNED BY sales.items.id;
ALTER TABLE ONLY sales.items ALTER COLUMN id SET DEFAULT nextval('sales.items_id_seq'::regclass);
SET client_encoding = 'UTF8';
SELECT pg_catalog.set_config('search_path', '', false);
ALTER TABLE sales.items OWNER TO postgres;
COMMENT ON SCHEMA sales IS 'sales';
COMMENT ON COLUMN sales.items.code IS '商品';
ALTER TABLE ONLY sales.items ADD CONSTRAINT items_pkey PRIMARY KEY(id);
ALTER TABLE sales.items ALTER COLUMN amount ADD GENERATED ALWAYS AS IDENTITY (START WITH 5);
CREATE UNIQUE INDEX ux ON ONLY sales.items USING btree (code, amount);
CREATE INDEX ix ON sales.items USING btree (amount);
COPY sales.items (id, code, amount) FROM stdin;
1 bad;text ' -- not SQL
\.
\unrestrict token`);
  assert.deepEqual(issues, []);
  assert.equal(ignoredCount, 11);
  const [table] = diagram.tables;
  assert.equal(table.columns[0].type, "serial");
  assert.equal(table.columns[1].logicalName, "商品");
  assert.equal(table.columns[2].identityOptions, "START WITH 5");
  assert.deepEqual(
    table.keys.map((k) => [k.kind, k.name]),
    [
      ["primary", "items_pkey"],
      ["unique", "ux"],
      ["index", "ix"],
    ],
  );
  const invalid = importDDL(
    "CREATE TABLE t (s text);\nCREATE INDEX ix ON t USING gin (s);\nCREATE INDEX ix2 ON t(s) WHERE s IS NULL;",
  );
  assert.deepEqual(
    invalid.issues.map((i) => i.line),
    [2, 3],
  );
  assert.match(invalid.issues[0].message, /CREATE INDEX/);
  assert.equal(invalid.diagram.tables[0].keys.length, 0);
});

test("mysqldump USE applies to both tables and later ALTER statements", () => {
  const r = importDDL(
    "/*!40101 SET NAMES utf8mb4 */; CREATE DATABASE IF NOT EXISTS parentdb; USE parentdb; DROP TABLE IF EXISTS p; CREATE TABLE p(id INT PRIMARY KEY); USE childdb; CREATE TABLE c(p INT, KEY ix USING BTREE (p)); ALTER TABLE c ADD CONSTRAINT fk FOREIGN KEY(p) REFERENCES parentdb.p(id); LOCK TABLES c WRITE; INSERT INTO c VALUES(1); UNLOCK TABLES;",
  );
  assert.deepEqual(r.issues, []);
  assert.equal(r.ignoredCount, 6);
  assert.deepEqual(
    r.diagram.tables.map((t) => t.schemaName),
    ["parentdb", "childdb"],
  );
  assert.equal(
    r.diagram.tables[1].foreignKeys[0].target.tableId,
    r.diagram.tables[0].id,
  );
  assert.equal(r.diagram.tables[1].keys[0].name, "ix");
});

test("sqlite3 .schema internal tables are skipped and the user's indexes are kept", () => {
  const r = importDDL(
    "CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT); CREATE TABLE sqlite_sequence(name,seq); CREATE INDEX IF NOT EXISTS idx_notes ON notes(v);",
  );
  assert.deepEqual(r.issues, []);
  assert.equal(r.ignoredCount, 1);
  assert.equal(r.tableCount, 1);
  assert.equal(r.diagram.tables[0].keys[1].name, "idx_notes");
});

test("defaults and CHECK operands translate and round-trip without modifying literals", () => {
  const { diagram } = importDDL(
    "CREATE TABLE results (rank INT CHECK (rank BETWEEN 1 AND 5), note VARCHAR(40) CHECK (lower(note) <> 'rank'), created TIMESTAMP DEFAULT now(), n INT DEFAULT abs(-4));",
  );
  const sqlite = diagramDDL({ ...diagram, ddlAnnotations: true }, "SQLite");
  const mysql = diagramDDL({ ...diagram, ddlAnnotations: true }, "MySQL");
  assert.match(mysql, /CHECK \(`rank` BETWEEN 1 AND 5\)/);
  assert.match(mysql, /lower\(`note`\) <> 'rank'/);
  assert.match(sqlite, /DEFAULT CURRENT_TIMESTAMP/);
  assert.match(sqlite, /DEFAULT \(abs\(-4\)\)/);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(sqlite);
    db.exec("INSERT INTO results(rank) VALUES(1)");
    assert.equal(db.prepare("SELECT n FROM results").get().n, 4);
    assert.throws(
      () => db.exec("INSERT INTO results(rank) VALUES(6)"),
      /CHECK/,
    );
  } finally {
    db.close();
  }
  for (const sql of [mysql, sqlite])
    assert.equal(
      diagramDDL(importDDL(sql).diagram, "PostgreSQL"),
      diagramDDL(diagram, "PostgreSQL"),
    );
  const edited = sqlite.replace(
    "DEFAULT CURRENT_TIMESTAMP",
    "DEFAULT CURRENT_DATE",
  );
  assert.equal(
    importDDL(edited).diagram.tables[0].columns[2].defaultValue,
    "CURRENT_DATE",
  );
});

test("export reports the table and column for untranslatable types and expressions", () => {
  for (const [column, type, dialect] of [
    ["tags", "text[]", "MySQL"],
    ["tags", "integer[]", "SQLite"],
    ["geog", "geography", "MySQL"],
    ["id", "uuid DEFAULT gen_random_uuid()", "SQLite"],
  ]) {
    const { diagram } = importDDL(`CREATE TABLE events (${column} ${type});`);
    assert.throws(
      () => diagramDDL(diagram, dialect),
      new RegExp("events\\." + column + ".*" + dialect),
    );
  }
});

test("a database switch keeps same-name tables and existing groups distinct", () => {
  const { diagram: base } = importDDL(
    "USE accounts; CREATE TABLE users(id int PRIMARY KEY);",
  );
  const account = base.tables[0];
  base.groups = [
    { id: "existing-group", name: "会員", tableIds: [account.id] },
  ];
  const { diagram, issues } = importDDL(
    "USE sales; CREATE TABLE users(id int PRIMARY KEY, account_id int REFERENCES accounts.users(id)); CREATE INDEX sales_account ON users USING btree(account_id); USE accounts; COMMENT ON TABLE users IS '会員';",
    base,
  );
  assert.deepEqual(issues, []);
  const restored = decode(encode(diagram));
  const [accounts, sales] = restored.tables;
  assert.equal(accounts.logicalName, "会員");
  assert.deepEqual(restored.groups[0].tableIds, [accounts.id]);
  assert.equal(sales.foreignKeys[0].target.tableId, accounts.id);
  assert.deepEqual(
    accounts.keys.map((k) => k.kind),
    ["primary"],
  );
  assert.equal(sales.keys[1].name, "sales_account");
  for (const dialect of ["MySQL", "PostgreSQL"]) {
    const again = importDDL(diagramDDL(restored, dialect));
    assert.deepEqual(again.issues, []);
    const [a, s] = again.diagram.tables;
    assert.equal(s.foreignKeys[0].target.tableId, a.id);
    assert.equal(s.keys[1].name, "sales_account");
    assert.equal(a.logicalName, "会員");
  }
});
