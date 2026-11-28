import { messageOf } from "./utils.ts";
import { decodeText, identifyingForeignKey } from "./mermaid.ts";
import { columnAttributes, readNote, MAX_COLUMNS, uid } from "./model.ts";
import { childMaximum } from "./relationships.ts";
import { layoutImportedTables } from "./import-layout.ts";
import { referenceActions } from "./types.ts";
import type {
  Diagram,
  EntityRelation,
  ForeignKey,
  KeyDefinition,
  Table,
} from "./types.ts";

const entity = String.raw`("[^"]+"|[\p{L}\p{N}_.*-]+)`;
const declaration = new RegExp(
  `^${entity}` + String.raw`(?:\s*\[\s*${entity}\s*\])?\s*(?:\{(.*))?$`,
  "u",
);
// Mermaid also accepts words in place of crow's-foot symbols.
const cardinalities = {
  "zero or one": ["|o", "o|"],
  "one or zero": ["|o", "o|"],
  one: ["||", "||"],
  "only one": ["||", "||"],
  "1": ["||", "||"],
  "one or more": ["}|", "|{"],
  "one or many": ["}|", "|{"],
  "1+": ["}|", "|{"],
  "many(1)": ["}|", "|{"],
  "zero or more": ["}o", "o{"],
  "zero or many": ["}o", "o{"],
  "0+": ["}o", "o{"],
  "many(0)": ["}o", "o{"],
  many: ["}o", "o{"],
} as const;
const aliases = Object.keys(cardinalities)
  .map((key) => key.replace(/[()+]/g, "\\$&"))
  .join("|");
const relationship = new RegExp(
  `^${entity}` +
    String.raw`\s*([|}][|o]|${aliases})\s*(--|\.\.|-\.|\.-|optionally to|to)\s*([|o][|{]|${aliases})\s*${entity}\s*:\s*("[^"]*"|[^"\s]+)$`,
  "iu",
);
const attribute =
  /(`[^`]+`|[\p{L}_*][\p{L}\p{N}_.*()[\],~-]*)\s+(`[^`]+`|[\p{L}_*][\p{L}\p{N}_.*()[\],~-]*)(?:\s+((?:PK|FK|UK)\b(?:\s*,\s*(?:PK|FK|UK)\b)*))?(?:\s+"([^"]*)")?(?=\s|$)\s*/iuy;
const unquote = (s: string) =>
  s.startsWith('"') || s.startsWith("`") ? decodeText(s.slice(1, -1)) : s;
function bad(message: string): never {
  throw new Error(message);
}

interface Hint {
  line: number;
  kind: string;
  text: string;
}
interface RelationLine {
  line: number;
  from: string;
  to: string;
  relation: EntityRelation;
  hint?: Hint;
}
function idsFor(table: Table, names: unknown): string[] {
  if (
    !Array.isArray(names) ||
    !names.length ||
    new Set(names).size !== names.length
  )
    return bad("補足コメントのカラム指定が不正です。");
  return names.map(
    (name) =>
      table.columns.find((c) => c.name === name)?.id ??
      bad("補足コメントのカラムが見つかりません。"),
  );
}
function restoreDetails(table: Table, text: string) {
  const data = JSON.parse(text);
  const note = readNote(data.note);
  if (
    !Array.isArray(data.columns) ||
    data.columns.length > table.columns.length
  )
    bad("カラムの補足コメントが不正です。");
  const changes = new Map<
    Table["columns"][number],
    ReturnType<typeof columnAttributes>
  >();
  for (const item of data.columns) {
    const column = table.columns.find((c) => c.name === item.name);
    if (!column || changes.has(column)) bad("補足コメントのカラムが不正です。");
    changes.set(column, columnAttributes({ ...item, type: column.type }));
  }
  Object.assign(table, note);
  for (const [column, attrs] of changes) Object.assign(column, attrs);
}
function restoreKeys(table: Table, hint: Hint) {
  const data = JSON.parse(hint.text);
  if (!Array.isArray(data) || data.length > 200)
    bad("キーの補足コメントが不正です。");
  const keys: KeyDefinition[] = data.map(
    (k: KeyDefinition & { columns: string[] }) => {
      if (
        !k ||
        !["primary", "unique", "index"].includes(k.kind) ||
        typeof k.name !== "string" ||
        k.name.length > 80
      )
        bad("キーの補足コメントが不正です。");
      return {
        id: uid(),
        kind: k.kind,
        name: k.name,
        columnIds: idsFor(table, k.columns),
      };
    },
  );
  if (keys.filter((k) => k.kind === "primary").length > 1)
    bad("主キーが重複しています。");
  for (const c of table.columns)
    for (const kind of ["primary", "unique"]) {
      const has = (list: KeyDefinition[]) =>
        list.some((k) => k.kind === kind && k.columnIds.includes(c.id));
      if (has(keys) !== has(table.keys))
        bad("キーの補足コメントと属性が一致しません。");
    }
  if (keys.length + table.foreignKeys.length > 200)
    bad("制約は200件までです。");
  table.keys = keys;
}

