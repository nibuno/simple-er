import { serialBase } from "./column-attributes.ts";
import type { Column, DdlDialect, ForeignKey } from "./types.ts";

export function ddlType(type: string, dialect: DdlDialect, indexed: boolean) {
  if (dialect === "PostgreSQL") {
    const t = type.toLowerCase();
    if (/^datetime(\(\d\))?$/.test(t))
      return t.replace("datetime", "timestamp");
    if (/^(tiny|medium|long)?blob$/.test(t)) return "bytea";
    if (t === "double") return "double precision";
    const integer =
      /^(tinyint|smallint|mediumint|int|integer|bigint)(?:\(\d+\))?( unsigned)?$/.exec(
        t,
      );
    if (integer) {
      if (integer[1] === "tinyint") return "smallint";
      if (integer[1] === "mediumint") return "integer";
      if (integer[2]) {
        if (integer[1] === "smallint") return "integer";
        if (integer[1] === "bigint") return "numeric(20)";
        return "bigint";
      }
      if (t.includes("(")) return integer[1];
    }
    return type;
  }
  const base = serialBase(type) ?? type;
  const t = base.toLowerCase();
  if (dialect === "MySQL") {
    if (t === "uuid") return "CHAR(36)";
    if (t === "text" && indexed) return "VARCHAR(255)";
    if (t === "jsonb") return "JSON";
    if (t === "bytea") return "BLOB";
    if (t === "int2") return "SMALLINT";
    if (t === "int4") return "INTEGER";
    if (t === "int8") return "BIGINT";
    if (t === "timestamp without time zone") return "DATETIME";
    if (t === "timestamptz" || t === "timestamp with time zone")
      return "TIMESTAMP";
    return base;
  }
  if (
    /^(smallint|bigint|integer|int[248]?|tinyint|mediumint|boolean|bool)(?:\(\d+\))?( unsigned)?$/.test(
      t,
    )
  )
    return t === "integer" ? type : "INTEGER";
  if (
    /^(uuid|jsonb?|date|datetime|timestamptz|timestamp( (with|without) time zone)?|(var)?char(\s*\(\d+\))?)$/.test(
      t,
    )
  )
    return "TEXT";
  if (/^(double( precision)?|float[48]?)$/.test(t)) return "REAL";
  if (t === "bytea") return "BLOB";
  return base;
}

// SQL has no SQLite COMMENT clause or portable spelling for the original type.
// Keep only details lost in translation, adjacent to their column or table.
type Details = Partial<
  Pick<Column, "type" | "logicalName" | "note" | "identity" | "identityOptions">
> &
  Pick<ForeignKey, "label" | "cardinality"> & { enumName?: string };
export const detailsPrefix = "/* simple-er ";
export function detailsComment(details: Details) {
  if (!Object.values(details).some(Boolean)) return "";
  // Escape both block delimiters for engines that support nested SQL comments.
  return (
    " " +
    detailsPrefix +
    JSON.stringify(details).replaceAll("/", "\\u002f") +
    " */"
  );
}
export function readDetails(raw?: string): Details {
  if (!raw) return {};
  try {
    const d = JSON.parse(raw.slice(detailsPrefix.length, -2));
    if (!d || typeof d !== "object") return {};
    const text = (v: unknown, length: number) =>
      typeof v === "string" && v.length <= length && v.trim().length > 0;
    const cardinality = d.cardinality;
    return {
      ...(text(d.logicalName, 80) && { logicalName: d.logicalName }),
      ...(text(d.label, 80) && { label: d.label }),
      ...(cardinality &&
        typeof cardinality === "object" &&
        !Array.isArray(cardinality) &&
        Object.entries(cardinality).every(
          ([key, value]) =>
            (key === "parentMinimum" || key === "childMinimum") &&
            (value === 0 || value === 1),
        ) && { cardinality }),
      ...(text(d.type, 40) && { type: d.type }),
      ...(text(d.enumName, 40) && { enumName: d.enumName }),
      ...(typeof d.note === "string" &&
        d.note.length <= 2_000_000 && { note: d.note }),
      ...(d.identity === "always" && { identity: d.identity }),
      ...(text(d.identityOptions, 2_000_000) && {
        identityOptions: d.identityOptions,
      }),
    };
  } catch {
    return {};
  }
}
