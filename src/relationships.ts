import type { Diagram, ForeignKey, Route, Table } from "./types.ts";
import { height, tableWidth } from "./geometry.ts";

// An FK is at most one-to-one only when its columns contain a unique key.
// A regular index does not establish uniqueness. Unknown minima stay unknown.
export function childMaximum(table: Table, fk: ForeignKey): "one" | "many" {
  return table.keys?.some(
    (k) =>
      k.kind !== "index" &&
      k.columnIds.length > 0 &&
      k.columnIds.every((id) => fk.columnIds.includes(id)),
  )
    ? "one"
    : "many";
}

export function labelLines(label: string) {
  const lines: string[] = [];
  let line = "",
    width = 0;
  for (const char of label.trim()) {
    const w = char.codePointAt(0)! > 255 ? 12 : 7;
    if (width + w > 156 || char === "\n") {
      lines.push(line);
      line = "";
      width = 0;
    }
    if (char !== "\n") {
      line += char;
      width += w;
    }
  }
  if (line) lines.push(line);
  return lines;
}
export function relationshipLabelWidth(label: string) {
  return (
    Math.max(
      0,
      ...labelLines(label).map((line) =>
        [...line].reduce((n, c) => n + (c.codePointAt(0)! > 255 ? 12 : 7), 0),
      ),
    ) + 12
  );
}
export type RelationshipLabel = {
  edgeId: string;
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
};

export function relationshipLabels(
  diagram: Diagram,
  routes: Map<string, Route>,
) {
  const result = new Map<string, RelationshipLabel>();
  const occupied = diagram.tables.map((t) => ({
    x: t.x - 6,
    y: t.y - 6,
    width: tableWidth(t) + 12,
    height: height(t) + 12,
  }));
  const overlaps = (
    a: (typeof occupied)[number],
    b: (typeof occupied)[number],
  ) =>
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
  const seen = new Set<string>();
  for (const edge of [...diagram.edges].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const child = diagram.tables.find((t) => t.id === edge.to.table)!;
    const fk = child.foreignKeys?.find((f) => f.id === edge.foreignKeyId);
    if (!fk?.label || seen.has(fk.id)) continue;
    seen.add(fk.id);
    const lines = labelLines(fk.label);
    const width = relationshipLabelWidth(fk.label);
    const h = lines.length * 16 + 4;
    const groupEdges = diagram.edges.filter((e) => e.foreignKeyId === fk.id);
    const candidates: (RelationshipLabel & { score: number })[] = [];
    for (const groupEdge of groupEdges) {
      const ps = routes.get(groupEdge.id)!.points;
      ps.slice(1).forEach((b, i) => {
        const a = ps[i],
          horizontal = a.y === b.y;
        const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        for (const side of [-1, 1])
          for (const fraction of horizontal ? [0.5, 0, 1] : [0.5]) {
            const x = horizontal
              ? fraction === 0.5
                ? (a.x + b.x - width) / 2
                : fraction === 0
                  ? Math.min(a.x, b.x) + 8
                  : Math.max(a.x, b.x) - width - 8
              : a.x + (side < 0 ? -width - 8 : 8);
            const y = horizontal
              ? a.y + (side < 0 ? -h - 5 : 5)
              : (a.y + b.y - h) / 2;
            const box = { x, y, width, height: h };
            const collisions = occupied.filter((o) => overlaps(box, o)).length;
            // Prefer a horizontal run with room for the label, then the shortest
            // distance from the middle of the relationship. Never alter routing.
            const score =
              collisions * 100000 +
              (horizontal ? 0 : 200) +
              Math.max(0, width + 56 - length) * 4 -
              Math.min(length, 500) * 0.1 +
              (side < 0 ? 0 : 2) +
              Math.abs(fraction - 0.5) * 20;
            candidates.push({ ...box, edgeId: groupEdge.id, lines, score });
          }
      });
    }
    candidates.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
    if (candidates[0]) {
      const chosen = candidates[0];
      result.set(chosen.edgeId, chosen);
      occupied.push(chosen);
    }
  }
  return result;
}
