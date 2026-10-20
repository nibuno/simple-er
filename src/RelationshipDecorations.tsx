import type { ForeignKey, Point, Port, Table } from "./types.ts";
import { childMaximum } from "./relationships.ts";

function EndMarker({
  point,
  side,
  maximum,
  minimum,
}: {
  point: Point;
  side: Port["side"];
  maximum: "one" | "many";
  minimum?: 0 | 1;
}) {
  return (
    <g
      className="cardinality"
      data-maximum={maximum}
      data-minimum={minimum ?? "unknown"}
      transform={`translate(${point.x} ${point.y}) scale(${side === "right" ? 1 : -1} 1)`}
      aria-hidden="true"
    >
      {maximum === "many" ? (
        <path d="M 5 -6 L 15 0 L 5 6" />
      ) : (
        <path d="M 8 -6 V 6" />
      )}
      {minimum === 0 && <circle cx={23} cy={0} r={3.5} />}
      {minimum === 1 && <path d="M 21 -6 V 6" />}
    </g>
  );
}

export function RelationshipDecorations({
  child,
  fk,
  from,
  to,
  fromSide,
  toSide,
}: {
  child: Table;
  fk: ForeignKey;
  from: Point;
  to: Point;
  fromSide: Port["side"];
  toSide: Port["side"];
}) {
  return (
    <>
      <EndMarker
        point={from}
        side={fromSide}
        maximum="one"
        minimum={fk.cardinality?.parentMinimum}
      />
      <EndMarker
        point={to}
        side={toSide}
        maximum={childMaximum(child, fk)}
        minimum={fk.cardinality?.childMinimum}
      />
    </>
  );
}
