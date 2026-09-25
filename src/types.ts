export type Key = "" | "PK" | "FK" | "PK,FK";
export type Column = [
  name: string,
  type: string,
  key: Key,
  id?: string,
  logicalName?: string,
];
export interface Table {
  id: string;
  name?: string;
  logicalName?: string;
  x: number;
  y: number;
  columns: Column[];
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
  from: Port;
  to: Port;
  trunk: number | null;
  manual: boolean;
}
export interface Diagram {
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