export function importMermaid(
  source: string,
  base: Diagram = { tables: [], edges: [] },
) {
  const next = structuredClone(base);
  const added: Table[] = [];
  const issues: { line: number; message: string }[] = [];
  const report = (line: number, message: string) =>
    issues.push({ line, message });
  const lines = source.split(/\r\n?|\n/);
  const relations: RelationLine[] = [];
  const keys = new Map<Table, Hint>();
  const declared = new Set<string>();
  const skipped = new Set<string>();
  if (source.length > 2_000_000) bad("Mermaid は2MBまで読み込めます。");
  let header = false,
    hint: Hint | undefined;
  let block: { line: number; table?: Table } | undefined;

  function tableFor(name: string) {
    const found = next.tables.find((t) => t.name === name);
    if (found) return found;
    if (!name.trim() || name !== name.trim() || name.length > 80)
      return bad("テーブル名は80文字以内で指定してください。");
    if (next.tables.some((t) => t.name.toLowerCase() === name.toLowerCase()))
      return bad(`${name} はすでにあります。`);
    if (next.tables.length >= 40) return bad("テーブルは40個までです。");
    const table: Table = {
      id: uid(),
      name,
      logicalName: "",
      x: 0,
      y: 0,
      columns: [],
      keys: [],
      foreignKeys: [],
    };
    added.push(table);
    next.tables.push(table);
    return table;
  }
  // Mermaid optionally puts YAML front matter before the diagram header.
  const first = lines.findIndex((line) => line.trim() !== "");
  const frontEnd =
    lines[first]?.trim() === "---"
      ? lines.findIndex((line, i) => i > first && line.trim() === "---")
      : -1;
  for (const [index, raw] of lines.entries()) {
    if (index <= frontEnd) continue;
    const line = index + 1,
      text = raw.trim();
    if (!text) continue;
    if (text.startsWith("%% simple-er-details ")) {
      if (block?.table) {
        try {
          restoreDetails(
            block.table,
            text.slice("%% simple-er-details ".length),
          );
        } catch {
          report(line, "テーブルとカラムの補足コメントを省きました。");
        }
      }
      continue;
    }
    if (text.startsWith("%%")) {
      const note = /^%% simple-er-(keys|fk) (.+)$/.exec(text);
      if (note) hint = { line, kind: note[1], text: note[2] };
      continue;
    }
    const note = hint;
    hint = undefined;
    try {
      if (!header) {
        if (!/^erDiagram$/i.test(text)) {
          report(line, "先頭に erDiagram を書いてください。");
          break;
        }
        header = true;
        continue;
      }
      if (block) {
        if (text === "}") {
          block = undefined;
          continue;
        }
        if (
          !relationship.test(text) &&
          declaration.exec(text)?.[3] === undefined
        ) {
          const table = block.table;
          const closes = text.endsWith("}");
          if (closes) block = undefined;
          if (table)
            readAttributes(table, closes ? text.slice(0, -1).trim() : text);
          continue;
        }
        report(block.line, "属性の末尾に } がありません。");
        block = undefined;
      }
      if (/^direction\s+(TB|BT|LR|RL)$/i.test(text)) continue;
      const rel = relationship.exec(text);
      if (rel) {
        const label = unquote(rel[6]);
        if (label.length > 80)
          bad("関係ラベルは80文字以内で指定してください。");
        const left =
          cardinalities[rel[2].toLowerCase() as keyof typeof cardinalities];
        const right =
          cardinalities[rel[4].toLowerCase() as keyof typeof cardinalities];
        relations.push({
          line,
          from: unquote(rel[1]),
          to: unquote(rel[5]),
          hint: note?.kind === "fk" ? note : undefined,
          relation: {
            from: left?.[0] ?? (rel[2].toLowerCase() as EntityRelation["from"]),
            to: right?.[1] ?? (rel[4].toLowerCase() as EntityRelation["to"]),
            identifying: rel[3] === "--" || rel[3].toLowerCase() === "to",
            label,
          },
        });
        continue;
      }
      const decl = declaration.exec(text);
      if (!decl) bad("エンティティまたはリレーションを読み取れません。");
      const name = unquote(decl[1]),
        body = decl[3]?.trim();
      const opens = body !== undefined && !body.endsWith("}");
      if (opens) block = { line };
      if (
        declared.has(name) ||
        base.tables.some((t) => t.name.toLowerCase() === name.toLowerCase())
      ) {
        if (!declared.has(name)) skipped.add(name);
        bad(`${name} はすでにあります。`);
      }
      const alias = decl[2] ? unquote(decl[2]) : "";
      if (alias.length > 80) bad("論理名は80文字以内で指定してください。");
      const table = tableFor(name);
      declared.add(name);
      table.logicalName = alias;
      if (note?.kind === "keys") keys.set(table, note);
      if (opens) block = { line, table };
      const attr = opens ? body : body?.slice(0, -1).trim();
      if (attr) readAttributes(table, attr);
    } catch (e) {
      report(line, messageOf(e));
    }
  }
  if (block) report(block.line, "属性の末尾に } がありません。");
  for (const [table, note] of keys) {
    try {
      restoreKeys(table, note);
    } catch {
      report(note.line, "キーの補足コメントを省きました。");
    }
  }
  // Bare FK badges are unbound. Only an explicit column mapping establishes an SQL reference.
  const mapped = new Set<string>();
  let count = base.edges.length;
  for (const { line, from, to, relation, hint } of relations) {
    const previousCount = added.length;
    try {
      if (count >= 200) bad("接続は200本までです。");
      if (skipped.has(from) || skipped.has(to))
        bad("重複したテーブルのリレーションを省きました。");
      const parent = tableFor(from),
        child = tableFor(to);
      if (hint) {
        try {
          if (!added.includes(child))
            bad("既存のテーブルの外部キーは変更できません。");
          count += restoreForeignKey(
            parent,
            child,
            relation,
            hint,
            mapped,
            200 - count,
          );
          continue;
        } catch {
          report(
            hint.line,
            "外部キーの補足コメントを省き、テーブル間の線として読み込みます。",
          );
        }
      }
      next.edges.push({
        id: uid(),
        from: { table: parent.id, row: -1, side: "right" },
        to: { table: child.id, row: -1, side: "left" },
        entityRelation: relation,
        trunk: null,
        manual: false,
      });
      count++;
    } catch (e) {
      // Neither endpoint of a rejected relationship should create an orphan entity.
      while (added.length > previousCount) {
        added.pop();
        next.tables.pop();
      }
      report(line, messageOf(e));
    }
  }
  for (const t of added)
    t.foreignKeys = t.foreignKeys.filter((f) => !mapped.has(f.id));
  return {
    diagram: layoutImportedTables(next, added, base),
    tableCount: added.length,
    applied: added.length + count - base.edges.length,
    issues: issues.sort((a, b) => a.line - b.line),
  };
}

