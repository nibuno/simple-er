import { escapeXml, filename } from "../shared/export.ts";
import {
  diagramBounds,
  groupFrames,
  HEADER,
  height,
  rounded,
  routeEdges,
  ROW,
  tableWidth,
} from "./geometry.ts";
import { columnMarks } from "./column-attributes.ts";
import { tableColors } from "./types.ts";
import { title } from "./model.ts";
import {
  cardinalityMarker,
  relationshipEnds,
  relationshipLabels,
} from "./relationships.ts";
import type { Column, Diagram, Point, Port, Table } from "./types.ts";

export function localDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function exportFilename(title?: string, date = new Date()) {
  return filename(title ?? "", `simple-er-${localDate(date)}`);
}

export function titleFromFile(name: string) {
  const stem = name.replace(/\.json$/i, "");
  return /^(simple-er|er-sketch)-\d{4}-\d{2}-\d{2}$/.test(stem)
    ? undefined
    : stem;
}

function tableSvg(
  table: Table,
  tableName: string,
  columnName: (c: Column) => string,
) {
  const w = tableWidth(table);
  const rows = table.columns
    .map((column, index) => {
      const y = HEADER + index * ROW;
      const marks = columnMarks(column, table);
      const both = column.key === "PK,FK";
      const badge = column.key
        ? `
      <rect x="9" y="${y + ROW / 2 - 8}" width="${both ? 26 : 24}" height="16" rx="4" fill="${column.key === "FK" ? "#dbeafe" : "#fef3c7"}"/>
      <text x="${both ? 22 : 21}" y="${y + ROW / 2 + 3.5}" text-anchor="middle" font-size="10" font-weight="600" fill="${column.key === "PK" ? "#92400e" : "#1e40af"}">${both ? "P/F" : column.key}</text>`
        : "";
      return `${badge}
      <text x="41" y="${y + 24}" font-size="14">${escapeXml(columnName(column))}</text>
      <text x="${w - 14}" y="${y + (marks ? 17 : 24)}" text-anchor="end" font-size="12" fill="#52525b">${escapeXml(column.type)}</text>
      ${marks ? `<text x="${w - 14}" y="${y + 31}" text-anchor="end" font-size="10" fill="#52525b">${marks}</text>` : ""}`;
    })
    .join("");
  return `<g transform="translate(${table.x} ${table.y})">
    <rect width="${w}" height="${height(table)}" rx="9" fill="#fff" stroke="#a1a1aa"/>
    <path d="M9 1H${w - 9}Q${w - 1} 1 ${w - 1} 9V${HEADER}H1V9Q1 1 9 1" fill="${table.color ? tableColors[table.color].fill : "#f4f4f5"}"/>
    <path d="M1 ${HEADER}H${w - 1}" stroke="#d4d4d8"/>
    ${table.checks?.length ? `<text x="${w - 16}" y="31" text-anchor="end" font-size="11" fill="#52525b">CHECK ${table.checks.length}</text>` : ""}
    ${table.schemaName ? `<text x="16" y="17" font-size="11" fill="#52525b">${escapeXml(table.schemaName)}.</text>` : ""}
    <text x="16" y="${table.schemaName ? 38 : 31}" font-weight="600" font-size="16">${escapeXml(tableName)}</text>${rows}
  </g>`;
}

function markerSvg(
  point: Point,
  side: Port["side"],
  maximum: "one" | "many",
  minimum?: 0 | 1,
) {
  const { transform, path } = cardinalityMarker(point, side, maximum, minimum);
  const circle =
    minimum === 0 ? '<circle cx="23" cy="0" r="3.5" fill="#fff"/>' : "";
  return `<g transform="${transform}" fill="none" stroke="#71717a" stroke-width="1.5"><path d="${path}"/>${circle}</g>`;
}

export function diagramSvg(
  state: Diagram,
  tableName = title,
  columnName = (c: Column) => c.name,
  routes = routeEdges(state.edges, state.tables),
) {
  const labels = relationshipLabels(state, routes);
  const frames = groupFrames(state);
  const bounds = diagramBounds(state.tables, routes.values(), [
    ...labels.values(),
    ...frames,
  ]);
  const surrounds = frames
    .map(
      (f) => `<g transform="translate(${f.x} ${f.y})">
    <rect width="${f.width}" height="${f.height}" rx="8" fill="none" stroke="#a1a1aa" stroke-dasharray="5 4"/>
    <text x="14" y="25" font-size="14" fill="#52525b">${escapeXml(f.group.name)}</text></g>`,
    )
    .join("");
  const pad = 48,
    x = bounds.x - pad,
    y = bounds.y - pad;
  const width = Math.ceil(bounds.width + pad * 2),
    height = Math.ceil(bounds.height + pad * 2);
  const wires = state.edges
    .map((edge) => {
      const route = routes.get(edge.id)!;
      const child = state.tables.find((t) => t.id === edge.to.table)!;
      const relation = relationshipEnds(edge, child);
      const ends = relation
        ? markerSvg(
            route.points[0],
            route.fromSide ?? edge.from.side,
            relation.from.maximum,
            relation.from.minimum,
          ) +
          markerSvg(
            route.points.at(-1)!,
            route.toSide ?? edge.to.side,
            relation.to.maximum,
            relation.to.minimum,
          )
        : "";
      const label = labels.get(edge.id);
      const caption = label
        ? `<g transform="translate(${label.x} ${label.y})">
      <rect width="${label.width}" height="${label.height}" rx="3" fill="#fff" stroke="#d4d4d8"/>
      ${label.lines.map((line, i) => `<text x="${label.width / 2}" y="${14 + i * 16}" text-anchor="middle" font-size="12">${escapeXml(line)}</text>`).join("")}
    </g>`
        : "";
      return `<path d="${rounded(route.points)}"${edge.entityRelation?.identifying === false ? ' stroke-dasharray="5 4"' : ""} fill="none" stroke="#71717a" stroke-width="1.5"/>${ends}${caption}`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">
    <title>${escapeXml(state.title || "SimpleER")}</title>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fff"/>
    <g fill="#18181b" font-family="ui-monospace,Menlo,Consolas,monospace">${surrounds}${wires}${state.tables.map((t) => tableSvg(t, tableName(t), columnName)).join("")}</g>
  </svg>`;
}
