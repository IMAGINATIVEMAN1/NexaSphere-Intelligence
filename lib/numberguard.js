/**
 * lib/numberguard.js — the enforcement layer for KOBO's central promise.
 *
 * KOBO's claim to a borrower is that it cannot invent a figure about their
 * money. A prompt instructing the model not to is a hope, not a guarantee.
 * This file is the guarantee: any sentence containing a number that was not
 * handed to the model is deleted before the reply is shown.
 *
 * It lives in lib/ rather than inside the function so the test suite can prove
 * it works. An unenforced safety property is a marketing claim.
 */

/**
 * Normalise a written figure so the same amount compares equal however it was
 * typed: "₦68,500.00", "68,500" and "68500" all become "68500".
 *
 * Without this the guard is far too aggressive — it deletes correct sentences
 * merely because the model dropped trailing zeros, which guts the prose and
 * looks like the model failing.
 */
export function normFigure(raw) {
  let s = String(raw).replace(/,/g, '').replace(/[.\s]+$/, '');
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/**
 * Every figure the model is permitted to echo back, normalised.
 *
 * @param {object} facts  pre-formatted display strings sent to the model
 * @returns {Set<string>}
 */
export function collectAllowedFigures(facts = {}) {
  const out = new Set();
  for (const v of Object.values(facts || {})) {
    if (typeof v === 'string') {
      for (const n of v.match(/[\d][\d,.]*/g) || []) out.add(normFigure(n));
    }
  }
  // Small integers are safe in ordinary prose: "one month", "the two fees".
  for (let i = 0; i <= 12; i++) out.add(String(i));
  return out;
}

/**
 * Remove any sentence containing a number the model was not given.
 *
 * Deleting the whole sentence rather than the digits keeps the prose readable
 * and fails closed: a hallucinated figure takes its claim with it, instead of
 * leaving a confident sentence with a hole where the number was.
 *
 * @param {string} text
 * @param {Set<string>} allowed
 * @returns {string}
 */
export function stripUnknownNumbers(text, allowed) {
  const sentences = String(text || '').split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => {
    const numbers = s.match(/[\d][\d,.]*/g) || [];
    return numbers.every((n) => allowed.has(normFigure(n)));
  });
  return kept.join(' ').trim();
}