function readAttributes(t: Table, text: string) {
  attribute.lastIndex = 0;
  while (attribute.lastIndex < text.length) {
    const match = attribute.exec(text);
    if (!match) return bad("属性は「型 カラム名」の順に書いてください。");
    addAttribute(t, match);
  }
}
function addAttribute(t: Table, match: RegExpExecArray) {
  const type = unquote(match[1]),
    rawName = unquote(match[2]);
  const star = match[2].startsWith("*");
  const name = star ? rawName.slice(1) : rawName;
  const comment = decodeText(match[4] ?? "");
  if (
    !name.trim() ||
    name.trim() !== name ||
    !type.trim() ||
    name.length > 80 ||
    type.length > 40
  )
    return bad("カラム名は80文字、型は40文字までです。");
  if (t.columns.some((c) => c.name.toLowerCase() === name.toLowerCase()))
    return bad(`${name} が重複しています。`);
  if (t.columns.length >= MAX_COLUMNS) return bad("カラムは60個までです。");
  const flags = (match[3] ?? "").toUpperCase().split(/\s*,\s*/);
  const id = uid();
  t.columns.push({
    id,
    name,
    type,
    logicalName: comment.length <= 80 ? comment : "",
    ...(comment.length > 80 && { note: comment }),
    key: "",
  });
  if (star || flags.includes("PK")) {
    const pk = t.keys.find((k) => k.kind === "primary");
    if (pk) pk.columnIds.push(id);
    else t.keys.push({ id: uid(), kind: "primary", name: "", columnIds: [id] });
  }
  if (flags.includes("UK"))
    t.keys.push({ id: uid(), kind: "unique", name: "", columnIds: [id] });
  if (flags.includes("FK"))
    t.foreignKeys.push({ id: uid(), name: "", columnIds: [id] });
}

