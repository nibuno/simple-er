import { checkTokens } from "./schema-constraints.ts";
import { expression, Tokens } from "./ddl-tokens.ts";
import type { DdlDialect } from "./types.ts";

const functionNames = {
  SQLite: new Set(
    "abs coalesce date datetime strftime time julianday unixepoch hex lower upper length round random randomblob zeroblob substr trim ifnull json json_array json_object replace printf cast typeof instr ltrim rtrim min max char unicode quote glob like json_valid json_type json_extract format".split(
      " ",
    ),
  ),
  MySQL: new Set(
    "abs coalesce curdate curtime date current_timestamp now uuid uuid_to_bin lower upper length round rand concat substr trim ifnull json_array json_object replace cast convert char_length character_length ascii trim ltrim rtrim greatest least mod year month day date_format regexp_like json_valid json_type json_extract".split(
      " ",
    ),
  ),
};

function unsupported(label: string, value: string, dialect: DdlDialect): never {
  throw new Error(
    `${label} の「${value}」は ${dialect} 用に書き換えてください。`,
  );
}

/** Translate literal casts emitted by pg_dump only when the target column supplies the same type. */
export function defaultSql(
  source: string,
  type: string,
  dialect: DdlDialect,
  label: string,
  nativeType = type,
) {
  if (dialect === "PostgreSQL") {
    if (/^\(?\s*(?:uuid|randomblob|strftime|uuid_to_bin)\s*\(/i.test(source))
      unsupported(label, source, dialect);
    return source;
  }
  let value = source.trim();
  const cast = /^('(?:''|[^'])*')\s*::\s*(.+)$/s.exec(value);
  if (
    cast &&
    (cast[2] === type ||
      (/^(?:text|character varying)$/i.test(cast[2]) &&
        /^(?:text|varchar|character varying)\b/i.test(type)))
  )
    value = cast[1];
  if (/^(?:now|current_timestamp)\s*\(\s*\)$/i.test(value))
    value = "CURRENT_TIMESTAMP";
  if (
    dialect === "MySQL" &&
    (/^CURRENT_(?:DATE|TIME)$/i.test(value) ||
      (/^CURRENT_TIMESTAMP$/i.test(value) &&
        !/^(?:timestamp|datetime)\b/i.test(nativeType)))
  )
    return `(${value})`;
  if (
    /^(?:CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|NULL|TRUE|FALSE)$/i.test(
      value,
    )
  )
    return value;

  const literal =
    /^'(?:''|[^'])*'$/s.test(value) ||
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value);
  const needsParens =
    dialect === "MySQL" &&
    /^(?:(?:long|medium|tiny)?(?:blob|text)|json)$/i.test(nativeType);
  if (literal) return needsParens ? `(${value})` : value;

  const tokens = checkTokens(value);
  for (const [i, token] of tokens.entries()) {
    if (token.raw === ":" && tokens[i + 1]?.raw === ":")
      unsupported(label, source, dialect);
    if (
      /^[\w$]+$/.test(token.raw) &&
      tokens[i + 1]?.raw === "(" &&
      !functionNames[dialect].has(token.raw.toLowerCase())
    )
      unsupported(label, token.raw + "()", dialect);
  }
  const body = new Tokens(tokens);
  if (body.eat("(")) {
    body.until((word) => word === ")");
    body.need(")");
    if (!body.current) return value;
  }
  return `(${value})`;
}

export function checkSql(
  source: string,
  columns: string[],
  dialect: DdlDialect,
  label: string,
) {
  const tokens = checkTokens(source);
  if (dialect === "PostgreSQL")
    return expression(tokens, "(" + source + ")", dialect);
  const names = new Map(columns.map((name) => [name.toLowerCase(), name]));
  const sql = "(" + source + ")";
  let result = "";
  // Only quote operands. Leave functions, literal strings, operators and cast types alone.
  const operandFollows =
    /^(?:\(|,|=|!|<|>|\+|-|\*|\/|%|\||&|NOT|AND|OR|WHEN|THEN|ELSE|BETWEEN|LIKE)$/i;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.raw === ":" && tokens[i + 1]?.raw === ":") {
      // pg_dump prints a numeric literal as "(0)::numeric" in a comparison.
      if (
        tokens[i + 2]?.raw.toLowerCase() === "numeric" &&
        tokens[i + 3]?.raw !== "(" &&
        tokens[i - 1]?.raw === ")" &&
        /^\d+$/.test(tokens[i - 2]?.raw ?? "") &&
        tokens[i - 3]?.raw === "("
      ) {
        i += 2;
        continue;
      }
      unsupported(label, source, dialect);
    }
    if (/^(?:ILIKE|SIMILAR)$/i.test(token.raw) || token.raw === "~")
      unsupported(label, token.raw, dialect);
    if (
      tokens[i + 1]?.raw === "(" &&
      /^[a-z_][a-z_0-9]*$/i.test(token.raw) &&
      !/^(?:AND|OR|NOT|IN|IS|BETWEEN|WHEN|THEN|ELSE|AS|LIKE)$/i.test(
        token.raw,
      ) &&
      !functionNames[dialect].has(token.raw.toLowerCase())
    )
      unsupported(label, token.raw + "()", dialect);
    const previous = tokens[i - 1];
    if (previous) {
      const gap = sql.slice(
        previous.offset + previous.raw.length,
        token.offset,
      );
      result += /\S/.test(gap) ? " " : gap;
    }
    const column =
      (!previous || operandFollows.test(previous.raw)) &&
      tokens[i + 1]?.raw !== "(" &&
      names.get(token.raw.toLowerCase());
    if (column) {
      const quote = dialect === "MySQL" ? "`" : '"';
      result += quote + column.replaceAll(quote, quote + quote) + quote;
    } else result += expression([token], "", dialect);
  }
  return result;
}
