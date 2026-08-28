/**
 * lib/money.js — deterministic money parsing and arithmetic.
 *
 * ARCHITECTURAL RULE: every number that appears on a verdict page is produced
 * here or by a validator that imports this file. The language model is never
 * asked to add, subtract, multiply or compare a figure. See lib/guard.js for
 * the enforcement layer that strips numbers out of model output.
 *
 * All arithmetic runs in integer minor units (kobo / cents) so that repeated
 * addition of decimal amounts cannot drift.
 */

const CURRENCY_TOKENS = /(?:NGN|USD|GBP|EUR|₦|\$|£|€)/gi;
const TRAILING_MARKER = /\s*(CR|DR|C|D)\s*$/i;

/** Characters that can legitimately appear inside a written amount. */
const AMOUNT_BODY = /^[\d.,\s]+$/;

/**
 * Parse a human-written amount into a structured value.
 * Handles: "₦1,234.56", "N1234", "1,234.56 CR", "(1,234.56)", "1234.56-",
 *          "1.234,56" (European grouping), "-1,234.56", "1 234,56".
 * Returns null when the string is not confidently an amount.
 *
 * @param {string} raw
 * @returns {{value:number, minor:number, negative:boolean, raw:string, marker:string|null}|null}
 */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;

  let negative = false;
  let marker = null;

  // Parentheses = negative (accounting convention).
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Strip currency words/symbols, and a bare leading "N" used for naira.
  s = s.replace(CURRENCY_TOKENS, ' ').trim();
  s = s.replace(/^N(?=[\s\d(])/i, ' ').trim();

  // Trailing CR/DR marker (common on Nigerian bank statements).
  const m = s.match(TRAILING_MARKER);
  if (m) {
    marker = m[1].toUpperCase();
    s = s.replace(TRAILING_MARKER, '').trim();
    if (marker === 'DR' || marker === 'D') negative = true;
  }

  // Leading or trailing sign.
  if (s.startsWith('-')) { negative = true; s = s.slice(1).trim(); }
  else if (s.startsWith('+')) { s = s.slice(1).trim(); }
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1).trim(); }

  if (!s || !AMOUNT_BODY.test(s)) return null;

  const normalised = normaliseGrouping(s);
  if (normalised === null) return null;

  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;

  const signed = negative ? -value : value;
  return {
    value: signed,
    minor: toMinor(signed),
    negative,
    raw: String(raw).trim(),
    marker
  };
}

/**
 * Decide whether "." or "," is the decimal separator and produce a plain
 * JS-parseable numeric string. Returns null if the grouping is incoherent.
 */
function normaliseGrouping(s) {
  const compact = s.replace(/\s/g, '');
  const lastDot = compact.lastIndexOf('.');
  const lastComma = compact.lastIndexOf(',');

  if (lastDot === -1 && lastComma === -1) {
    return /^\d+$/.test(compact) ? compact : null;
  }

  let decimalSep;
  if (lastDot === -1) decimalSep = ',';
  else if (lastComma === -1) decimalSep = '.';
  else decimalSep = lastDot > lastComma ? '.' : ',';

  const groupSep = decimalSep === '.' ? ',' : '.';
  const decimalPos = decimalSep === '.' ? lastDot : lastComma;
  const intPart = compact.slice(0, decimalPos).split(groupSep).join('');
  const fracPart = compact.slice(decimalPos + 1);

  // A "decimal" separator followed by exactly 3 digits and no other separator
  // is almost certainly a thousands separator ("1,234" / "1.234").
  if (fracPart.length === 3 && !compact.slice(0, decimalPos).includes(groupSep)) {
    const merged = intPart + fracPart;
    return /^\d+$/.test(merged) ? merged : null;
  }

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (fracPart.length > 4) return null;
  return `${intPart || '0'}.${fracPart || '0'}`;
}

/** Convert a decimal amount to integer minor units (kobo). */
export function toMinor(value) {
  return Math.round(Number(value) * 100);
}

/** Convert integer minor units back to a decimal amount. */
export function fromMinor(minor) {
  return Math.round(Number(minor)) / 100;
}

