import type { DiagramDocument } from "./types.ts";
import { reduceHistory } from "../shared/history.ts";
import type {
  History as SharedHistory,
  Action as SharedAction,
} from "../shared/history.ts";
export type History = SharedHistory<DiagramDocument>;
export type Action = SharedAction<DiagramDocument>;
export const historyReducer = (state: History, action: Action): History =>
  reduceHistory(state, action, 60);
