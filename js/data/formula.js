// formula.js
//
// Self-contained expression/condition evaluator for computed ("formula")
// text fields. Deliberately hand-rolled (no eval/new Function) so a
// formula can only ever do arithmetic and comparisons, never run
// arbitrary JS.
//
// A field's `formula` is a small tree of two node shapes:
//   { type: "expr", text: "<expression, with {{fieldId}} or
//     {{fieldId::checkboxIndex}} variable tokens mixed into plain
//     math text>" }
//   { type: "if", condition: "<condition text, same token syntax>",
//     whenTrue: <formula node>, whenFalse: <formula node> }
// "if" nodes can nest arbitrarily inside either branch.
//
// VARIABLE VALUES, once resolved into a plain id -> number map
// (computeAllFormulas, below):
//   - a "text" field's own value is used as a variable when other
//     formulas reference it — its content is parsed as a number
//   - a "radio" field's variable is its selected option number
//     (1..N), or 0 if nothing's selected
//   - a "checkbox" field contributes ONE variable PER checkbox
//     (id::0, id::1, ...), each 1 or 0

const FUNCTIONS = {
  sum: (...args) => args.reduce((total, v) => total + v, 0),
  product: (...args) => args.reduce((total, v) => total * v, 1),
  sqrt: (a) => Math.sqrt(a),
  pow: (a, b) => Math.pow(a, b),
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  // "up"/"down" read literally as directions on the number line, so
  // roundup(-2.3) is -2 (not Excel's away-from-zero -3). Swap these
  // for Math.trunc/sign-based versions if Excel-style rounding turns
  // out to matter more than the literal reading.
  roundup: (a) => Math.ceil(a),
  rounddown: (a) => Math.floor(a),
};

export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

const VAR_TOKEN = /\{\{([^}]+)\}\}/g;

/** Replaces every {{fieldId}} / {{fieldId::index}} token with a
 *  parenthesized numeric literal from valueMap (0 if missing/NaN).
 *  Parens matter: "10 - {{X}}" with X = -5 must read as "10 - (-5)",
 *  not tokenize as "10 - -5". */
function substituteTokens(text, valueMap) {
  return String(text || "").replace(VAR_TOKEN, (_, token) => {
    const v = valueMap[token];
    const n = Number.isFinite(v) ? v : 0;
    return `(${n})`;
  });
}

// --- Arithmetic expression parser --------------------------------------

function tokenize(text) {
  const re = /\s*(\d+\.\d+|\d+|[+\-*/(),]|[A-Za-z_][A-Za-z0-9_]*)/g;
  const tokens = [];
  let pos = 0;
  while (pos < text.length) {
    re.lastIndex = pos;
    const match = re.exec(text);
    if (!match || match.index !== pos) break; // stray character — stop here rather than throw
    tokens.push(match[1]);
    pos = re.lastIndex;
  }
  return tokens;
}

function parseExpressionTokens(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  function parseExpression() {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }
  function parseTerm() {
    let value = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const rhs = parseFactor();
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  }
  function parseFactor() {
    if (peek() === "-") { next(); return -parseFactor(); }
    if (peek() === "+") { next(); return parseFactor(); }
    if (peek() === "(") {
      next();
      const value = parseExpression();
      if (peek() === ")") next();
      return value;
    }
    const tok = next();
    if (tok === undefined) return NaN;
    if (/^[A-Za-z_]/.test(tok)) {
      const fn = FUNCTIONS[tok.toLowerCase()];
      if (peek() === "(") {
        next();
        const args = [];
        if (peek() !== ")") {
          args.push(parseExpression());
          while (peek() === ",") { next(); args.push(parseExpression()); }
        }
        if (peek() === ")") next();
        return fn ? fn(...args) : NaN;
      }
      return NaN; // bare identifier with no call — unresolvable
    }
    return parseFloat(tok);
  }

  const result = parseExpression();
  return i < tokens.length ? NaN : result; // trailing junk = malformed expression
}

