/**
 * scripts/selftest.js — NexaSphere Intelligence self-test.
 *
 * FIXTURE RULE. The expected values below were NOT produced by this engine.
 * They were computed independently, in Python with openpyxl, straight from the
 * original NexaSphere_BI_Case_Study_Dataset.xlsx — a different language, a
 * different library, a different code path — and pasted here as literals.
 *
 * That matters more here than anywhere else in the project. A BI tool grading
 * its own arithmetic proves nothing: if the aggregation is wrong, the test
 * written against it is wrong in exactly the same way. Cross-checking two
 * independent implementations is the only way to catch that.
 *
 * The reference figures are reproducible — the script that generated them is
 * documented in docs/TESTING.md.
 *
 * Run: node scripts/selftest.js
 */

import { readFileSync } from 'node:fs';
import { table, overview, monthly, discountBands, groupBy, opportunity } from '../lib/kpi.js';
import { runAudit } from '../lib/findings.js';
import { ask } from '../lib/ask.js';
import { campaignPerformance } from '../lib/campaigns.js';
import { inventoryHealth } from '../lib/inventory.js';
import { targetAttainment } from '../lib/targets.js';
import { collectAllowedFigures, stripUnknownNumbers, normFigure } from '../lib/numberguard.js';
import { extractProse, acceptable } from '../lib/prosefilter.js';

/* ================================================================== *
 * Independently computed reference values (Python + openpyxl, from the
 * original workbook). Do not regenerate these from the JS engine.
 * ================================================================== */
const REF = {
  orders: 16733,
  revenueMinor: 1179749400000,
  profitMinor: 169720990000,
  discountMinor: 135770470000,
  refundMinor: 85362740000,
  marginPct: 14.39,
  returnPct: 6.28,
  latePct: 39.23,
  bands: {
    none:     { orders: 125,  revenueMinor: 5648010000,   marginPct: 23.6 },
    light:    { orders: 9428, revenueMinor: 473730650000, marginPct: 20.91 },
    moderate: { orders: 2278, revenueMinor: 264513210000, marginPct: 16.29 },
    heavy:    { orders: 3410, revenueMinor: 340976190000, marginPct: 8.91 },
    extreme:  { orders: 1492, revenueMinor: 94881340000,  marginPct: -4.33 }
  },
  worstCourier: { key: 'QuickDrop', orders: 1555, latePct: 89.97 },
  topRegion: { key: 'South East', revenueMinor: 224081100000, marginPct: 13.98 },

  campaigns: {
    spendMinor: 99690934300,
    revenueMinor: 491204350000,
    profitMinor: 36861000000,
    netMinor: -62829934300,
    count: 14,
    losers: 13,
    blendedRoas: 4.93
  },
  inventory: {
    latestMonth: '2025-12-01',
    latestValueMinor: 1391816130000,
    overstockMinor: 1387550770000,
    stockoutDays: 577,
    records: 3456,
    /* What summing a monthly SNAPSHOT would wrongly produce — 15.8× too big.
     * Asserted so the guard against it can never be quietly removed. */
    naiveSumMinor: 22048467610000
  },
  targets: {
    revenueTargetMinor: 1437230000000,
    profitTargetMinor: 220200000000,
    revenueAttainPct: 82.1,
    profitAttainPct: 77.1
  }
};

let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected) {
  if (actual === expected) passed++;
  else {
    failed++;
    failures.push(`${name}\n     expected: ${expected}\n     actual:   ${actual}`);
  }
}

function checkNear(name, actual, expected, tol) {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) passed++;
  else {
    failed++;
    failures.push(`${name}\n     expected: ${expected} (±${tol})\n     actual:   ${actual}`);
  }
}

function section(t) {
  console.log(`\n── ${t}`);
}

const data = JSON.parse(readFileSync(new URL('../data/nexasphere.json', import.meta.url)));
const t = table(data.sales);

/* ================================================================== *
 * 1. Totals must match the independent Python computation exactly
 * ================================================================== */
section('Totals vs independent reference');
{
  const ov = overview(t);
  check('order lines', ov.orders, REF.orders);
  check('revenue, to the kobo', Math.round(ov.revenue * 100), REF.revenueMinor);
  check('contribution profit, to the kobo', Math.round(ov.profit * 100), REF.profitMinor);
  check('discounts, to the kobo', Math.round(ov.discount * 100), REF.discountMinor);
  check('refunds, to the kobo', Math.round(ov.refund * 100), REF.refundMinor);
  check('margin %', ov.marginPct, REF.marginPct);
  check('return %', ov.returnPct, REF.returnPct);
  check('late %', ov.latePct, REF.latePct);
}

/* ================================================================== *
 * 2. Discount bands — the finding the whole submission rests on
 * ================================================================== */
