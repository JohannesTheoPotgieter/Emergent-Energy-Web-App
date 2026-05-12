/**
 * Safe numeric-expression evaluator for template-stored scoring formulas.
 *
 * Replaces `new Function(...)` eval of `scoring_rule_json.formula`. Even
 * though those formulas are admin-authored today, evaluating arbitrary JS
 * is an in-process RCE primitive (`Function('return fetch(...)')`). This
 * evaluator only accepts numeric literals, the four arithmetic operators,
 * unary minus, parentheses, and identifier substitution from a caller-
 * provided variable map.
 *
 * Grammar (recursive descent, left-assoc):
 *   expr   := term (('+' | '-') term)*
 *   term   := factor (('*' | '/') factor)*
 *   factor := ('+' | '-') factor
 *           | number
 *           | identifier        (must exist in vars)
 *           | '(' expr ')'
 *   number := [0-9]+ ('.' [0-9]+)?
 *
 * Returns null on parse errors, unknown identifiers, division by zero, or
 * non-finite results. Never throws.
 */

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function evaluateSafeFormula(
  expression: string,
  vars: Record<string, number> = {},
): number | null {
  if (typeof expression !== "string" || expression.length === 0) return null;
  if (expression.length > 200) return null; // bound parse work

  let i = 0;
  const src = expression;

  function skipWs() {
    while (i < src.length && /\s/.test(src[i])) i++;
  }

  function peek(): string | null {
    skipWs();
    return i < src.length ? src[i] : null;
  }

  function consume(ch: string): boolean {
    skipWs();
    if (src[i] === ch) {
      i++;
      return true;
    }
    return false;
  }

  function readNumber(): number | null {
    skipWs();
    const start = i;
    while (i < src.length && /[0-9]/.test(src[i])) i++;
    if (src[i] === ".") {
      i++;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
    }
    if (i === start) return null;
    const n = Number(src.slice(start, i));
    return Number.isFinite(n) ? n : null;
  }

  function readIdentifier(): string | null {
    skipWs();
    const start = i;
    while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
    if (i === start) return null;
    const ident = src.slice(start, i);
    if (!IDENTIFIER_RE.test(ident)) return null;
    return ident;
  }

  function parseFactor(): number | null {
    skipWs();
    if (consume("+")) return parseFactor();
    if (consume("-")) {
      const v = parseFactor();
      return v == null ? null : -v;
    }
    if (consume("(")) {
      const v = parseExpr();
      if (v == null) return null;
      if (!consume(")")) return null;
      return v;
    }
    const ch = peek();
    if (ch != null && /[0-9.]/.test(ch)) return readNumber();
    if (ch != null && /[A-Za-z_]/.test(ch)) {
      const ident = readIdentifier();
      if (ident == null) return null;
      const v = vars[ident];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    return null;
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    if (left == null) return null;
    while (true) {
      skipWs();
      const op = src[i];
      if (op !== "*" && op !== "/") break;
      i++;
      const right = parseFactor();
      if (right == null) return null;
      if (op === "*") {
        left = left * right;
      } else {
        if (right === 0) return null;
        left = left / right;
      }
    }
    return left;
  }

  function parseExpr(): number | null {
    let left = parseTerm();
    if (left == null) return null;
    while (true) {
      skipWs();
      const op = src[i];
      if (op !== "+" && op !== "-") break;
      i++;
      const right = parseTerm();
      if (right == null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  const result = parseExpr();
  skipWs();
  if (i !== src.length) return null;
  if (result == null || !Number.isFinite(result)) return null;
  return result;
}
