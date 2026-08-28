/**
 * lib/kpi.js — the deterministic analysis engine.
 *
 * ARCHITECTURAL RULE, inherited from money.js: every figure that reaches a
 * manager is produced here, in integer kobo, from transaction-level rows. The
 * language model is never asked to add, divide or compare a figure, and
 * lib/numberguard.js deletes any number it volunteers anyway.
 *
 * A business-intelligence tool that can invent a revenue figure is worse than
 * no tool at all, because it is confidently wrong in the one place a manager
 * cannot check. That is the whole reason this file exists.
 *
 * Nothing here is pre-computed at build time. The dataset ships as rows and is
 * aggregated on demand, so any figure can be traced back to the orders behind
 * it — and shown, which is what makes it auditable rather than oracular.
 */

import { fromMinor, formatNaira, sumMinor } from './money.js';

/* ------------------------------------------------------------------ *
 * Table access
 *
 * Rows arrive as arrays with repeated strings interned to integers. This
 * wrapper is the only place that knows about that encoding.
 * ------------------------------------------------------------------ */

export function table(sales) {
  const idx = {};
  sales.columns.forEach((c, i) => (idx[c] = i));

  const str = (row, col) => {
    const table = sales.intern[col];
    return table ? table[row[idx[col]]] : row[idx[col]];
  };

  return {
    rows: sales.rows,
    columns: sales.columns,
    idx,
    str,
    /** Money columns are stored in kobo. Never converted until display. */
    minor: (row, col) => row[idx[col]] || 0,
    num: (row, col) => row[idx[col]] || 0,
    count: sales.rows.length
  };
}

/* ------------------------------------------------------------------ *
 * Grouping
 * ------------------------------------------------------------------ */

/**
 * Group rows by a key and total the money columns that matter.
 *
 * Returns rows sorted by revenue, each carrying its own order count so a
 * manager can see how much evidence sits behind a percentage. A 40% margin on
 * three orders is noise; the count is what tells them that.
 */
export function groupBy(t, keyFn) {
  const groups = new Map();

  for (const row of t.rows) {
    const key = keyFn(row);
    if (key === undefined || key === null || key === '') continue;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        orders: 0,
        units: 0,
        revenueMinor: 0,
        profitMinor: 0,
        cogsMinor: 0,
        discountMinor: 0,
        refundMinor: 0,
        returns: 0,
        late: 0,
        ratingSum: 0,
        ratingCount: 0
      });
    }

    const g = groups.get(key);
    g.orders += 1;
    g.units += t.num(row, 'Quantity');
    g.revenueMinor += t.minor(row, 'Realized_Revenue_NGN');
    g.profitMinor += t.minor(row, 'Contribution_Profit_NGN');
    g.cogsMinor += t.minor(row, 'COGS_Recognized_NGN');
    g.discountMinor += t.minor(row, 'Discount_Amount_NGN');
    g.refundMinor += t.minor(row, 'Refund_Amount_NGN');
    g.returns += t.num(row, 'Return_Flag');
    g.late += t.num(row, 'Late_Delivery_Flag');

    const rating = t.num(row, 'Customer_Rating');
    if (rating > 0) {
      g.ratingSum += rating;
      g.ratingCount += 1;
    }
  }

  return [...groups.values()].map(decorate).sort((a, b) => b.revenue - a.revenue);
}

/** Turn kobo totals into the display shape used everywhere. */
function decorate(g) {
  const revenue = fromMinor(g.revenueMinor);
  const profit = fromMinor(g.profitMinor);

  return {
    ...g,
    revenue,
    revenueDisplay: formatNaira(g.revenueMinor, { minor: true }),
    profit,
    profitDisplay: formatNaira(g.profitMinor, { minor: true }),
    discount: fromMinor(g.discountMinor),
    discountDisplay: formatNaira(g.discountMinor, { minor: true }),
    refund: fromMinor(g.refundMinor),
    refundDisplay: formatNaira(g.refundMinor, { minor: true }),

    /* Margin on zero revenue is undefined, not zero. Returning 0 would rank a
     * group with no sales alongside one that broke even. */
    marginPct: g.revenueMinor > 0 ? round2((g.profitMinor / g.revenueMinor) * 100) : null,
    returnPct: g.orders > 0 ? round2((g.returns / g.orders) * 100) : null,
    latePct: g.orders > 0 ? round2((g.late / g.orders) * 100) : null,
    avgRating: g.ratingCount > 0 ? round2(g.ratingSum / g.ratingCount) : null
  };
}

