import type { DiagramDocument } from "./types.ts";
import { projectDocument } from "./model.ts";

export const initialDocument: DiagramDocument = {
  format: "er-sketch",
  version: 2,
  schema: {
    tables: [
      {
        id: "users",
        name: "users",
        logicalName: "",
        keys: [
          {
            id: "users:pk",
            name: "",
            kind: "primary",
            columnIds: ["users:column:0"],
          },
        ],
        foreignKeys: [],
        columns: [
          {
            id: "users:column:0",
            name: "id",
            type: "uuid",
            logicalName: "",
          },
          {
            id: "users:column:1",
            name: "name",
            type: "text",
            logicalName: "",
          },
          {
            id: "users:column:2",
            name: "email",
            type: "text",
            logicalName: "",
          },
          {
            id: "users:column:3",
            name: "created_at",
            type: "timestamp",
            logicalName: "",
          },
        ],
      },
      {
        id: "orders",
        name: "orders",
        logicalName: "",
        keys: [
          {
            id: "orders:pk",
            name: "",
            kind: "primary",
            columnIds: ["orders:column:0"],
          },
        ],
        foreignKeys: [
          {
            id: "e1",
            name: "",
            columnIds: ["orders:column:1"],
            target: {
              tableId: "users",
              columnIds: ["users:column:0"],
            },
          },
        ],
        columns: [
          {
            id: "orders:column:0",
            name: "id",
            type: "uuid",
            logicalName: "",
          },
          {
            id: "orders:column:1",
            name: "user_id",
            type: "uuid",
            logicalName: "",
          },
          {
            id: "orders:column:2",
            name: "total",
            type: "integer",
            logicalName: "",
          },
          {
            id: "orders:column:3",
            name: "created_at",
            type: "timestamp",
            logicalName: "",
          },
        ],
      },
      {
        id: "order_items",
        name: "order_items",
        logicalName: "",
        keys: [
          {
            id: "order_items:pk",
            name: "",
            kind: "primary",
            columnIds: ["order_items:column:0"],
          },
        ],
        foreignKeys: [
          {
            id: "e2",
            name: "",
            columnIds: ["order_items:column:1"],
            target: {
              tableId: "orders",
              columnIds: ["orders:column:0"],
            },
          },
        ],
        columns: [
          {
            id: "order_items:column:0",
            name: "id",
            type: "uuid",
            logicalName: "",
          },
          {
            id: "order_items:column:1",
            name: "order_id",
            type: "uuid",
            logicalName: "",
          },
          {
            id: "order_items:column:2",
            name: "product_name",
            type: "text",
            logicalName: "",
          },
          {
            id: "order_items:column:3",
            name: "quantity",
            type: "integer",
            logicalName: "",
          },
        ],
      },
    ],
  },
  presentation: {
    tables: [
      {
        tableId: "users",
        x: 80,
        y: 110,
      },
      {
        tableId: "orders",
        x: 480,
        y: 280,
      },
      {
        tableId: "order_items",
        x: 880,
        y: 100,
      },
    ],
    routes: [
      {
        foreignKeyId: "e1",
        columnId: "orders:column:1",
        fromSide: "right",
        toSide: "left",
        trunk: 395,
        manual: false,
      },
      {
        foreignKeyId: "e2",
        columnId: "order_items:column:1",
        fromSide: "right",
        toSide: "left",
        trunk: 795,
        manual: false,
      },
    ],
  },
  unresolvedEdges: [],
};

export const initial = projectDocument(initialDocument);
