import type { ForeignKey, Point, Port, Table } from "./types.ts";
import { cardinalityMarker, childMaximum } from "./relationships.ts";

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
  const marker = cardinalityMarker(point, side, maximum, minimum);
  return (
    <g
      className="cardinality"
      data-maximum={maximum}
      data-minimum={minimum ?? "unknown"}
      transform={marker.transform}
      aria-hidden="true"
    >
      <path d={marker.path} />
      {minimum === 0 && <circle cx={23} cy={0} r={3.5} />}
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
