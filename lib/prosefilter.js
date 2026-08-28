/**
 * lib/prosefilter.js — decides whether model output is fit to show a borrower.
 *
 * WHY THIS EXISTS. Reasoning models narrate their planning before answering.
 * When one runs out of tokens mid-thought, the "answer" it returns is the
 * planning itself — and a borrower gets shown text like "we must not state a
 * number not given, so we must avoid...". That exposes prompt internals and
 * destroys trust in a tool whose entire pitch is that it does not bluff.
 *
 * FAILS CLOSED. Anything that smells like reasoning, meta-commentary, or a
 * sentence cut off mid-thought is rejected outright. Showing nothing is always
 * better than showing this: the verdict is already complete without it.
 */

/** Phrases that only appear when a model is talking about its own task. */
const META_MARKERS = [
  /\bwe (need to|must|should|can|could|cannot|can't)\b/i,
  /\b(the )?user (says|wants|asked|is asking|gave)\b/i,
  /\bthat'?s not allowed\b/i,
  /\bnot allowed\b/i,
  /\b(thinking process|let me think|chain of thought)\b/i,
  /\bthe (prompt|instruction|system)\b/i,
  /\b(reply|respond|answer) in (plain )?(english|pidgin|hausa)\b/i,
  /\b\d[-–]\d sentences?\b/i,
  /\b(figures?|numbers?) (they|the user) can already see\b/i,
  /\bmust not (state|use|invent|repeat)\b/i,
  /\bso we (must|should|need)\b/i,
  /\bderived figure\b/i,
  /\bas an ai\b/i
];

/**
 * Degenerate repetition detector.
 *
 * Observed on 27 August 2026: asked for Yorùbá, the free model collapsed into
 * a loop — "ìgbàlẹ̀ ní" repeated roughly ninety times until it hit the token
 * ceiling. Raising the budget made it worse, not better. This is a model
 * failure mode, not a property of the language, and it can happen in any
 * language, so the check is language-agnostic: if a handful of distinct words
 * make up the bulk of a long reply, it is a loop and must not be shown.
 */
function looksRepetitive(text) {
  const words = String(text).toLowerCase().match(/[\p{L}\p{M}']+/gu) || [];
  if (words.length < 12) return false;

  const unique = new Set(words);
  if (unique.size / words.length < 0.35) return true;

  // The same word making up a fifth of a long reply is a loop, not emphasis.
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  const top = Math.max(...counts.values());
  if (words.length >= 20 && top / words.length > 0.2) return true;

  // An immediately repeating bigram, several times over.
  for (let i = 0; i + 3 < words.length; i++) {
    if (words[i] === words[i + 2] && words[i + 1] === words[i + 3]) {
      let runs = 1;
      let j = i;
      while (j + 3 < words.length && words[j] === words[j + 2] && words[j + 1] === words[j + 3]) {
        runs++;
        j += 2;
      }
      if (runs >= 4) return true;
    }
  }
  return false;
}

/** An answer that stops mid-thought was truncated, not finished. */
function looksTruncated(text) {
  const t = text.trim();
  if (!t) return true;
  // Finished prose ends in terminal punctuation or a closing quote/bracket.
  return !/[.!?…"'”’)\]]$/.test(t);
}

/**
 * Pull the answer out of a raw completion.
 *
 * Order: an explicit <answer> block wins; otherwise strip <think> blocks and
 * take what remains.
 *
 * @param {string} raw
 * @returns {string|null} clean prose, or null when nothing usable came back
 */
export function extractProse(raw) {
  if (!raw) return null;
  let s = String(raw);

  // Preferred path: the model wrapped its reply as instructed.
  const tagged = s.match(/<answer>([\s\S]*?)<\/answer>/i);
  if (tagged) {
    const inner = tagged[1].trim();
    return acceptable(inner) ? inner : null;
  }

  // An opened but unclosed answer tag means it was cut off. Reject.
  if (/<answer>/i.test(s)) return null;

  // Strip explicit reasoning blocks.
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  if (/<think>/i.test(s)) return null; // opened, never closed → truncated

  s = s.trim();
  if (!s) return null;

  /* No tags at all. Take the final paragraph, which is where a well-behaved
   * model puts its answer — but only accept it if it survives the checks. */
  const paras = s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const candidate = paras[paras.length - 1] || s;

  return acceptable(candidate) ? candidate : null;
}

/**
 * Is this text safe to show a borrower?
 * @param {string} text
 */
export function acceptable(text) {
  const t = String(text || '').trim();
  if (t.length < 20) return false;
  if (looksTruncated(t)) return false;
  if (looksRepetitive(t)) return false;
  for (const re of META_MARKERS) {
    if (re.test(t)) return false;
  }
  return true;
}