/* ------------------------------------------------------------------ *
 * Headline numbers
 * ------------------------------------------------------------------ */

export function overview(t) {
  let revenueMinor = 0;
  let profitMinor = 0;
  let discountMinor = 0;
  let refundMinor = 0;
  let returns = 0;
  let late = 0;
  let ratingSum = 0;
  let ratingCount = 0;
  const months = new Set();
  const customers = new Set();

  for (const row of t.rows) {
    revenueMinor += t.minor(row, 'Realized_Revenue_NGN');
    profitMinor += t.minor(row, 'Contribution_Profit_NGN');
    discountMinor += t.minor(row, 'Discount_Amount_NGN');
    refundMinor += t.minor(row, 'Refund_Amount_NGN');
    returns += t.num(row, 'Return_Flag');
    late += t.num(row, 'Late_Delivery_Flag');
    const r = t.num(row, 'Customer_Rating');
    if (r > 0) {
      ratingSum += r;
      ratingCount += 1;
    }
    months.add(t.str(row, 'Order_Month'));
    customers.add(row[t.idx.Customer_ID]);
  }

  return {
    orders: t.count,
    customers: customers.size,
    monthCount: months.size,

    revenue: fromMinor(revenueMinor),
    revenueDisplay: formatNaira(revenueMinor, { minor: true }),
    profit: fromMinor(profitMinor),
    profitDisplay: formatNaira(profitMinor, { minor: true }),
    discount: fromMinor(discountMinor),
    discountDisplay: formatNaira(discountMinor, { minor: true }),
    refund: fromMinor(refundMinor),
    refundDisplay: formatNaira(refundMinor, { minor: true }),

    marginPct: revenueMinor > 0 ? round2((profitMinor / revenueMinor) * 100) : null,
    discountSharePct: revenueMinor > 0 ? round2((discountMinor / revenueMinor) * 100) : null,
    returnPct: round2((returns / t.count) * 100),
    latePct: round2((late / t.count) * 100),
    avgRating: ratingCount ? round2(ratingSum / ratingCount) : null
  };
}

/** Revenue and margin per month, in calendar order. */
export function monthly(t) {
  return groupBy(t, (r) => t.str(r, 'Order_Month')).sort((a, b) =>
    String(a.key).localeCompare(String(b.key))
  );
}

/* ------------------------------------------------------------------ *
 * Discount bands
 *
 * The single most useful cut in this dataset: it shows the exact point at
 * which a discount stops buying volume and starts destroying profit.
 * ------------------------------------------------------------------ */

export const DISCOUNT_BANDS = [
  { key: 'none', label: 'No discount', max: 0 },
  { key: 'light', label: 'Up to 5%', max: 0.05 },
  { key: 'moderate', label: '5–10%', max: 0.1 },
  { key: 'heavy', label: '10–20%', max: 0.2 },
  { key: 'extreme', label: 'Over 20%', max: Infinity }
];

export function discountBands(t) {
  const bandFor = (pct) => DISCOUNT_BANDS.find((b) => pct <= b.max) || DISCOUNT_BANDS[DISCOUNT_BANDS.length - 1];
  const groups = groupBy(t, (r) => bandFor(t.num(r, 'Discount_Pct')).key);
  const order = DISCOUNT_BANDS.map((b) => b.key);

  return groups
    .map((g) => ({ ...g, label: DISCOUNT_BANDS.find((b) => b.key === g.key).label }))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/* ------------------------------------------------------------------ *
 * Money left on the table
 *
 * The difference between describing a problem and pricing one. Takes a set of
 * rows performing badly and asks: what would they have earned at a benchmark
 * margin that the business already achieves elsewhere?
 *
 * Deliberately conservative — the benchmark is a rate the company is ALREADY
 * hitting somewhere in its own data, never an invented target. That keeps the
 * recommendation defensible when a manager pushes back.
 * ------------------------------------------------------------------ */

export function opportunity(group, benchmarkMarginPct) {
  const wouldEarnMinor = Math.round((group.revenueMinor * benchmarkMarginPct) / 100);
  const gapMinor = wouldEarnMinor - group.profitMinor;

  return {
    benchmarkMarginPct: round2(benchmarkMarginPct),
    currentProfitDisplay: formatNaira(group.profitMinor, { minor: true }),
    wouldEarnDisplay: formatNaira(wouldEarnMinor, { minor: true }),
    gap: fromMinor(gapMinor),
    gapDisplay: formatNaira(gapMinor, { minor: true }),
    worthFixing: gapMinor > 0
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