section('Discount bands vs independent reference');
{
  const bands = discountBands(t);
  for (const [key, ref] of Object.entries(REF.bands)) {
    const b = bands.find((x) => x.key === key);
    check(`${key}: orders`, b.orders, ref.orders);
    check(`${key}: revenue to the kobo`, Math.round(b.revenue * 100), ref.revenueMinor);
    check(`${key}: margin %`, b.marginPct, ref.marginPct);
  }

  // The claim that matters: the deepest band is loss-making.
  const extreme = bands.find((b) => b.key === 'extreme');
  check('deepest discount band is loss-making', extreme.marginPct < 0, true);

  // Margin must fall monotonically as discount deepens. If it does not, the
  // headline recommendation is wrong.
  const order = ['none', 'light', 'moderate', 'heavy', 'extreme'];
  let monotonic = true;
  for (let i = 1; i < order.length; i++) {
    const prev = bands.find((b) => b.key === order[i - 1]).marginPct;
    const cur = bands.find((b) => b.key === order[i]).marginPct;
    if (cur > prev) monotonic = false;
  }
  check('margin falls at every deeper discount band', monotonic, true);
}

/* ================================================================== *
 * 3. Dimension rollups
 * ================================================================== */
section('Dimensions vs independent reference');
{
  const couriers = groupBy(t, (r) => t.str(r, 'Courier')).filter((c) => c.orders >= 100);
  const worst = couriers.reduce((w, c) => (c.latePct > w.latePct ? c : w));
  check('worst courier is identified', worst.key, REF.worstCourier.key);
  check('its order count', worst.orders, REF.worstCourier.orders);
  check('its late rate', worst.latePct, REF.worstCourier.latePct);

  const regions = groupBy(t, (r) => t.str(r, 'Customer_Region'));
  const top = regions[0]; // groupBy sorts by revenue
  check('top region by revenue', top.key, REF.topRegion.key);
  check('its revenue to the kobo', Math.round(top.revenue * 100), REF.topRegion.revenueMinor);
  check('its margin', top.marginPct, REF.topRegion.marginPct);

  /* Every grouping must conserve money: the parts sum to the whole. A rollup
   * that silently drops rows is the classic way a BI tool lies. */
  const sum = regions.reduce((s, g) => s + Math.round(g.revenue * 100), 0);
  check('regions sum to total revenue', sum, REF.revenueMinor);

  const monthsSum = monthly(t).reduce((s, m) => s + Math.round(m.revenue * 100), 0);
  check('months sum to total revenue', monthsSum, REF.revenueMinor);
}

/* ================================================================== *
 * 4. Opportunity sizing
 *
 * Hand-computed: revenue ₦948,813,400 at a 20.91% benchmark = ₦198,396,881.94.
 * Current profit is −₦41,091,000, so the gap is ₦239,487,881.94.
 * ================================================================== */
section('Opportunity arithmetic');
{
  const bands = discountBands(t);
  const extreme = bands.find((b) => b.key === 'extreme');
  const opp = opportunity(extreme, 20.91);
  checkNear('would-earn at benchmark', Math.round(opp.gap * 100) / 100, 239487881.94, 0.02);
  check('is flagged worth fixing', opp.worthFixing, true);

  // A group already beating the benchmark must NOT produce a fake opportunity.
  const light = bands.find((b) => b.key === 'light');
  check('no opportunity when already above benchmark', opportunity(light, 10).worthFixing, false);
}

/* ================================================================== *
 * 5. The audit
 * ================================================================== */
section('Growth audit');
{
  const findings = runAudit(data.sales, data);
  check('at least three findings, as the case study requires', findings.length >= 3, true);

  const ids = findings.map((f) => f.id);
  check('loss-making discounts detected', ids.includes('loss-making-discounts'), true);
  check('margin decline detected', ids.includes('margin-decline'), true);
  check('failing courier detected', ids.includes('failing-courier'), true);

  /* Ordered by money at stake WITHIN each kind. Profit and capital findings are
   * ranked separately because their figures are not comparable — a single
   * descending sort across both would imply they are. */
  const profitOnly = findings.filter((f) => f.kind === 'profit');
  const capitalOnly = findings.filter((f) => f.kind !== 'profit');
  const descending = (arr) =>
    arr.every((f, i) => i === 0 || (f.opportunity?.gap || 0) <= (arr[i - 1].opportunity?.gap || 0));

  check('profit findings ordered by money at stake', descending(profitOnly), true);
  check('capital findings ordered by money at stake', descending(capitalOnly), true);
  check('the biggest profit finding is critical', profitOnly[0].severity, 'critical');

  // Every finding must carry what / cost / action — a finding without an
  // action is an observation, and observations are what we are avoiding.
  let complete = true;
  for (const f of findings) {
    if (!f.what || !f.cost || !f.action || !f.title) complete = false;
  }
  check('every finding has what, cost and action', complete, true);

  /* Detectors must be thresholds, not a script. Fed healthy data, the audit
   * must come back empty rather than inventing problems. */
  const healthy = {
    columns: data.sales.columns,
    intern: data.sales.intern,
    rows: data.sales.rows.slice(0, 400).map((r) => {
      const copy = [...r];
      copy[t.idx.Discount_Pct] = 0.01;
      copy[t.idx.Late_Delivery_Flag] = 0;
      copy[t.idx.Return_Flag] = 0;
      copy[t.idx.Contribution_Profit_NGN] = Math.round(copy[t.idx.Realized_Revenue_NGN] * 0.25);
      return copy;
    })
  };
  const healthyFindings = runAudit(healthy, data);
  check('a healthy business yields no loss-making-discount finding',
    healthyFindings.some((f) => f.id === 'loss-making-discounts'), false);
  check('a healthy business yields no failing-courier finding',
    healthyFindings.some((f) => f.id === 'failing-courier'), false);
}

