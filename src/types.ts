export const ddlDialects = ["PostgreSQL", "MySQL", "SQLite"] as const;
export type DdlDialect = (typeof ddlDialects)[number];
export type Key = "" | "PK" | "FK" | "PK,FK";
/** Schema data: no key badges, row numbers or coordinates. */
export interface Column {
  id: string;
  name: string;
  type: string;
  notNull?: boolean;
  identity?: "always" | "byDefault";
  identityOptions?: string;
  defaultValue?: string;
  logicalName: string;
  note?: string;
}
export interface TableSchema {
  schemaName?: string;
  id: string;
  name: string;
  logicalName: string;
  note?: string;
  columns: Column[];
  keys: KeyDefinition[];
  foreignKeys: ForeignKey[];
}
export interface Schema {
  tables: TableSchema[];
}
export const tableColors = {
  blue: { label: "青", fill: "#dfeaf5", dark: "#24384c" },
  green: { label: "緑", fill: "#dcece3", dark: "#253c31" },
  yellow: { label: "黄", fill: "#f5edcf", dark: "#403821" },
  pink: { label: "桃", fill: "#f3e2e4", dark: "#463038" },
  purple: { label: "紫", fill: "#e9e3f3", dark: "#393147" },
} as const;
export type TableColor = keyof typeof tableColors;
export interface TableGroup {
  id: string;
  name: string;
  tableIds: string[];
}
export interface TablePosition {
  color?: TableColor;
  tableId: string;
  x: number;
  y: number;
}
export interface RoutePresentation {
  foreignKeyId: string;
  columnId: string;
  fromSide: "left" | "right";
  toSide: "left" | "right";
  trunk: number | null;
  manual: boolean;
}
export interface Presentation {
  groups?: TableGroup[];
  tables: TablePosition[];
  routes: RoutePresentation[];
}
/** The authoritative runtime state and version 3 file contract. */
export interface DiagramDocument {
  ddlDialect?: DdlDialect;
  format: "er-sketch";
  version: 3;
  title?: string;
  schema: Schema;
  presentation: Presentation;
  /** Table-to-table relationships, with their header anchors and route. */
  entityEdges?: Edge[];
  unresolvedEdges: Edge[];
}
export interface RenderColumn extends Column {
  key: Key;
}
/** Transient projection used by layout, canvas and editor drafts. */
export interface Table extends Omit<TableSchema, "columns"> {
  color?: TableColor;
  x: number;
  y: number;
  columns: RenderColumn[];
}
export interface Endpoint {
  table: string;
  row: number;
}
export interface Port extends Endpoint {
  side: "left" | "right";
}
export interface EntityRelation {
  from: "||" | "|o" | "}|" | "}o";
  to: "||" | "o|" | "|{" | "o{";
  identifying: boolean;
  label: string;
}
export interface Edge {
  entityRelation?: EntityRelation;
  id: string;
  foreignKeyId?: string;
  from: Port;
  to: Port;
  trunk: number | null;
  manual: boolean;
}
/** Derived editing/rendering projection; never the history or storage source of truth. */
export interface Diagram {
  ddlDialect?: DdlDialect;
  groups?: TableGroup[];
  schemaVersion?: 2;
  title?: string;
  unresolvedEdges?: Edge[];
  tables: Table[];
  edges: Edge[];
}
export interface Point {
  x: number;
  y: number;
}
export interface View extends Point {
  w: number;
  h: number;
  zoom: number;
}
export interface Candidate {
  from: Endpoint;
  to: Endpoint;
  label: string;
}
export interface Route {
  points: Point[];
  fromSide?: Port["side"];
  toSide?: Port["side"];
  handle?: {
    x: number;
    y: number;
    y1: number;
    y2: number;
    min: number;
    max: number;
  };
  detour?: boolean;
  blocked?: boolean;
}

export interface KeyDefinition {
  id: string;
  name: string;
  kind: "primary" | "unique" | "index";
  columnIds: string[];
}
export const referenceActions = [
  "NO ACTION",
  "RESTRICT",
  "CASCADE",
  "SET NULL",
  "SET DEFAULT",
] as const;
export type ReferenceAction = (typeof referenceActions)[number];
export interface ForeignKey {
  onDelete?: ReferenceAction;
  onUpdate?: ReferenceAction;
  id: string;
  name: string;
  columnIds: string[];
  target?: { tableId: string; columnIds: string[] };
  label?: string;
  cardinality?: { parentMinimum?: 0 | 1; childMinimum?: 0 | 1 };
}
