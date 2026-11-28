import { statements, Tokens } from "./ddl-tokens.ts";
import type { CheckConstraint, EnumType } from "./types.ts";

export function readChecks(value: unknown): CheckConstraint[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200)
    throw new Error("CHECK 制約は200件までです。");
  return value.map((check) => {
    if (
      !check ||
      typeof check.name !== "string" ||
      check.name.length > 80 ||
      typeof check.expression !== "string" ||
      !check.expression.trim()
    )
      throw new Error("CHECK の条件式を入力してください。");
    const expression = check.expression.trim();
    checkTokens(expression);
    return { name: check.name, expression };
  });
}

// Parse inside the same delimiters used in CREATE TABLE, so semicolons,
// comments, quoted text and nested parentheses have their SQL meanings.
export function checkTokens(sql: string) {
  const parser = new Tokens([...statements("(" + sql + ")")][0] ?? []);
  parser.need("(");
  const body = parser.until((word) => word === ")");
  parser.need(")");
  parser.end();
  if (!body.length || parser.items.at(-1)?.offset !== sql.length + 1)
    throw new Error("CHECK の条件式を確認してください。");
  return body;
}

export function enumPath(name: string) {
  const [items] = statements(name);
  const t = new Tokens(items ?? []);
  const parts = t.qualifiedName();
  t.end();
  // Only accept a name, including quoted identifiers, never extra statements or comments.
  if (parts.length > 2 || items.map((item) => item.raw).join("") !== name)
    throw new Error("ENUM の型名を確認してください。");
  return parts;
}

export const typeName = (parts: string[]) =>
  parts
    .map((part) =>
      /^[\p{L}_][\p{L}\p{M}\d_$]*$/u.test(part)
        ? part
        : '"' + part.replaceAll('"', '""') + '"',
    )
    .join(".");

export function readEnum(value: EnumType): EnumType {
  if (
    !value ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 40
  )
    throw new Error("ENUM の型名は1〜40文字で指定してください。");
  const parts = enumPath(value.name);
  if (
    parts.length === 1 &&
    /^(?:bool(?:ean)?|tinyint|smallint|int(?:eger|[248])?|mediumint|bigint|(?:big|small)?serial|float[48]?|real|double|decimal|numeric|money|text|varchar|char|date|datetime|time(?:stamp)?(?:tz)?|interval|jsonb?|uuid|bytea|blob|enum)$/i.test(
      parts[0],
    )
  )
    throw new Error("組み込み型と同名の ENUM にはスキーマ名を付けてください。");
  if (
    !Array.isArray(value.values) ||
    !value.values.length ||
    value.values.some((v) => typeof v !== "string" || v.includes("\0")) ||
    new Set(value.values).size !== value.values.length
  )
    throw new Error("ENUM の値を1つ以上入力し、重複を取り除いてください。");
  return { name: typeName(parts), values: [...value.values] };
}

export function registerEnum(enums: EnumType[], value: EnumType) {
  const definition = readEnum(value);
  const found = enums.find((e) => e.name === definition.name);
  if (!found) enums.push(definition);
  else if (JSON.stringify(found.values) !== JSON.stringify(definition.values))
    throw new Error(`ENUM「${definition.name}」に別の値が設定されています。`);
}

export function readEnumValues(tokens: Tokens) {
  tokens.need("(");
  const values = [tokens.string()];
  while (tokens.eat(",")) values.push(tokens.string());
  tokens.need(")");
  return values;
}

export function inlineEnumName(
  table: string,
  column: string,
  enums: EnumType[],
) {
  const stem = (table + "_" + column).replace(/[^\p{L}\p{N}_]/gu, "_");
  let name = ("enum_" + stem).slice(0, 40);
  for (let i = 2; enums.some((e) => e.name === name); i++)
    name = ("enum_" + stem).slice(0, 39 - String(i).length) + "_" + i;
  return name;
}
