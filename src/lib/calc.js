// Safe arithmetic evaluator for the calculator quick answer.
//
// A small Pratt parser over a fixed grammar: numbers, + - * / ^ ** % !,
// parentheses, implicit multiplication (2pi, 3(4+5), (1+2)(3+4)), a set of
// math functions and constants. It never calls eval or new Function, which
// matters twice: arbitrary code execution is off the table, and extension
// pages run under a CSP that blocks eval in both Firefox and Chromium.

const CONSTANTS = {
  pi: Math.PI,
  'π': Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
};

function factorial(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error('factorial needs a non-negative integer');
  if (n > 170) return Infinity;
  let out = 1;
  for (let i = 2; i <= n; i++) out *= i;
  return out;
}

const FUNCTIONS = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  fact: factorial,
};

const DEG = Math.PI / 180;

export class CalcError extends Error {}

export function tokenize(input) {
  const src = String(input)
    .replace(/[×✕]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/\*\*/g, '^');
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^(\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      tokens.push({ type: 'num', value: parseFloat(num[0]) });
      i += num[0].length;
      continue;
    }
    const ident = /^(?:[a-z][a-z0-9]*|π)/i.exec(src.slice(i));
    if (ident) {
      tokens.push({ type: 'ident', value: ident[0].toLowerCase() });
      i += ident[0].length;
      continue;
    }
    if ('+-*/^%!(),°'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    throw new CalcError(`Unexpected character "${ch}"`);
  }
  return tokens;
}

// Binding powers for infix operators. ^ is right-associative.
const INFIX = {
  '+': [10, 11],
  '-': [10, 11],
  '*': [20, 21],
  '/': [20, 21],
  '%': [20, 21],
  '^': [41, 40],
};

function startsOperand(tok) {
  return tok && (tok.type === 'num' || tok.type === 'ident' || (tok.type === 'op' && tok.value === '('));
}

export function evaluate(input) {
  const tokens = tokenize(input);
  if (!tokens.length) throw new CalcError('Empty expression');
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expectOp = (value) => {
    const tok = next();
    if (!tok || tok.type !== 'op' || tok.value !== value) throw new CalcError(`Expected "${value}"`);
  };

  function parsePrefix() {
    const tok = next();
    if (!tok) throw new CalcError('Unexpected end of expression');
    if (tok.type === 'num') return tok.value;
    if (tok.type === 'op' && tok.value === '-') return -parseExpr(30);
    if (tok.type === 'op' && tok.value === '+') return parseExpr(30);
    if (tok.type === 'op' && tok.value === '(') {
      const value = parseExpr(0);
      expectOp(')');
      return value;
    }
    if (tok.type === 'ident') {
      if (Object.prototype.hasOwnProperty.call(FUNCTIONS, tok.value)) {
        const fn = FUNCTIONS[tok.value];
        const after = peek();
        if (after && after.type === 'op' && after.value === '(') {
          next();
          const args = [];
          if (!(peek() && peek().type === 'op' && peek().value === ')')) {
            args.push(parseExpr(0));
            while (peek() && peek().type === 'op' && peek().value === ',') {
              next();
              args.push(parseExpr(0));
            }
          }
          expectOp(')');
          return fn(...args);
        }
        // Allow "sqrt 16" / "sin 30deg" style single-argument calls.
        return fn(parseExpr(30));
      }
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, tok.value)) return CONSTANTS[tok.value];
      if (tok.value === 'deg') throw new CalcError('"deg" must follow a number');
      throw new CalcError(`Unknown name "${tok.value}"`);
    }
    throw new CalcError(`Unexpected "${tok.value}"`);
  }

  function parseExpr(minBp) {
    let left = parsePrefix();
    for (;;) {
      const tok = peek();
      if (!tok) break;
      // Postfix operators bind tightest.
      if (tok.type === 'op' && tok.value === '!') { next(); left = factorial(left); continue; }
      if ((tok.type === 'op' && tok.value === '°') || (tok.type === 'ident' && tok.value === 'deg')) {
        next(); left *= DEG; continue;
      }
      if (tok.type === 'op' && tok.value === '%') {
        // "50%" is a percentage; "10 % 3" is modulo.
        const after = tokens[pos + 1];
        if (!startsOperand(after)) { next(); left /= 100; continue; }
      }
      if (tok.type === 'op' && INFIX[tok.value]) {
        const [lbp, rbp] = INFIX[tok.value];
        if (lbp < minBp) break;
        next();
        const right = parseExpr(rbp);
        switch (tok.value) {
          case '+': left += right; break;
          case '-': left -= right; break;
          case '*': left *= right; break;
          case '/': left /= right; break;
          case '%': left %= right; break;
          case '^': left = Math.pow(left, right); break;
        }
        continue;
      }
      // Implicit multiplication: 2pi, 3(4), (1+2)(3+4), 2 sqrt(4)
      if (startsOperand(tok)) {
        const [lbp, rbp] = INFIX['*'];
        if (lbp < minBp) break;
        const right = parseExpr(rbp);
        left *= right;
        continue;
      }
      break;
    }
    return left;
  }

  const value = parseExpr(0);
  if (pos < tokens.length) throw new CalcError(`Unexpected "${tokens[pos].value}"`);
  if (typeof value !== 'number' || Number.isNaN(value)) throw new CalcError('Not a number');
  return value;
}

// Format like a calculator display: up to 12 significant digits, no float noise.
export function formatNumber(value) {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : value < 0 ? '-∞' : 'NaN';
  if (Object.is(value, -0)) value = 0;
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
    return value.toExponential(8).replace(/\.?0+e/, 'e').replace('e+', 'e');
  }
  const rounded = parseFloat(value.toPrecision(12));
  return String(rounded);
}

const LOOKS_MATHY = /^[\d\s.+\-*/^%!(),×÷−–—°π]*$/;
const HAS_OPERATOR = /[+\-*/^%!×÷−–—°]|\*\*/;

// Decide whether a palette query is a calculation and, if so, compute it.
// Returns { expression, value, formatted } or null.
export function tryCalculate(query) {
  if (!query) return null;
  let expr = String(query).trim();
  let explicit = false;
  if (expr.startsWith('=')) { expr = expr.slice(1).trim(); explicit = true; }
  if (!expr) return null;

  if (!explicit) {
    // Dates, phone numbers and version strings look numeric but are not sums.
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(expr)) return null;
    if (/^\d{3}-\d{3,4}(-\d{4})?$/.test(expr)) return null;
    if (/^\d+(\.\d+){2,}$/.test(expr)) return null;
    const withoutNames = expr.replace(/\b(?:sqrt|cbrt|abs|a?sinh?|a?cosh?|a?tanh?|ln|log(?:2|10)?|exp|floor|ceil|round|sign|min|max|pow|fact|pi|tau|phi|deg|e)\b/gi, '');
    if (!LOOKS_MATHY.test(withoutNames)) return null;
    const usesFunction = withoutNames.length !== expr.length;
    if (!HAS_OPERATOR.test(expr) && !usesFunction) return null;
    // A lone "-5" or "5%" is not worth a calculator row.
    if (/^[-+]?\d+(\.\d+)?%?$/.test(expr)) return null;
  }

  try {
    const value = evaluate(expr);
    return { expression: expr, value, formatted: formatNumber(value) };
  } catch (_) {
    return null;
  }
}
