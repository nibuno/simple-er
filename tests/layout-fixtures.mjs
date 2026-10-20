import { validateDiagram } from "../src/model.ts";

export function graph(definitions) {
  return validateDiagram({
    schemaVersion: 2,
    edges: [],
    tables: definitions.map(([id, parents = [], extra = 0], i) => ({
      id,
      name: id,
      x: (i % 3) * 380,
      y: Math.floor(i / 3) * 340,
      columns: [
        { name: "id", type: "uuid", key: "", id: `${id}-pk` },
        ...parents.map((p, j) => ({
          name: `${p}_id`,
          type: "uuid",
          key: "",
          id: `${id}-fk-${j}`,
        })),
        ...Array.from({ length: extra }, (_, j) => ({
          name: `value_${j}`,
          type: "text",
          key: "",
          id: `${id}-extra-${j}`,
        })),
      ],
      keys: [
        { id: `${id}-key`, name: "", kind: "primary", columnIds: [`${id}-pk`] },
      ],
      foreignKeys: parents.map((p, j) => ({
        id: `${id}-ref-${j}`,
        name: "",
        columnIds: [`${id}-fk-${j}`],
        target: { tableId: p, columnIds: [`${p}-pk`] },
      })),
    })),
  });
}

export const branching = () =>
  graph([
    ["accounts", [], 2],
    ["customers", ["accounts"], 4],
    ["products", ["accounts"], 2],
    ["orders", ["customers"], 3],
    ["product_images", ["products"], 1],
    ["order_items", ["orders", "products"], 2],
    ["payments", ["orders"], 2],
    ["shipments", ["orders"], 2],
    ["shipment_items", ["shipments", "order_items"], 1],
    ["audit_events", [], 2],
    ["settings", [], 1],
  ]);
