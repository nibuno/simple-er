export type Key = "" | "PK" | "FK" | "PK,FK";
/** Schema data: no key badges, row numbers or coordinates. */
export interface Column {
  id: string;
  name: string;
  type: string;
  logicalName: string;
}
export interface TableSchema {
  id: string;
  name: string;
  logicalName: string;
  columns: Column[];
  keys: KeyDefinition[];
  foreignKeys: ForeignKey[];
}
export interface Schema {
  tables: TableSchema[];
}
export interface TablePosition {
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
  tables: TablePosition[];
  routes: RoutePresentation[];
}
/** The authoritative runtime state and version 2 file contract. */
export interface DiagramDocument {
  format: "er-sketch";
  version: 2;
  schema: Schema;
  presentation: Presentation;
  unresolvedEdges: Edge[];
}
export interface RenderColumn extends Column {
  key: Key;
}
/** Transient projection used by layout, canvas and editor drafts. */
export interface Table extends Omit<TableSchema, "columns"> {
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
export interface Edge {
  id: string;
  foreignKeyId?: string;
  from: Port;
  to: Port;
  trunk: number | null;
  manual: boolean;
}
/** Derived editing/rendering projection; never the history or storage source of truth. */
export interface Diagram {
  schemaVersion?: 2;
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
export interface ForeignKey {
  id: string;
  name: string;
  columnIds: string[];
  target?: { tableId: string; columnIds: string[] };
  label?: string;
  cardinality?: { parentMinimum?: 0 | 1; childMinimum?: 0 | 1 };
}
