import type {
  Column,
  TableSchema,
  Schema,
  Presentation,
  Diagram,
  DiagramDocument,
} from "../src/types.ts";
import { historyReducer } from "../src/history.ts";
import type { History } from "../src/history.ts";

declare const column: Column;
declare const table: TableSchema;
declare const schema: Schema;
declare const presentation: Presentation;
declare const view: Diagram;
declare const document: DiagramDocument;
declare const history: History;

// @ts-expect-error The schema column cannot be accessed as a legacy tuple.
column[0];
// @ts-expect-error PK/FK is a rendering badge, not column schema data.
column.key;
// @ts-expect-error Table coordinates belong to presentation.
table.x;
// @ts-expect-error Definition data does not own routes.
schema.routes;
// @ts-expect-error Presentation does not own column definitions.
presentation.tables[0].columns;
// @ts-expect-error Derived edges are not authoritative document state.
document.edges;
// @ts-expect-error History accepts only canonical documents.
historyReducer(history, { type: "commit", next: view });
historyReducer(history, { type: "commit", next: document });
