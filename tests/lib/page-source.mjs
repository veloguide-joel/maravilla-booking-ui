// Reads the real application source (consumer/booking-test.html) and extracts named
// top-level declarations from its inline script, so unit tests exercise the committed
// code instead of hand-copied function bodies. The page itself is never modified.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PAGE_PATH = process.env.PAGE_SRC || path.join(REPO_ROOT, "consumer", "booking-test.html");

export function pageSource() {
  return readFileSync(PAGE_PATH, "utf8");
}

/** The page's single inline <script> body. */
export function pageScript(src = pageSource()) {
  const m = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  if (m.length !== 1) throw new Error(`expected exactly one inline <script>, found ${m.length}`);
  return m[0][1];
}

const OPENERS = { "(": ")", "[": "]", "{": "}" };
const REGEX_PRECEDERS = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "return", "typeof", "+", "-", "*", "/", "%", "<", ">", "~", "^"]);

/** Index just past the end of the statement/declaration that starts at `start`. */
function statementEnd(code, start, kind) {
  const stack = [];
  let i = start, lastToken = "";
  let seenBodyBrace = false;
  while (i < code.length) {
    const ch = code[i], next = code[i + 1];
    if (ch === "/" && next === "/") { i = code.indexOf("\n", i); if (i < 0) i = code.length; continue; }
    if (ch === "/" && next === "*") { i = code.indexOf("*/", i + 2) + 2; continue; }
    if (ch === "'" || ch === '"') { i = skipString(code, i, ch); continue; }
    if (ch === "`") { i = skipTemplate(code, i); lastToken = "`"; continue; }
    if (ch === "/" && isRegexStart(lastToken)) { i = skipRegex(code, i); lastToken = "/re"; continue; }
    if (OPENERS[ch]) { stack.push(OPENERS[ch]); if (ch === "{" && stack.length === 1) seenBodyBrace = true; i += 1; lastToken = ch; continue; }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== ch) throw new Error(`unbalanced ${ch} at ${i}`);
      i += 1; lastToken = ch;
      if (stack.length === 0 && kind === "function" && ch === "}" && seenBodyBrace) return i;
      continue;
    }
    if (ch === ";" && stack.length === 0 && kind === "const") return i + 1;
    if (/\s/.test(ch)) { i += 1; continue; }
    const w = /^[A-Za-z_$][\w$]*/.exec(code.slice(i, i + 40));
    if (w) { lastToken = w[0]; i += w[0].length; continue; }
    lastToken = ch; i += 1;
  }
  throw new Error("declaration did not terminate");
}
function isRegexStart(lastToken) { return lastToken === "" || REGEX_PRECEDERS.has(lastToken); }
function skipString(code, i, q) { i += 1; while (i < code.length && code[i] !== q) { if (code[i] === "\\") i += 1; if (code[i] === "\n") throw new Error("unterminated string"); i += 1; } return i + 1; }
function skipRegex(code, i) { i += 1; let inClass = false; while (i < code.length) { const c = code[i]; if (c === "\\") { i += 2; continue; } if (c === "[") inClass = true; else if (c === "]") inClass = false; else if (c === "/" && !inClass) { i += 1; while (/[a-z]/.test(code[i] || "")) i += 1; return i; } else if (c === "\n") throw new Error("unterminated regex"); i += 1; } throw new Error("unterminated regex"); }
function skipTemplate(code, i) { i += 1; while (i < code.length) { const c = code[i]; if (c === "\\") { i += 2; continue; } if (c === "`") return i + 1; if (c === "$" && code[i + 1] === "{") { i = statementEndBrace(code, i + 1); continue; } i += 1; } throw new Error("unterminated template"); }
function statementEndBrace(code, openIdx) { // returns index just past the matching } of a ${ ... }
  let depth = 0, i = openIdx;
  while (i < code.length) { const c = code[i]; if (c === "'" || c === '"') { i = skipString(code, i, c); continue; } if (c === "`") { i = skipTemplate(code, i); continue; } if (c === "{") depth += 1; else if (c === "}") { depth -= 1; if (depth === 0) return i + 1; } i += 1; }
  throw new Error("unterminated ${}");
}

/** Find the declaration of `name` (function / async function / const / let) in the script. */
export function findDeclaration(script, name) {
  const re = new RegExp(`(^|\\n)[ \\t]*((?:async\\s+)?function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*=)`, "g");
  const m = re.exec(script);
  if (!m) throw new Error(`declaration not found in page: ${name}`);
  const start = m.index + m[1].length;
  const kind = /function/.test(m[2]) ? "function" : "const";
  const end = statementEnd(script, start, kind);
  return { name, start, end, code: script.slice(start, end) };
}

/**
 * Extract the named declarations (plus nothing else) from the real page and evaluate them in
 * page order. Returns an object with those names bound. Missing names throw, so renamed or
 * removed functions fail the tests loudly instead of silently testing stale copies.
 */
export function extract(names, { script = pageScript() } = {}) {
  const decls = names.map((n) => findDeclaration(script, n)).sort((a, b) => a.start - b.start);
  const body = decls.map((d) => d.code).join("\n") + `\nreturn { ${names.join(", ")} };`;
  try {
    return new Function("window", "document", "console", body)(globalThis.window ?? {}, undefined, console);
  } catch (err) {
    throw new Error(`extracted code failed to evaluate (${err.message}); names: ${names.join(", ")}`);
  }
}
