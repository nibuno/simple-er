import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

// Keep repeated keydowns out of history and the full route calculation.
export function useArrowMove<T>(base: T, commit: (diagram: T) => void) {
  type Move = { base: T; diagram: T; tableId?: string };
  const [preview, setPreview] = useState<Move | null>(null);
  const pending = useRef<Move | null>(null);
  const latest = useRef({ base, commit });
  latest.current = { base, commit };
  useEffect(() => {
    function finish() {
      const move = pending.current;
      if (!move) return;
      pending.current = null;
      // A shortcut or pointer action in the same event must see the final position.
      flushSync(() => {
        setPreview(null);
        if (move.base === latest.current.base)
          latest.current.commit(move.diagram);
      });
    }
    const keyup = (e: KeyboardEvent) => {
      if (e.key.startsWith("Arrow")) finish();
    };
    const keydown = (e: KeyboardEvent) => {
      if (!e.key.startsWith("Arrow") && e.key !== "Shift") finish();
    };
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("pointerdown", finish, true);
    window.addEventListener("blur", finish);
    window.addEventListener("pagehide", finish);
    return () => {
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("pointerdown", finish, true);
      window.removeEventListener("blur", finish);
      window.removeEventListener("pagehide", finish);
    };
  }, []);
  function move(step: (previous: T) => T, tableId?: string) {
    const base = latest.current.base;
    const previous =
      pending.current?.base === base ? pending.current!.diagram : base;
    const diagram = step(previous);
    if (previous === diagram) return;
    pending.current = { base, diagram, tableId };
    setPreview(pending.current);
  }
  return { preview: preview?.base === base ? preview : null, move };
}
