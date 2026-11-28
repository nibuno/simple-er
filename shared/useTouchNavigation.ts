import { useEffect, useRef, type RefObject } from "react";

type Point = { x: number; y: number };
type BeginPinch = (center: Point) => (center: Point, scale: number) => void;

// Both editors keep their own view coordinates. Give each the midpoint in
// local screen pixels and the scale relative to the start of this finger pair.
export function useTouchNavigation(
  surface: RefObject<HTMLElement | SVGSVGElement | null>,
  controls: string | null,
  begin: BeginPinch,
) {
  const latest = useRef(begin);
  latest.current = begin;
  useEffect(() => {
    const el = surface.current!;
    const points = new Map<number, Point>();
    let update: ReturnType<BeginPinch> | undefined;
    let startDistance = 1;
    let suppressClick = false;
    let tapStart: Point | undefined;
    let touchGesture = false;

    function pair() {
      const [a, b] = points.values();
      const rect = el.getBoundingClientRect();
      return {
        center: {
          x: (a.x + b.x) / 2 - rect.left,
          y: (a.y + b.y) / 2 - rect.top,
        },
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      };
    }
    function beginPair() {
      const { center, distance } = pair();
      startDistance = distance;
      update = latest.current(center);
    }
    function consume(e: Event) {
      e.preventDefault();
      e.stopPropagation();
    }
    function down(e: PointerEvent) {
      if (!points.size) suppressClick = false;
      if (e.pointerType !== "touch") return;
      if (!points.size && controls && (e.target as Element).closest(controls))
        return;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size === 1 && !update) {
        tapStart = points.get(e.pointerId);
        return;
      }
      tapStart = undefined;
      if (points.size === 2) beginPair();
      for (const id of points.keys()) el.setPointerCapture(id);
      suppressClick = true;
      consume(e);
    }
    function move(e: PointerEvent) {
      if (!points.has(e.pointerId)) return;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!update) {
        if (
          tapStart &&
          Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) >= 4
        )
          suppressClick = true;
        return;
      }
      if (points.size === 2) {
        const { center, distance } = pair();
        update(center, distance / startDistance);
      }
      consume(e);
    }
    function end(e: PointerEvent) {
      if (!points.delete(e.pointerId) || !update) return;
      if (points.size === 2) beginPair();
      if (!points.size) update = undefined;
      consume(e);
    }
    function lost(e: PointerEvent) {
      // An implicit capture on a child can transfer to the surface.
      if (!el.hasPointerCapture(e.pointerId)) end(e);
    }
    function click(e: MouseEvent) {
      if (suppressClick && e.detail) consume(e);
    }
    function gesture(e: Event) {
      // Safari may finish its native gesture after both pointerups.
      if (e.type === "gesturestart") touchGesture = points.size > 0;
      if (points.size) touchGesture = true;
      if (touchGesture) {
        e.preventDefault();
        if (e.type !== "gestureend") e.stopImmediatePropagation();
      }
      if (e.type === "gestureend") touchGesture = false;
    }
    function reset() {
      points.clear();
      update = undefined;
      touchGesture = false;
      suppressClick = false;
    }
    const controller = new window.AbortController();
    const options = {
      capture: true,
      passive: false,
      signal: controller.signal,
    };
    function listen<K extends keyof GlobalEventHandlersEventMap>(
      type: K,
      handler: (e: GlobalEventHandlersEventMap[K]) => void,
    ) {
      el.addEventListener(type, handler as EventListener, options);
    }
    listen("pointerdown", down);
    listen("pointermove", move);
    listen("pointerup", end);
    listen("pointercancel", end);
    listen("lostpointercapture", lost);
    listen("click", click);
    listen("dblclick", click);
    listen("wheel", (e) => {
      if (update || touchGesture) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    });
    for (const type of ["gesturestart", "gesturechange", "gestureend"])
      el.addEventListener(type, gesture, options);
    // An editor can replace the pressed element before the finger lifts.
    window.addEventListener("pointerup", end, { signal: controller.signal });
    window.addEventListener("pointercancel", end, {
      signal: controller.signal,
    });
    window.addEventListener("blur", reset, options);
    return () => controller.abort();
  }, [surface, controls]);
}
