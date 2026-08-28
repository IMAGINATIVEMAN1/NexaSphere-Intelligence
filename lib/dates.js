/**
 * lib/dates.js — deterministic date parsing.
 * Nigerian documents are overwhelmingly day-first. Everything here assumes
 * day-first unless the string is unambiguously ISO (yyyy-mm-dd).
 */

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11
};

/**
 * @param {string} raw
 * @returns {{iso:string, y:number, m:number, d:number, ts:number, raw:string}|null}
 */
export function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/\s+/g, ' ');

  // ISO: 2026-08-07
  let m = s.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (m) return build(+m[1], +m[2] - 1, +m[3], s);

  // 07/08/2026 or 07-08-26  (day first — the Nigerian convention, and the
  // default whenever both numbers could be either)
  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const d = +m[1], mo = +m[2] - 1;
    let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    if (d >= 1 && d <= 31 && mo >= 0 && mo <= 11) return build(y, mo, d, s);

    /* Day-first is IMPOSSIBLE here — the second number is not a month. That
     * only happens on a month-first (US) date like 08/15/2026, so read it that
     * way. This is not a guess between two readings: it is the only reading
     * that parses at all. Genuinely ambiguous dates (both numbers ≤ 12) never
     * reach this branch and stay day-first. */
    const usMonth = +m[1] - 1, usDay = +m[2];
    if (usMonth >= 0 && usMonth <= 11 && usDay >= 1 && usDay <= 31) {
      return build(y, usMonth, usDay, s);
    }
  }

  // 07-Aug-2026 / 7 August 2026
  m = s.match(/\b(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]*(\d{2,4})\b/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return build(y, MONTHS[m[2].toLowerCase()], +m[1], s);
  }

  // Aug 07, 2026
  m = s.match(/\b([A-Za-z]{3,9})[-\s]+(\d{1,2})(?:st|nd|rd|th)?[-\s,]+(\d{2,4})\b/);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) {
    let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return build(y, MONTHS[m[1].toLowerCase()], +m[2], s);
  }

  return null;
}

function build(y, m, d, raw) {
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
  return {
    iso: dt.toISOString().slice(0, 10),
    y, m: m + 1, d,
    ts: dt.getTime(),
    raw
  };
}

/** "2026-08" bucket key used for month-by-month aggregation. */
export function monthKey(dateObj) {
  if (!dateObj) return null;
  return `${dateObj.y}-${String(dateObj.m).padStart(2, '0')}`;
}

/** Whole days between two parsed dates (b - a). */
export function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((b.ts - a.ts) / 86400000);
}

/** Human label for a month key. */
export function monthLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(m) - 1] || m} ${y}`;
}