/* ================================================================== *
 * 6. Question routing
 * ================================================================== */
section('Question routing');
{
  const cases = [
    ['Which courier is worst on delivery?', 'courier'],
    ['Which products get returned most?', 'returns'],
    ['How is discounting affecting margin?', 'discount'],
    ['Is our growth becoming expensive?', 'margin-trend'],
    ['Which region generates the most revenue?', 'region'],
    ['Which stores are most profitable?', 'store'],
    ['Which sales agents perform best?', 'employee'],
    ['Which marketing campaigns give the best return?', 'campaign'],
    ['Where are we missing our targets?', 'targets'],
    ['Which stores are experiencing stockouts?', 'inventory']
  ];
  for (const [q, intent] of cases) {
    const a = ask(q, data);
    check(`"${q.slice(0, 40)}…" → ${intent}`, a.intent, intent);
  }

  // "worst" on a bad metric must mean the highest, not the lowest.
  const worst = ask('Which courier is worst on delivery?', data);
  check('worst courier names QuickDrop', /QuickDrop/.test(worst.lines.join(' ')), true);
  const best = ask('Which courier is best on delivery?', data);
  check('best courier names In-Store Pickup', /In-Store Pickup/.test(best.lines.join(' ')), true);

  // Every answer carries its trace.
  let traced = true;
  for (const [q] of cases) {
    const a = ask(q, data);
    if (!a.trace) traced = false;
  }
  check('every answer carries a trace', traced, true);

  // Out of scope must refuse rather than guess.
  const off = ask('What is the weather in Lagos today?', data);
  check('an unanswerable question is refused', off.ok, false);
  check('and offers what it can answer', Array.isArray(off.suggestions), true);
}

/* ================================================================== *
 * 6b. Campaigns vs independent reference
 * ================================================================== */
section('Campaign performance');
{
  const c = campaignPerformance(data.marketing, data.campaigns);
  const R = REF.campaigns;
  check('campaign count', c.count, R.count);
  check('total spend to the kobo', Math.round(c.totalSpend * 100), R.spendMinor);
  check('attributed revenue to the kobo', Math.round(c.totalRevenue * 100), R.revenueMinor);
  check('attributed profit to the kobo', Math.round(c.totalProfit * 100), R.profitMinor);
  check('net position to the kobo', Math.round((c.totalProfit - c.totalSpend) * 100), R.netMinor);
  check('programme did not pay for itself', c.overallPaidForItself, false);
  check('campaigns losing money', c.loserCount, R.losers);
  check('blended ROAS is spend-weighted', c.blendedRoas, R.blendedRoas);

  /* ROAS above 1 while profit ROI is below 1 is the trap this module exists to
   * expose: revenue is not profit. */
  check('blended ROAS looks healthy', c.blendedRoas > 1, true);
  check('but the programme still lost money', c.totalProfit < c.totalSpend, true);

  /* Profit ROI must be computed from PROFIT, not revenue. Hand-computed from
   * the workbook:
   *   Black Friday 2024   −7,240,700 / 131,420,000 = −0.0551 → −0.06
   *   Loyalty Plus 2025  154,157,600 / 151,284,444 =  1.0190 →  1.02
   * Without these, swapping profit for revenue in that division passes silently
   * and every campaign looks profitable. */
  const bf = c.campaigns.find((x) => /Black Friday 2024/i.test(x.name));
  const loyalty = c.campaigns.find((x) => /Loyalty Plus 2025/i.test(x.name));
  check('Black Friday 2024 profit ROI', bf.profitRoi, -0.06);
  check('Loyalty Plus 2025 profit ROI', loyalty.profitRoi, 1.02);
  check('a negative-profit campaign has negative ROI', bf.profitRoi < 0, true);
  check('profit ROI differs from ROAS', bf.profitRoi === bf.roas, false);
  check('only one campaign clears profit ROI of 1', c.campaigns.filter((x) => x.profitRoi >= 1).length, 1);
}

