import type { Diagram } from "./types.ts";
export interface History {
  present: Diagram;
  past: Diagram[];
  future: Diagram[];
}
export type Action =
  | { type: "commit"; next: Diagram; before?: Diagram }
  | { type: "preview"; next: Diagram }
  | { type: "undo" | "redo" };
export function historyReducer(state: History, action: Action): History {
  if (action.type === "preview") return { ...state, present: action.next };
  if (action.type === "commit") {
    const before = action.before ?? state.present;
    if (JSON.stringify(before) === JSON.stringify(action.next))
      return { ...state, present: action.next };
    return {
      present: action.next,
      past: [...state.past, before].slice(-60),
      future: [],
    };
  }
  if (action.type === "undo") {
    if (!state.past.length) return state;
    return {
      present: state.past.at(-1)!,
      past: state.past.slice(0, -1),
      future: [...state.future, state.present],
    };
  }
  if (!state.future.length) return state;
  return {
    present: state.future.at(-1)!,
    past: [...state.past, state.present].slice(-60),
    future: state.future.slice(0, -1),
  };
}