/** Exact sum of a list of minor-unit integers. */
export function sumMinor(list) {
  let total = 0;
  for (const n of list) total += Math.round(Number(n) || 0);
  return total;
}

/** Are two minor-unit values equal within `tolMinor` (default 1 kobo)? */
export function eqMinor(a, b, tolMinor = 1) {
  return Math.abs(Math.round(a) - Math.round(b)) <= tolMinor;
}

/** Percentage of a minor-unit amount, rounded half-up to the nearest kobo. */
export function pctOfMinor(minor, ratePercent) {
  return Math.round((Math.round(minor) * Number(ratePercent)) / 100);
}

/** Naira formatting used everywhere on the verdict page. */
export function formatNaira(value, { minor = false } = {}) {
  const n = minor ? fromMinor(value) : Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}₦${abs.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/* ------------------------------------------------------------------ *
 * Currency
 *
 * formatNaira() is right for every Nigerian document this product was built
 * for, and it hardcodes ₦. Receipts broke that assumption: the first one we
 * tested was a US retail receipt in dollars, and printing "₦56.95" over a
 * $56.95 total would be the exact failure this product exists to avoid —
 * confident, precise, and wrong. So money that might not be naira is detected
 * and formatted in the currency it was actually written in.
 * ------------------------------------------------------------------ */

const CURRENCY_SIGNS = [
  { code: 'NGN', symbol: '₦', re: /(?:₦|\bNGN\b|\bN(?=\s?[\d(])|\bnaira\b)/i },
  { code: 'USD', symbol: '$', re: /(?:\$|\bUSD\b|\bdollars?\b)/i },
  { code: 'GBP', symbol: '£', re: /(?:£|\bGBP\b|\bpounds?\s*sterling\b)/i },
  { code: 'EUR', symbol: '€', re: /(?:€|\bEUR\b|\beuros?\b)/i }
];

/**
 * Which currency is this document written in? Counts occurrences rather than
 * taking the first hit, because a naira invoice may mention USD once in a note.
 * Returns null when nothing is found — the caller must then say so rather than
 * assume naira.
 */
export function detectCurrency(text) {
  const s = String(text || '');
  let best = null;
  let bestCount = 0;
  for (const c of CURRENCY_SIGNS) {
    const matches = s.match(new RegExp(c.re.source, 'gi'));
    const count = matches ? matches.length : 0;
    if (count > bestCount) { bestCount = count; best = c; }
  }
  return best ? { code: best.code, symbol: best.symbol, hits: bestCount } : null;
}

/**
 * Format money in a known currency. `currency` is a code ('USD') or a value
 * from detectCurrency(). Unknown currency prints the bare number with the code
 * beside it rather than guessing a symbol.
 */
export function formatMoney(value, currency, { minor = false } = {}) {
  const n = minor ? fromMinor(value) : Number(value);
  if (!Number.isFinite(n)) return '—';
  const code = typeof currency === 'string' ? currency : currency?.code;
  const known = CURRENCY_SIGNS.find(c => c.code === code);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  if (known) return `${sign}${known.symbol}${abs}`;
  return code ? `${sign}${abs} ${code}` : `${sign}${abs}`;
}

/** Plain number formatting (quantities, counts, ratios). */
export function formatNumber(value, dp = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-NG', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp
  });
}

/** Ratio as a percentage string, computed in code. */
export function formatPercent(numerator, denominator, dp = 1) {
  const d = Number(denominator);
  if (!Number.isFinite(d) || d === 0) return '—';
  return `${((Number(numerator) / d) * 100).toFixed(dp)}%`;
}

/**
 * Find every amount-looking token in a block of free text, with its offset.
 * Used by the contract module to surface figures without asking the model.
 */
export function findAmounts(text) {
  const out = [];
  if (!text) return out;
  const re = /(?:NGN|₦|N|\$|£|€|USD|GBP|EUR)\s?\d[\d,. ]*\d|\d[\d,]*\.\d{2}\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const parsed = parseAmount(m[0]);
    if (parsed) out.push({ ...parsed, index: m.index });
    if (out.length > 500) break;
  }
  return out;
}
