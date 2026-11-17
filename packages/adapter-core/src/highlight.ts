// Class-based highlighting for common code languages. Tokens are spans, never
// inline styles, so a host content-security policy can still forbid them.

export type TokenKind =
  "plain" | "comment" | "string" | "number" | "keyword" | "tag" | "attr";

export interface CodeToken {
  readonly kind: TokenKind;
  readonly text: string;
}

export interface HighlightedCode {
  /** Visible language name. Absent when the block names none. */
  readonly label?: string;
  /** Safe `language-*` class. Absent for unnamed or unusual spellings. */
  readonly className?: string;
  readonly tokens: readonly CodeToken[];
}

type Family =
  | "c"
  | "python"
  | "json"
  | "markup"
  | "css"
  | "shell"
  | "sql"
  | "yaml"
  | "plain";

interface Language {
  readonly id: string;
  readonly label: string;
  readonly family: Family;
  readonly aliases: readonly string[];
}

const LANGUAGES: readonly Language[] = [
  {
    id: "javascript",
    label: "JavaScript",
    family: "c",
    aliases: ["js", "javascript"],
  },
  {
    id: "typescript",
    label: "TypeScript",
    family: "c",
    aliases: ["ts", "typescript"],
  },
  { id: "jsx", label: "JSX", family: "c", aliases: ["jsx"] },
  { id: "tsx", label: "TSX", family: "c", aliases: ["tsx"] },
  {
    id: "python",
    label: "Python",
    family: "python",
    aliases: ["py", "python"],
  },
  { id: "json", label: "JSON", family: "json", aliases: ["json"] },
  {
    id: "html",
    label: "HTML",
    family: "markup",
    aliases: ["html", "xml", "svg"],
  },
  { id: "css", label: "CSS", family: "css", aliases: ["css"] },
  {
    id: "bash",
    label: "Bash",
    family: "shell",
    aliases: ["bash", "sh", "shell", "zsh"],
  },
  { id: "rust", label: "Rust", family: "c", aliases: ["rs", "rust"] },
  { id: "go", label: "Go", family: "c", aliases: ["go", "golang"] },
  { id: "java", label: "Java", family: "c", aliases: ["java"] },
  { id: "c", label: "C", family: "c", aliases: ["c", "h"] },
  {
    id: "cpp",
    label: "C++",
    family: "c",
    aliases: ["cpp", "c++", "cc", "hpp"],
  },
  { id: "sql", label: "SQL", family: "sql", aliases: ["sql"] },
  { id: "yaml", label: "YAML", family: "yaml", aliases: ["yaml", "yml"] },
  {
    id: "markdown",
    label: "Markdown",
    family: "plain",
    aliases: ["md", "markdown"],
  },
  {
    id: "text",
    label: "Text",
    family: "plain",
    aliases: ["text", "txt", "plaintext"],
  },
];

const BY_ALIAS = new Map<string, Language>();
for (const language of LANGUAGES)
  for (const alias of language.aliases) BY_ALIAS.set(alias, language);

const C_KEYWORDS = words(
  "as async await bool boolean break case catch chan class const continue declare default defer do else enum export extends false fn for from func function go if impl import in interface let loop map match mod mut namespace new null nullptr of package private protected pub public readonly return select self Self static struct super switch template this throw trait true try type typeof undefined use using var void while yield",
);
const PYTHON_KEYWORDS = words(
  "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield",
);
const SQL_KEYWORDS = words(
  "and as by create delete desc distinct from group having in inner insert into join left limit not null on or order outer right select set table update values where",
);
const SHELL_KEYWORDS = words(
  "cd do done echo elif else esac exit export fi for if in then while",
);
const JSON_KEYWORDS = words("true false null");

function words(value: string): Set<string> {
  return new Set(value.split(/\s+/u));
}

function lookup(language: string | undefined): Language | undefined {
  const key = language?.trim().toLowerCase();
  if (!key) return undefined;
  return BY_ALIAS.get(key);
}

function visibleLabel(language: string): string | undefined {
  let cleaned = "";
  for (const char of language.trim()) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32) cleaned += char;
  }
  if (!cleaned) return undefined;
  return cleaned.slice(0, 32);
}

