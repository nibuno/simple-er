import { canvasCatalog } from "../../shared/diagram-catalog.ts";
import { createDiagramLibrary } from "../../shared/diagram-library.ts";
import type { OpenDiagram as SharedDiagram } from "../../shared/diagram-library.ts";
import type { CanvasDocument } from "./types";
export { checkDiagram, DiagramChanged } from "../../shared/diagram-library.ts";
export type { DiagramEntry } from "../../shared/diagram-library.ts";
export type OpenDiagram = SharedDiagram<CanvasDocument>;
import {
  decode,
  emptyDocument,
  growNodes,
  sampleDocument,
  STORAGE_KEY,
  VIEW_KEY,
} from "./model";

export const viewKeyFor = (key: string) =>
  VIEW_KEY + key.slice(STORAGE_KEY.length);
export const library = createDiagramLibrary({
  catalog: canvasCatalog,
  activeKey: "simple-canvas.active.v1",
  decode,
  emptyDocument,
  firstDocument: () => growNodes(sampleDocument()),
  removeView: (key) => localStorage.removeItem(viewKeyFor(key)),
});
export const {
  isDiagramKey,
  listDiagrams,
  newDiagramKey,
  openDiagram,
  restoreDiagram,
  rememberDiagram,
  writeDiagram,
  removeDiagram,
} = library;
