import { detailsPrefix } from "./ddl-dialect.ts";

// Keep source positions so types and default expressions retain their SQL spelling.
export interface Token {
  raw: string;
  line: number;
  offset: number;
  mysqlString?: string;
  details?: string;
}

export function* statements(sql: string): Generator<Token[]> {
  // Quoted strings and identifiers are single tokens, including any delimiters
  // inside them. PostgreSQL standard strings keep backslashes literally.
  const token =
    /\s+|--[^\r\n]*|#(?![>#])[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:''|[^'])*(?:'|$)|"(?:""|[^"])*(?:"|$)|`(?:``|[^`])*(?:`|$)|\$([A-Za-z_]\w*|)\$[\s\S]*?\$\1\$|[\p{L}_\d$][\p{L}\p{M}\d_$]*|./guy;
  const escaped = /'(?:''|\\[\s\S]|[^'\\])*'/y;
  let line = 1;
  let statement: Token[] = [];
  let mysql = false;
  let offset = 0;
  while (offset < sql.length) {
    const previous = statement.at(-1);
    const pgEscape =
      previous?.raw.toUpperCase() === "E" && previous.offset + 1 === offset;
    const inlineComment = previous?.raw.toUpperCase() === "COMMENT";
    const lexer =
      sql[offset] === "'" && (mysql || inlineComment || pgEscape)
        ? escaped
        : token;
    lexer.lastIndex = offset;
    let match = lexer.exec(sql);
    if (!match) {
      token.lastIndex = offset;
      match = token.exec(sql)!;
    }
    const raw = match[0];
    if (raw === ";") {
      if (statement.length) yield statement;
      statement = [];
      mysql = false;
    } else if (
      previous &&
      raw.startsWith(detailsPrefix) &&
      raw.endsWith("*/")
    ) {
      previous.details = raw;
    } else if (
      !/^(?:\s|--|#(?![>#])|\/\*)/u.test(raw) ||
      (raw.startsWith("/*") && !raw.endsWith("*/"))
    ) {
      const item: Token = { raw, line, offset };
      if (lexer === escaped && !pgEscape && raw.includes("\\")) {
        const escapes: Record<string, string> = {
          n: "\n",
          r: "\r",
          t: "\t",
          b: "\b",
          "0": "\0",
          Z: "\x1a",
        };
        item.mysqlString = raw
          .slice(1, -1)
          .replace(/''|\\([\s\S])/g, (_, ch) =>
            ch === undefined ? "'" : (escapes[ch] ?? ch),
          );
      }
      statement.push(item);
      if (
        raw.startsWith("`") ||
        /^(?:AUTO_INCREMENT|ENGINE|CHARSET)$/i.test(raw)
      )
        mysql = true;
    }
    line += (raw.match(/\r\n|\r|\n/g) ?? []).length;
    offset += raw.length;
  }
  if (statement.length) yield statement;
}

export class SqlError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
  }
}

export class Tokens {
  index = 0;
  constructor(readonly items: Token[]) {}
  get current() {
    return this.items[this.index];
  }
  get line() {
    return this.current?.line ?? this.items.at(-1)?.line ?? 1;
  }
  get keyword() {
    return this.current?.raw.toUpperCase() ?? "";
  }
  fail(message: string): never {
    throw new SqlError(this.line, message);
  }
  eat(word: string) {
    if (this.keyword !== word) return false;
    this.index++;
    return true;
  }
  need(word: string) {
    if (!this.eat(word)) this.fail(`${word} が必要です。`);
  }
  end() {
    if (this.current)
      this.fail(`「${this.current.raw.slice(0, 40)}」以降は読み込めません。`);
  }
  name() {
    const raw = this.current?.raw ?? "";
    let name = raw;
    if (/^(?:"(?:[^"]|"")*"|`(?:[^`]|``)*`)$/.test(raw))
      name = raw.slice(1, -1).replaceAll(raw[0] + raw[0], raw[0]);
    else if (!/^[\p{L}_][\p{L}\p{M}\d_$]*$/u.test(raw))
      this.fail("名前を読み取れません。");
    if (!name.trim() || name.length > 80)
      this.fail("名前は1〜80文字で指定してください。");
    this.index++;
    return name;
  }
  qualifiedName() {
    const parts = [this.name()];
    while (this.eat(".")) parts.push(this.name());
    return parts;
  }
  names() {
    this.need("(");
    const names = [this.name()];
    while (this.eat(",")) names.push(this.name());
    this.need(")");
    return names;
  }
  string() {
    const raw = this.current?.raw ?? "";
    const mysql = this.current?.mysqlString;
    if (mysql !== undefined) {
      this.index++;
      return mysql;
    }
    const dollar = /^\$(\w*)\$([\s\S]*)\$\1\$$/.exec(raw);
    if (dollar) {
      this.index++;
      return dollar[2];
    }
    if (!/^'(?:[^']|'')*'$/.test(raw))
      this.fail("コメントの文字列を読み取れません。");
    this.index++;
    return raw.slice(1, -1).replaceAll("''", "'");
  }
  // Consume one expression up to a delimiter outside parentheses and brackets.
  until(stop: (word: string) => boolean) {
    const start = this.index;
    const close: string[] = [];
    while (this.current) {
      const word = this.keyword;
      if (!close.length && stop(word)) break;
      if (word === "(" || word === "[") close.push(word === "(" ? ")" : "]");
      if ((word === ")" || word === "]") && close.pop() !== word)
        this.fail("括弧が対応していません。");
      this.index++;
    }
    if (close.length) this.fail("閉じ括弧がありません。");
    return this.items.slice(start, this.index);
  }
}
export function expression(tokens: Token[], sql: string) {
  return tokens
    .map((token, i) => {
      const raw =
        token.mysqlString !== undefined
          ? "'" + token.mysqlString.replaceAll("'", "''") + "'"
          : token.raw;
      if (!i) return raw;
      const prev = tokens[i - 1];
      const gap = sql.slice(prev.offset + prev.raw.length, token.offset);
      return (/\S/.test(gap) ? " " : gap) + raw;
    })
    .join("");
}