/** Tokenize `source` for `language`. Unknown languages stay plain text and still name themselves. */
export function highlightCode(
  source: string,
  language: string | undefined,
): HighlightedCode {
  const known = lookup(language);
  const label = known?.label ?? (language ? visibleLabel(language) : undefined);
  const className = known ? `language-${known.id}` : undefined;
  const tokens =
    !known || known.family === "plain"
      ? [{ kind: "plain" as const, text: source }]
      : tokenize(source, known.family);
  return {
    ...(label ? { label } : {}),
    ...(className ? { className } : {}),
    tokens,
  };
}

function tokenize(source: string, family: Family): CodeToken[] {
  if (family === "markup") return markup(source);
  if (family === "json") return scan(source, "json");
  if (family === "css") return css(source);
  if (family === "yaml") return yaml(source);
  return scan(source, family);
}

function scan(
  source: string,
  family: Exclude<Family, "markup" | "css" | "yaml" | "plain">,
): CodeToken[] {
  const keywords =
    family === "python"
      ? PYTHON_KEYWORDS
      : family === "sql"
        ? SQL_KEYWORDS
        : family === "shell"
          ? SHELL_KEYWORDS
          : family === "json"
            ? JSON_KEYWORDS
            : C_KEYWORDS;
  const tokens: CodeToken[] = [];
  let index = 0;
  while (index < source.length) {
    const comment = readComment(source, index, family);
    if (comment) {
      push(tokens, "comment", comment);
      index += comment.length;
      continue;
    }
    const string = readString(source, index, family);
    if (string) {
      push(tokens, "string", string);
      index += string.length;
      continue;
    }
    const number = match(
      source,
      index,
      /0[xX][0-9a-fA-F]+|\d[\d_]*(?:\.\d[\d_]*)?/y,
    );
    if (number) {
      push(tokens, "number", number);
      index += number.length;
      continue;
    }
    const word = match(source, index, /[A-Za-z_][A-Za-z0-9_]*/y);
    if (word) {
      push(tokens, keywords.has(word) ? "keyword" : "plain", word);
      index += word.length;
      continue;
    }
    push(tokens, "plain", source[index] ?? "");
    index += 1;
  }
  return tokens;
}

function readComment(
  source: string,
  index: number,
  family: Exclude<Family, "markup" | "css" | "yaml" | "plain">,
): string | undefined {
  if (family === "json") return undefined;
  if (family === "python" || family === "shell") {
    if (source[index] !== "#") return undefined;
    if (
      family === "shell" &&
      (source[index - 1] === "$" || source[index - 1] === "\\")
    )
      return undefined;
    const end = source.indexOf("\n", index);
    return source.slice(index, end === -1 ? source.length : end);
  }
  if (source.startsWith("//", index)) {
    const end = source.indexOf("\n", index);
    return source.slice(index, end === -1 ? source.length : end);
  }
  if (source.startsWith("/*", index)) {
    const end = source.indexOf("*/", index + 2);
    return source.slice(index, end === -1 ? source.length : end + 2);
  }
  if (
    (family === "c" || family === "sql") &&
    source[index] === "#" &&
    (index === 0 || source[index - 1] === "\n")
  ) {
    const end = source.indexOf("\n", index);
    return source.slice(index, end === -1 ? source.length : end);
  }
  if (family === "sql" && source.startsWith("--", index)) {
    const end = source.indexOf("\n", index);
    return source.slice(index, end === -1 ? source.length : end);
  }
  return undefined;
}

function readString(
  source: string,
  index: number,
  family: Exclude<Family, "markup" | "css" | "yaml" | "plain">,
): string | undefined {
  let start = index;
  if (family === "python") {
    const prefix = match(source, index, /[rRuUbBfF]{1,2}(?=["'])/y);
    if (prefix) start += prefix.length;
  }
  const triple = source.startsWith('"""', start)
    ? '"""'
    : source.startsWith("'''", start)
      ? "'''"
      : undefined;
  if (family === "python" && triple) {
    const end = source.indexOf(triple, start + 3);
    return source.slice(index, end === -1 ? source.length : end + 3);
  }
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && !(quote === "`" && family === "c"))
    return undefined;
  if (family === "json" && quote !== '"') return undefined;
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) return source.slice(index, cursor + 1);
    if (source[cursor] === "\n" && quote !== "`") break;
    cursor += 1;
  }
  return source.slice(index, cursor);
}

