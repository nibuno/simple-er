export interface History<T> {
  present: T;
  past: T[];
  future: T[];
}
export type Action<T> =
  | { type: "commit"; next: T; before?: T }
  | { type: "preview"; next: T }
  // Folds a change into the previous step: the present moves on, the undo
  // stack does not grow.
  | { type: "amend"; next: T }
  | { type: "reset"; next: T }
  | { type: "undo" | "redo" };
export function reduceHistory<T>(
  state: History<T>,
  action: Action<T>,
  limit: number,
): History<T> {
  if (action.type === "reset")
    return { present: action.next, past: [], future: [] };
  if (action.type === "preview") return { ...state, present: action.next };
  if (action.type === "amend")
    return { ...state, present: action.next, future: [] };
  if (action.type === "commit") {
    const before = action.before ?? state.present;
    if (JSON.stringify(before) === JSON.stringify(action.next))
      return { ...state, present: action.next };
    return {
      present: action.next,
      past: [...state.past, before].slice(-limit),
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
    past: [...state.past, state.present].slice(-limit),
    future: state.future.slice(0, -1),
  };
}