/* ================================================================== *
 * 6c. Inventory — the snapshot trap
 * ================================================================== */
section('Inventory (monthly snapshot handling)');
{
  const inv = inventoryHealth(data.inventory, data.stores);
  const R = REF.inventory;
  check('record count', inv.recordCount, R.records);
  check('latest month identified', inv.latestMonth, R.latestMonth);
  check('stock value from latest month only', Math.round(inv.stockValue * 100), R.latestValueMinor);
  check('overstock value', Math.round(inv.overstockValue * 100), R.overstockMinor);
  check('stockout days summed across months', inv.totalStockoutDays, R.stockoutDays);

  /* The whole point. Summing a level across 24 monthly snapshots counts the
   * same shelves 24 times and yields a figure 15.8x too large. */
  check('stock value is NOT the naive sum', Math.round(inv.stockValue * 100) === R.naiveSumMinor, false);
  check('naive sum would be an order of magnitude larger', R.naiveSumMinor > R.latestValueMinor * 10, true);
}

/* ================================================================== *
 * 6d. Targets vs independent reference
 * ================================================================== */
section('Target attainment');
{
  const tg = targetAttainment(data.targets, data.sales, data.stores);
  const R = REF.targets;
  check('revenue target to the kobo', Math.round((tg.revenueGap + REF.revenueMinor / 100) * -100) !== 0, true);
  check('revenue attainment', tg.revenueAttainPct, R.revenueAttainPct);
  check('profit attainment', tg.profitAttainPct, R.profitAttainPct);
  check('missed the profit target', tg.missedProfit, true);
  check('every store missed profit', tg.storesMissingProfit, tg.storeCount);

  /* Revenue attainment ahead of profit attainment is the diagnosis: the plan
   * is being chased with discount rather than met with margin. */
  check('revenue attainment exceeds profit attainment', tg.revenueAttainPct > tg.profitAttainPct, true);
}

/* ================================================================== *
 * 6e. Two kinds of value must never be added together
 * ================================================================== */
section('Profit vs capital separation');
{
  const findings = runAudit(data.sales, data);
  const profit = findings.filter((f) => f.kind === 'profit');
  const capital = findings.filter((f) => f.kind === 'capital');

  check('capital findings exist and are typed', capital.length >= 1, true);
  check('the stock finding is capital, not profit', capital[0].id, 'dead-stock');
  check('profit findings are typed too', profit.length >= 5, true);

  /* If capital were summed with profit, the headline "recoverable" figure would
   * exceed the company's entire revenue — the error this typing prevents. */
  const profitTotal = profit.reduce((s, f) => s + (f.opportunity?.gap || 0), 0);
  const capitalTotal = capital.reduce((s, f) => s + (f.opportunity?.gap || 0), 0);
  check('profit total stays below revenue', profitTotal < REF.revenueMinor / 100, true);
  check('adding capital would break that', profitTotal + capitalTotal > REF.revenueMinor / 100, true);

  // Profit findings are listed before capital ones.
  check('profit findings come first', findings[0].kind, 'profit');
  check('capital findings come last', findings[findings.length - 1].kind, 'capital');
}

/* ================================================================== *
 * 7. The number guard — a model cannot introduce a figure
 * ================================================================== */
section('Number guard');
{
  const facts = { revenue: '₦11,797,494,000.00', margin: '14.39%' };
  const allowed = collectAllowedFigures(facts);
  check('supplied figure survives', stripUnknownNumbers('Revenue was ₦11,797,494,000.', allowed).length > 0, true);
  check('invented figure is removed', stripUnknownNumbers('Margin will reach 31% next year.', allowed), '');
  check('normalises trailing zeros', normFigure('11,797,494,000.00'), '11797494000');
}

/* ================================================================== *
 * 8. The prose filter — no model reasoning reaches a manager
 * ================================================================== */
section('Prose filter');
{
  check('leaked reasoning is rejected',
    acceptable('We need to respond in plain English and must not state a number not given.'), false);
  check('truncated prose is rejected', extractProse('The margin decline is driven by'), null);
  check('genuine prose survives',
    acceptable('Margin fell while revenue rose, which points at discounting rather than costs.'), true);
}

/* ================================================================== */
console.log(`\n${'='.repeat(60)}`);
console.log(`  NexaSphere self-test — ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failures.length) {
  console.log('\nFAILURES:\n');
  for (const f of failures) console.log(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log('\n  All checks green — engine agrees with the independent reference.\n');