function markup(source: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      const next = end === -1 ? source.length : end + 3;
      push(tokens, "comment", source.slice(index, next));
      index = next;
      continue;
    }
    if (source[index] === "<") {
      const end = source.indexOf(">", index + 1);
      const next = end === -1 ? source.length : end + 1;
      paintTag(tokens, source.slice(index, next));
      index = next;
      continue;
    }
    const next = source.indexOf("<", index);
    const end = next === -1 ? source.length : next;
    push(tokens, "plain", source.slice(index, end));
    index = end;
  }
  return tokens;
}

function paintTag(tokens: CodeToken[], chunk: string): void {
  let index = 0;
  if (chunk[index] === "<") {
    push(tokens, "tag", "<");
    index += 1;
  }
  if (chunk[index] === "/") {
    push(tokens, "tag", "/");
    index += 1;
  }
  const name = match(chunk, index, /[A-Za-z][\w:-]*/y);
  if (name) {
    push(tokens, "tag", name);
    index += name.length;
  }
  while (index < chunk.length) {
    const string = readQuoted(chunk, index);
    if (string) {
      push(tokens, "string", string);
      index += string.length;
      continue;
    }
    const ident = match(chunk, index, /[\w:-]+/y);
    if (ident) {
      const next = chunk[index + ident.length];
      push(tokens, next === "=" ? "attr" : "plain", ident);
      index += ident.length;
      continue;
    }
    const mark = chunk[index] ?? "";
    push(tokens, mark === ">" || mark === "/" ? "tag" : "plain", mark);
    index += 1;
  }
}

function css(source: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      const next = end === -1 ? source.length : end + 2;
      push(tokens, "comment", source.slice(index, next));
      index = next;
      continue;
    }
    const string = readQuoted(source, index);
    if (string) {
      push(tokens, "string", string);
      index += string.length;
      continue;
    }
    const color = match(source, index, /#[0-9a-fA-F]{3,8}\b/y);
    const number = color ?? match(source, index, /\d[\d.]*(?:[a-z%]+)?/y);
    if (number) {
      push(tokens, "number", number);
      index += number.length;
      continue;
    }
    const word = match(source, index, /[@A-Za-z_-][A-Za-z0-9_-]*/y);
    if (word) {
      const next = source[index + word.length];
      const kind = word.startsWith("@")
        ? "keyword"
        : next === ":"
          ? "attr"
          : "plain";
      push(tokens, kind, word);
      index += word.length;
      continue;
    }
    push(tokens, "plain", source[index] ?? "");
    index += 1;
  }
  return tokens;
}

function yaml(source: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;
  while (index < source.length) {
    if (
      source[index] === "#" &&
      (index === 0 || /\s/u.test(source[index - 1] ?? ""))
    ) {
      const end = source.indexOf("\n", index);
      push(
        tokens,
        "comment",
        source.slice(index, end === -1 ? source.length : end),
      );
      index = end === -1 ? source.length : end;
      continue;
    }
    const string = readQuoted(source, index);
    if (string) {
      push(tokens, "string", string);
      index += string.length;
      continue;
    }
    const number = match(source, index, /\d[\d.]*/y);
    if (
      number &&
      (index === 0 || !/[A-Za-z_]/u.test(source[index - 1] ?? ""))
    ) {
      push(tokens, "number", number);
      index += number.length;
      continue;
    }
    const word = match(source, index, /[A-Za-z_][A-Za-z0-9_-]*/y);
    if (word) {
      const rest = source.slice(index + word.length);
      const key = /^\s*:/u.test(rest);
      const flag = /^(?:true|false|yes|no|null)$/iu.test(word);
      push(tokens, key ? "attr" : flag ? "keyword" : "plain", word);
      index += word.length;
      continue;
    }
    push(tokens, "plain", source[index] ?? "");
    index += 1;
  }
  return tokens;
}

function readQuoted(source: string, index: number): string | undefined {
  const quote = source[index];
  if (quote !== '"' && quote !== "'") return undefined;
  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) return source.slice(index, cursor + 1);
    if (source[cursor] === "\n") break;
    cursor += 1;
  }
  return source.slice(index, cursor);
}

function match(
  source: string,
  index: number,
  pattern: RegExp,
): string | undefined {
  pattern.lastIndex = index;
  const found = pattern.exec(source);
  return found?.[0];
}

function push(tokens: CodeToken[], kind: TokenKind, text: string): void {
  if (!text) return;
  const last = tokens.at(-1);
  if (last?.kind === "plain" && kind === "plain") {
    tokens[tokens.length - 1] = { kind, text: last.text + text };
    return;
  }
  tokens.push({ kind, text });
}
