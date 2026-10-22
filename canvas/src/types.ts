export type Point = { x: number; y: number };
export type View = Point & { zoom: number };
export type NodeKind = "box" | "note" | "group";
export type NodeShape =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "cylinder"
  | "person"
  | "cloud"
  | "screen"
  | "document";
export interface CanvasNode extends Point {
  id: string;
  kind: NodeKind;
  shape: NodeShape;
  w: number;
  h: number;
  title: string;
  description: string;
  body: string;
  fillColor?: string;
  strokeColor?: string;
  // A small icon beside a box's name, one of NODE_ICONS.
  icon?: string;
  groupId?: string;
  attachedTo?: string;
}
export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  dashed: boolean;
  strokeColor?: string;
}
export interface CanvasDocument {
  format: "simple-canvas";
  version: 1;
  id: string;
  title: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
export interface History {
  present: CanvasDocument;
  past: CanvasDocument[];
  future: CanvasDocument[];
}
export type HistoryAction =
  | { type: "commit"; next: CanvasDocument; before?: CanvasDocument }
  | { type: "preview"; next: CanvasDocument }
  | { type: "reset"; next: CanvasDocument }
  | { type: "undo" | "redo" };
export type Tool = "select" | "connect" | "pan";
