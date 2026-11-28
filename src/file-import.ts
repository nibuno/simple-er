import { tableWidth } from "./geometry.ts";
import { uid, validateDiagram } from "./model.ts";
import { registerEnum } from "./schema-constraints.ts";
import type { Diagram } from "./types.ts";

export function erFormat(text: string, filename: string) {
  const start = text.trimStart();
  if (start.startsWith("{")) return "JSON";
  const mermaidSource = start
    .replace(/^---[^\S\n]*\r?\n[\s\S]*?\r?\n---[^\S\n]*\r?\n/, "")
    .trimStart();
  if (/^(?:%%[^\n]*\n\s*)*erDiagram\b/i.test(mermaidSource)) return "Mermaid";
  if (/^#\s/.test(start) && /^\| .*物理名/m.test(start))
    return "定義書（Markdown）";
  if (/^[^\n]*テーブル物理名[^\n]*,/u.test(start)) return "定義書（CSV）";
  if (
    /^(?:--|\/\*|#|\\|(?:create|alter|drop|comment|set|use|begin|pragma|insert|select|lock|start|copy|grant)\b)/i.test(
      start,
    )
  )
    return "DDL";
  if (/\.json$/i.test(filename)) return "JSON";
  if (/\.(mmd|mermaid)$/i.test(filename)) return "Mermaid";
  if (/\.csv$/i.test(filename)) return "定義書（CSV）";
  if (/\.md$/i.test(filename)) return "定義書（Markdown）";
  if (/\.(sql|ddl)$/i.test(filename)) return "DDL";
  return "";
}

// Keep the layout and manual routes as a unit. Separate files may reuse IDs.
export function appendDiagram(base: Diagram, incoming: Diagram): Diagram {
  const added = structuredClone(incoming);
  const tableIds = new Map(added.tables.map((t) => [t.id, uid()]));
  const foreignKeys = new Map<string, string>();
  const dx =
    base.tables.length && added.tables.length
      ? Math.max(...base.tables.map((t) => t.x + tableWidth(t))) +
        64 -
        Math.min(...added.tables.map((t) => t.x))
      : 0;
  for (const table of added.tables) {
    table.id = tableIds.get(table.id)!;
    table.x += dx;
    for (const key of table.keys) key.id = uid();
    for (const fk of table.foreignKeys) {
      const id = uid();
      foreignKeys.set(fk.id, id);
      fk.id = id;
      if (fk.target) fk.target.tableId = tableIds.get(fk.target.tableId)!;
    }
  }
  for (const group of added.groups ?? []) {
    group.id = uid();
    group.tableIds = group.tableIds.map((id) => tableIds.get(id)!);
  }
  for (const edge of [...added.edges, ...(added.unresolvedEdges ?? [])]) {
    edge.id = uid();
    for (const port of [edge.from, edge.to])
      port.table = tableIds.get(port.table) ?? port.table;
    if (edge.foreignKeyId)
      edge.foreignKeyId = foreignKeys.get(edge.foreignKeyId);
    if (edge.trunk !== null) edge.trunk += dx;
  }
  const enums = [...(base.enums ?? [])];
  for (const value of added.enums ?? []) registerEnum(enums, value);
  return validateDiagram({
    ...base,
    enums,
    tables: [...base.tables, ...added.tables],
    edges: [...base.edges, ...added.edges],
    groups: [...(base.groups ?? []), ...(added.groups ?? [])],
    unresolvedEdges: [
      ...(base.unresolvedEdges ?? []),
      ...(added.unresolvedEdges ?? []),
    ],
  });
}
