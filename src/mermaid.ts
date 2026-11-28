import type { Diagram, EntityRelation, Table } from "./types.ts";
import { columnAttributes } from "./model.ts";
import { typeName } from "./schema-constraints.ts";
import { childMaximum } from "./relationships.ts";

const encodeText = (text: string) =>
  text.replace(/[#"%\\\r\n`]/g, (ch) => `#${ch.charCodeAt(0)};`);
export const decodeText = (text: string) =>
  text.replace(/#(\d{1,7});/g, (token, n) =>
    Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : token,
  );
const quoted = (value: string) => `"${encodeText(value)}"`;
const word = (value: string) =>
  /^[\p{L}_][\p{L}\p{N}_.()[\],-]*$/u.test(value) &&
  !/^(PK|FK|UK)$/i.test(value)
    ? value
    : "`" + encodeText(value) + "`";

export function identifyingForeignKey(child: Table, columnIds: string[]) {
  return child.keys.some(
    (k) =>
      k.kind === "primary" && columnIds.every((id) => k.columnIds.includes(id)),
  );
}

export function diagramMermaid(diagram: Diagram) {
  const lines = diagram.title
    ? ["---", "title: " + JSON.stringify(diagram.title), "---", "erDiagram"]
    : ["erDiagram"];
  const qualified = diagram.tables.some((t) => t.schemaName);
  if (qualified) lines.push("    %% simple-er-qualified-names");
  const entityName = (t: Table) =>
    quoted(
      qualified
        ? typeName(t.schemaName ? [t.schemaName, t.name] : [t.name])
        : t.name,
    );
  if (diagram.enums?.length)
    lines.push("    %% simple-er-enums " + JSON.stringify(diagram.enums));
  const names = (t: Table, ids: string[]) =>
    ids.map((id) => t.columns.find((c) => c.id === id)!.name);
  for (const t of diagram.tables) {
    // Key names, grouping and column order have no equivalent in an attribute badge.
    if (
      t.keys.some((k) => k.name || k.kind === "index" || k.columnIds.length > 1)
    ) {
      const keys = t.keys.map((k) => ({
        kind: k.kind,
        name: k.name,
        columns: names(t, k.columnIds),
      }));
      lines.push("    %% simple-er-keys " + JSON.stringify(keys));
    }
    const entity =
      entityName(t) + (t.logicalName ? "[" + quoted(t.logicalName) + "]" : "");
    const columns = t.columns.flatMap((c) => {
      const attrs = columnAttributes(c);
      return Object.keys(attrs).length ? [{ name: c.name, ...attrs }] : [];
    });
    const block = t.columns.length > 0 || !!t.note || !!t.checks?.length;
    lines.push("    " + entity + (block ? " {" : ""));
    for (const c of t.columns) {
      const flags = [
        c.key.includes("PK") && "PK",
        c.key.includes("FK") && "FK",
        t.keys.some((k) => k.kind === "unique" && k.columnIds.includes(c.id)) &&
          "UK",
      ].filter(Boolean);
      lines.push(
        "        " +
          [
            word(c.type),
            word(c.name),
            flags.join(", "),
            c.logicalName && quoted(c.logicalName),
          ]
            .filter(Boolean)
            .join(" "),
      );
    }
    if (t.note || columns.length || t.checks?.length) {
      lines.push(
        "        %% simple-er-details " +
          JSON.stringify({ note: t.note, checks: t.checks, columns }),
      );
    }
    if (block) lines.push("    }");
  }
  function relation(from: Table, to: Table, r: EntityRelation) {
    lines.push(
      `    ${entityName(from)} ${r.from}${r.identifying ? "--" : ".."}${r.to} ${entityName(to)} : ${quoted(r.label)}`,
    );
  }
  for (const child of diagram.tables) {
    for (const fk of child.foreignKeys) {
      if (!fk.target) continue;
      const parent = diagram.tables.find((t) => t.id === fk.target!.tableId)!;
      const parentMin = fk.cardinality?.parentMinimum;
      const childMin = fk.cardinality?.childMinimum;
      const many = childMaximum(child, fk) === "many";
      lines.push(
        "    %% simple-er-fk " +
          JSON.stringify({
            name: fk.name,
            onDelete: fk.onDelete,
            onUpdate: fk.onUpdate,
            columns: names(child, fk.columnIds),
            references: names(parent, fk.target.columnIds),
            ...(parentMin === undefined && { unknownParentMinimum: true }),
            ...(childMin === undefined && { unknownChildMinimum: true }),
          }),
      );
      relation(parent, child, {
        from: parentMin === 1 ? "||" : "|o",
        to: many
          ? childMin === 1
            ? "|{"
            : "o{"
          : childMin === 1
            ? "||"
            : "o|",
        identifying: identifyingForeignKey(child, fk.columnIds),
        label: fk.label ?? "",
      });
    }
  }
  for (const edge of diagram.edges) {
    if (edge.entityRelation)
      relation(
        diagram.tables.find((t) => t.id === edge.from.table)!,
        diagram.tables.find((t) => t.id === edge.to.table)!,
        edge.entityRelation,
      );
  }
  return lines.join("\n") + "\n";
}
