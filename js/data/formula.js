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

// Parameter NAMES (for the formula editor's ghosted-placeholder
// insertion) and arity (for validation) — one source of truth for
// both so they can't drift apart.
export const FUNCTION_PARAMS = {
  sum: ["a", "b", "…"],
  product: ["a", "b", "…"],
  sqrt: ["x"],
  pow: ["base", "exponent"],
  min: ["a", "b", "…"],
  max: ["a", "b", "…"],
  roundup: ["x"],
  rounddown: ["x"],
};

const FUNCTION_ARITY = {
  sum: [1, Infinity],
  product: [1, Infinity],
  sqrt: [1, 1],
  pow: [2, 2],
  min: [1, Infinity],
  max: [1, Infinity],
  roundup: [1, 1],
  rounddown: [1, 1],
};

function describeArity([lo, hi]) {
  if (lo === hi) return `exactly ${lo} parameter${lo === 1 ? "" : "s"}`;
  if (hi === Infinity) return `at least ${lo} parameter${lo === 1 ? "" : "s"}`;
  return `between ${lo} and ${hi} parameters`;
}

/** Thrown by the parser for anything worth explaining to the person
 *  writing the formula. evaluateExpression() catches these (along
 *  with anything else) and quietly returns NaN, same as always — only
 *  validateExpression()/validateCondition() surface the message. */
class FormulaError extends Error {}

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

/** Same idea as substituteTokens, but for validation — we don't have
 *  (or need) real field values there, just SOMETHING numeric so the
 *  structure/arity checks below can run. */
function stripTokensForValidation(text) {
  return String(text || "").replace(VAR_TOKEN, "(1)");
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
      if (peek() !== ")") throw new FormulaError("Missing a closing parenthesis");
      next();
      return value;
    }
    const tok = next();
    if (tok === undefined) throw new FormulaError("Looks incomplete — a number or variable is missing");
    if (/^[A-Za-z_]/.test(tok)) {
      if (peek() !== "(") {
        throw new FormulaError(`"${tok}" isn't a recognized function — if you meant a stat field, drag it in from the list instead of typing its name`);
      }
      next();
      const args = [];
      if (peek() !== ")") {
        args.push(parseExpression());
        while (peek() === ",") { next(); args.push(parseExpression()); }
      }
      if (peek() !== ")") throw new FormulaError(`Missing a closing parenthesis for ${tok}()`);
      next();
      const fn = FUNCTIONS[tok.toLowerCase()];
      if (!fn) throw new FormulaError(`"${tok}" isn't a recognized function`);
      const arity = FUNCTION_ARITY[tok.toLowerCase()];
      if (arity && (args.length < arity[0] || args.length > arity[1])) {
        throw new FormulaError(`${tok}() expects ${describeArity(arity)}, but got ${args.length}`);
      }
      return fn(...args);
    }
    const n = parseFloat(tok);
    if (Number.isNaN(n)) {
      throw new FormulaError(`"${tok}" isn't a number — if you meant a stat field, drag it in from the list instead of typing its name`);
    }
    return n;
  }

  const result = parseExpression();
  if (i < tokens.length) {
    throw new FormulaError(`Unexpected "${tokens[i]}" — check for a missing operator, or an extra character`);
  }
  return result;
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

/** Structural check for an expression box in the formula editor —
 *  same parser as evaluateExpression, but surfaces WHAT'S wrong
 *  instead of silently returning NaN. Takes the raw (unsubstituted)
 *  text, i.e. still containing {{...}} variable tokens — those are
 *  swapped for a dummy value here since validation only cares about
 *  structure, not the actual numbers. Returns null when there's
 *  nothing to report (including for empty/not-yet-written text). */
export function validateExpression(rawText) {
  const substituted = stripTokensForValidation(rawText);
  if (!substituted.trim()) return null;
  try {
    parseExpressionTokens(tokenize(substituted));
    return null;
  } catch (err) {
    return err instanceof FormulaError ? err.message : null;
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

function validateComparisonSide(text) {
  try {
    parseExpressionTokens(tokenize(text));
    return null;
  } catch (err) {
    return err instanceof FormulaError ? err.message : null;
  }
}

/** Structural check for a condition box — same idea as
 *  validateExpression, checking each comparison segment's left/right
 *  side. Takes raw (unsubstituted) text; returns null when there's
 *  nothing to report. */
export function validateCondition(rawText) {
  const substituted = stripTokensForValidation(rawText);
  if (!substituted.trim()) return null;
  const parts = substituted.split(/\s+(AND|OR|XOR)\s+/i);
  for (let idx = 0; idx < parts.length; idx += 2) {
    const term = parts[idx] || "";
    let found = false;
    for (const op of COMPARATORS) {
      const at = term.indexOf(op);
      if (at === -1) continue;
      found = true;
      const leftErr = validateComparisonSide(term.slice(0, at));
      if (leftErr) return leftErr;
      const rightErr = validateComparisonSide(term.slice(at + op.length));
      if (rightErr) return rightErr;
      break;
    }
    if (!found) {
      const err = validateComparisonSide(term);
      if (err) return err;
    }
  }
  return null;
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
