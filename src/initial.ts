import { validateDiagram } from "./model.ts";
export const initial = validateDiagram({
  tables: [
    {
      id: "users",
      x: 80,
      y: 110,
      columns: [
        ["id", "uuid", "PK"],
        ["name", "text", ""],
        ["email", "text", ""],
        ["created_at", "timestamp", ""],
      ],
    },
    {
      id: "orders",
      x: 480,
      y: 280,
      columns: [
        ["id", "uuid", "PK"],
        ["user_id", "uuid", "FK"],
        ["total", "integer", ""],
        ["created_at", "timestamp", ""],
      ],
    },
    {
      id: "order_items",
      x: 880,
      y: 100,
      columns: [
        ["id", "uuid", "PK"],
        ["order_id", "uuid", "FK"],
        ["product_name", "text", ""],
        ["quantity", "integer", ""],
      ],
    },
  ],
  edges: [
    {
      id: "e1",
      from: { table: "users", row: 0, side: "right" },
      to: { table: "orders", row: 1, side: "left" },
      trunk: 395,
      manual: false,
    },
    {
      id: "e2",
      from: { table: "orders", row: 0, side: "right" },
      to: { table: "order_items", row: 1, side: "left" },
      trunk: 795,
      manual: false,
    },
  ],
});