/** Evaluates a plain arithmetic expression (after variable
 *  substitution). Returns NaN for anything it can't parse — callers
 *  treat NaN as 0 so a typo doesn't break the whole sheet. */
export function evaluateExpression(substitutedText) {
  try {
    const result = parseExpressionTokens(tokenize(substitutedText));
    return Number.isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}

// --- Condition evaluator -------------------------------------------------

const COMPARATORS = ["<=", ">=", "!=", "=", "<", ">"];

function evaluateComparison(term) {
  for (const op of COMPARATORS) {
    const idx = term.indexOf(op);
    if (idx === -1) continue;
    const left = evaluateExpression(term.slice(0, idx));
    const right = evaluateExpression(term.slice(idx + op.length));
    switch (op) {
      case "=": return left === right;
      case "!=": return left !== right;
      case "<=": return left <= right;
      case ">=": return left >= right;
      case "<": return left < right;
      case ">": return left > right;
      default: return false;
    }
  }
  // No comparator in this segment — treat it as a plain truthy number.
  return evaluateExpression(term) !== 0;
}

/** Evaluates a boolean condition (after variable substitution) built
 *  from comparisons joined by AND / OR / XOR. Combined strictly
 *  left-to-right — there's no precedence between AND/OR/XOR here, and
 *  no parenthesization of whole conditions, so write one comparison
 *  per AND/OR/XOR segment (e.g. "STR >= 10 AND LEVEL > 3"). */
export function evaluateCondition(substitutedText) {
  const parts = String(substitutedText || "").split(/\s+(AND|OR|XOR)\s+/i);
  let result = evaluateComparison(parts[0] || "");
  for (let i = 1; i < parts.length; i += 2) {
    const connective = (parts[i] || "").toUpperCase();
    const rhs = evaluateComparison(parts[i + 1] || "");
    if (connective === "AND") result = result && rhs;
    else if (connective === "OR") result = result || rhs;
    else if (connective === "XOR") result = result !== rhs;
  }
  return result;
}

// --- Formula tree ---------------------------------------------------------

export function evaluateFormulaNode(node, valueMap) {
  if (!node) return NaN;
  if (node.type === "if") {
    const cond = evaluateCondition(substituteTokens(node.condition, valueMap));
    return evaluateFormulaNode(cond ? node.whenTrue : node.whenFalse, valueMap);
  }
  return evaluateExpression(substituteTokens(node.text, valueMap));
}

function parseNumericText(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  const n = parseFloat((tmp.textContent || "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Builds a variable-id -> current numeric value map from every field
 *  passed in (the caller supplies the global-tab fields, since that's
 *  the only pool the sidebar exposes as drag sources), then resolves
 *  every text field WITH a formula against it.
 *
 *  Formulas that reference other formula fields are resolved over a
 *  few passes rather than a true dependency sort — enough for
 *  realistic nesting depth; a circular reference just settles (or
 *  oscillates) instead of crashing. */
export function computeAllFormulas(fields) {
  const valueMap = {};
  fields.forEach((f) => {
    if (f.fieldType === "radio") {
      valueMap[f.id] = f.selected || 0;
    } else if (f.fieldType === "checkbox") {
      (f.checked || []).forEach((checked, i) => {
        valueMap[`${f.id}::${i}`] = checked ? 1 : 0;
      });
    } else if (f.fieldType === "text") {
      valueMap[f.id] = f.formula ? 0 : parseNumericText(f.value);
    }
  });
  const formulaFields = fields.filter((f) => f.fieldType === "text" && f.formula);
  for (let pass = 0; pass < 5; pass++) {
    formulaFields.forEach((f) => {
      const result = evaluateFormulaNode(f.formula, valueMap);
      valueMap[f.id] = Number.isFinite(result) ? result : 0;
    });
  }
  return valueMap;
}

/** Turns a computed number into display text — whole numbers show
 *  plain, anything else rounds to 2 decimal places. */
export function formatComputedValue(n) {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