function restoreForeignKey(
  parent: Table,
  child: Table,
  relation: EntityRelation,
  hint: Hint,
  mapped: Set<string>,
  remaining: number,
) {
  const data = JSON.parse(hint.text);
  const columnIds = idsFor(child, data.columns),
    references = idsFor(parent, data.references);
  const pending = child.foreignKeys.filter(
    (f) => !f.target && columnIds.includes(f.columnIds[0]),
  );
  if (
    relation.identifying !== identifyingForeignKey(child, columnIds) ||
    relation.from.startsWith("}") ||
    typeof data.name !== "string" ||
    data.name.length > 80 ||
    [data.onDelete, data.onUpdate].some(
      (action) => action !== undefined && !referenceActions.includes(action),
    ) ||
    references.length !== columnIds.length ||
    columnIds.some((id) => !pending.some((f) => f.columnIds.includes(id))) ||
    !parent.keys.some(
      (k) =>
        k.kind !== "index" &&
        JSON.stringify(k.columnIds) === JSON.stringify(references),
    ) ||
    columnIds.length > remaining ||
    child.keys.length +
      child.foreignKeys.filter((f) => !mapped.has(f.id) && !pending.includes(f))
        .length >=
      200
  )
    bad("外部キーの補足コメントと定義が一致しません。");
  const fk: ForeignKey = {
    id: uid(),
    name: data.name,
    ...(data.onDelete && { onDelete: data.onDelete }),
    ...(data.onUpdate && { onUpdate: data.onUpdate }),
    columnIds,
    target: { tableId: parent.id, columnIds: references },
  };
  if ((childMaximum(child, fk) === "many") !== relation.to.endsWith("{"))
    bad("関係の最大数が一致しません。");
  const parentMinimum = relation.from.includes("o") ? 0 : 1,
    childMinimum = relation.to.includes("o") ? 0 : 1;
  const cardinality = {
    ...(!(data.unknownParentMinimum && parentMinimum === 0) && {
      parentMinimum,
    }),
    ...(!(data.unknownChildMinimum && childMinimum === 0) && { childMinimum }),
  } as ForeignKey["cardinality"];
  if (cardinality && Object.keys(cardinality).length)
    fk.cardinality = cardinality;
  if (relation.label) fk.label = relation.label;
  child.foreignKeys.push(fk);
  pending.forEach((f) => mapped.add(f.id));
  return columnIds.length;
}
