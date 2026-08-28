/**
 * lib/ask.js — plain-language questions, answered in code.
 *
 * Case Study 4 asks the assistant to "answer management questions in plain
 * language". The tempting build is to hand the spreadsheet to a language model
 * and let it answer. That produces confident figures nobody can check, and a
 * manager who acts on a hallucinated margin has been actively harmed.
 *
 * So the routing is deterministic: a question is matched to an intent, the
 * intent runs a real aggregation over transaction rows, and the answer is
 * assembled from computed figures. The model's only job — if it is reachable at
 * all — is to add a sentence of context around numbers it was handed and cannot
 * change.
 *
 * EVERY ANSWER CARRIES ITS TRACE: how many orders it was computed from and what
 * was grouped. A figure a manager cannot interrogate is a figure they should
 * not trust, and the trace is what turns this from an oracle into a tool.
 */

import { formatNaira } from './money.js';
import { table, groupBy, overview, monthly, discountBands } from './kpi.js';
import { campaignPerformance } from './campaigns.js';
import { inventoryHealth } from './inventory.js';
import { targetAttainment } from './targets.js';
import { employeeProfiles } from './insights.js';
import { runAudit } from './findings.js';

/* ------------------------------------------------------------------ *
 * Intents, in priority order. First match wins, so put the specific
 * patterns above the general ones.
 * ------------------------------------------------------------------ */

const INTENTS = [
  /* ORDER MATTERS, and these three sit at the top for a reason.
   *
   * "Which marketing campaigns give the best RETURN?" used to match the returns
   * intent and answer with product return rates. "WHERE are we missing targets?"
   * matched the region intent because of the word "where". Specific beats
   * general, always — a router that resolves by list position needs the narrow
   * patterns first. */
  {
    id: 'campaign',
    match: /\b(campaign|campaigns|marketing|advertis|ad spend|roas|roi|promotion)\b/i,
    run: campaignAnswer
  },
  {
    id: 'targets',
    match: /\b(target|targets|quota|goal|goals|plan|budgeted|attainment|missing our|behind plan)\b/i,
    run: targetsAnswer
  },
  {
    id: 'inventory',
    /* Plurals must match: \bstockout\b fails on "stockouts", which is how
     * "which stores are experiencing stockouts" ended up in the store ranker. */
    match: /\b(stocks?|stockouts?|stock-outs?|out of stock|inventor(y|ies)|overstocks?|excess stock|reorder|shelf|shelves|warehouse)\b/i,
    run: inventoryAnswer
  },
  {
    id: 'courier',
    match: /\b(courier|delivery|deliver|late|shipping|logistics|dispatch|partner)\b/i,
    run: (ctx) => byDimension(ctx, 'Courier', 'delivery partner', { sortBy: 'latePct', higherIsWorse: true })
  },
  {
    id: 'returns',
    /* "returned" must match too: \breturn\b fails on it, which sent
     * "which products get returned most" to the product ranker instead. */
    match: /\b(returns?|returned|returning|refunds?|refunded|sent back|coming back|defect)\b/i,
    run: returnsAnswer
  },
  {
    id: 'discount',
    match: /\b(discount|discounting|markdown|price cut|promo price)\b/i,
    run: discountAnswer
  },
  {
    id: 'margin-trend',
    match: /\b(margin|profitab|growth|growing|trend|over time|month|declin|expensive)\b/i,
    run: marginTrendAnswer
  },
  {
    id: 'region',
    match: /\b(region|regions|state|states|geography|where|location)\b/i,
    run: (ctx) => byDimension(ctx, 'Customer_Region', 'region')
  },
  {
    id: 'channel',
    match: /\b(channel|channels|online|store|retail|corporate|wholesale)\b/i,
    run: (ctx) => byDimension(ctx, 'Sales_Channel', 'sales channel')
  },
  {
    id: 'customer',
    match: /\b(customer|customers|segment|loyalty|tier|buyer)\b/i,
    run: (ctx) => byDimension(ctx, 'Customer_Type', 'customer type')
  },
  {
    id: 'product',
    match: /\b(product|products|item|items|sku|batch|best sell|top sell)\b/i,
    run: (ctx) => byId(ctx, 'Product_ID', 'product', ctx.dims.products, ['Product_Name', 'Product', 'Name'])
  },
  {
    id: 'store',
    match: /\b(store|stores|branch|branches|outlet|shop)\b/i,
    run: (ctx) => byId(ctx, 'Store_ID', 'store', ctx.dims.stores, ['Store_Name', 'Store', 'Name'])
  },
  {
    id: 'employee',
    match: /\b(employee|employees|staff|agent|agents|sales ?person|sales people|salesperson|salespeople|rep|performer)\b|\bwho (made|has|had|did) the (least|most|lowest|highest) sales?\b|\bwho sold the (least|most)\b/i,
    run: employeeAnswer
  },
  {
    id: 'strategy',
    match: /\b(grow|growth|increase profit|more profit|improve profit|improve|strategy|strategic|what should we do|how can we|how do we|make more money|make more profit|scale|successful profit|business plan)\b/i,
    run: strategyAnswer
  },
  {
    id: 'overview',
    match: /\b(overview|summary|how are we|overall|total|performance|revenue|profit|doing)\b/i,
    run: overviewAnswer
  }
];

/**
 * Answer a question.
 *
 * @param {string} question
 * @param {object} data  the loaded dataset
 * @returns {{ok:boolean, headline?:string, lines?:string[], table?:object, trace?:string, suggestions?:string[]}}
 */
export function ask(question, data) {
  const q = String(question || '').trim();
  if (!q) return { ok: false };

  const ctx = { q, t: table(data.sales), dims: data, ov: null };
  ctx.ov = overview(ctx.t);

  /* "By profit" and "by revenue" change the ranking, not the intent, so the
   * measure is read once here rather than in every handler. */
  ctx.measure = /\b(profit|margin|profitab|contribution)\b/i.test(q) ? 'profit' : 'revenue';
  ctx.worst = /\b(worst|lowest|least|poorest|weakest|bottom|problem|bad)\b/i.test(q);

  // Named employee questions should resolve even when the user omits words such as
  // "employee" or "sales" (e.g. "Tell me about Aisha Afolabi").
  if ((data.employees || []).some(e => q.toLowerCase().includes(String(e.Employee_Name || '').toLowerCase()))) {
    const answer = employeeAnswer(ctx);
    if (answer) return { ok: true, intent: 'employee', ...answer };
  }

  // Natural employee-sales questions often omit the word employee: "who made the least sales?"
  // Treat those as employee questions rather than falling through to the generic overview.
  if (/\bwho\b.*\b(least|most|highest|lowest)\b.*\b(sales?|sold)\b/i.test(q) || /\bwho\b.*\bsold\b.*\b(least|most)\b/i.test(q)) {
    const answer = employeeAnswer(ctx);
    if (answer) return { ok: true, intent: 'employee', ...answer };
  }

  for (const intent of INTENTS) {
    if (intent.match.test(q)) {
      const answer = intent.run(ctx);
      if (answer) return { ok: true, intent: intent.id, ...answer };
    }
  }

  return {
    ok: false,
    lines: [
      'I could not match that to something I can compute from this dataset, and I ' +
      'will not answer a question about money by guessing.'
    ],
    suggestions: [
      'Which region is least profitable?',
      'Which courier is worst on delivery?',
      'Which products get returned most?',
      'Is our growth becoming expensive?',
      'How is discounting affecting margin?'
    ]
  };
}

/* ------------------------------------------------------------------ *
 * Handlers
 * ------------------------------------------------------------------ */

function strategyAnswer(ctx) {
  const findings = runAudit(ctx.dims.sales, ctx.dims);
  const profit = findings.filter(f => f.kind === 'profit').slice(0, 4);
  const capital = findings.filter(f => f.kind === 'capital').slice(0, 2);
  const profiles = employeeProfiles(ctx.dims).filter(x => x.balancedScore != null).slice(0, 5);
  const lines = [
    `The highest-confidence growth strategy is to grow contribution profit, not revenue alone. NexaSphere currently has ${ctx.ov.profitDisplay} of contribution profit at a ${ctx.ov.marginPct}% margin, so the first job is to protect the economics of growth.`,
    ...profit.map((f, i) => `${i + 1}. ${f.title}. ${f.action}${f.opportunity?.gapDisplay ? ` The evidence-backed opportunity is ${f.opportunity.gapDisplay}.` : ''}`),
    `Then scale what is already working: the strongest balanced sales performers are ${profiles.slice(0, 3).map(x => `${x.employee} (${x.profit}, ${x.margin})`).join(', ')}. Study their product mix, channel and selling patterns before rolling the approach out more widely.`,
    capital.length ? `Finally, treat inventory separately from profit: ${capital[0].title}. It is a working-capital issue, not money that should be added to the profit opportunity.` : 'I would keep working-capital decisions separate from profit opportunities.'
  ];
  return {
    headline: ctx.ov.profitDisplay,
    lines,
    trace: `strategy assembled from ${findings.length} discovered audit findings plus employee performance profiles`
  };
}

function employeeAnswer(ctx) {
  const profiles = employeeProfiles(ctx.dims);
  const measurable = profiles.filter(x => x.balancedScore != null && x.orders > 0);
  if (!measurable.length) return null;
  const q = ctx.q;
  const lower = q.toLowerCase();
  const named = profiles.find(x => lower.includes(String(x.employee).toLowerCase()));
  const wantsWorst = /\b(worst|lowest|least|poorest|weakest|bottom|underperform|under-performing|underperforming|least sale|least sales|fewest sales)\b/i.test(q);
  const wantsProfit = /\b(profit|profitable|profitability|contribution)\b/i.test(q);
  const wantsRevenue = /\b(revenue|sale|sales|sold|selling|turnover)\b/i.test(q);
  const wantsProfile = /\b(each|every|all|what does|who does|role|responsib|profile|breakdown)\b/i.test(q);
  const wantsTop = /\b(top|best|strongest|highest|most)\b/i.test(q);

  let ordered;
  let metricLabel;
  if (wantsRevenue && !wantsProfit) {
    ordered = [...measurable].sort((a,b) => Number(String(b.revenue).replace(/[^0-9.-]/g,'')) - Number(String(a.revenue).replace(/[^0-9.-]/g,'')));
    metricLabel = 'revenue';
  } else if (wantsProfit) {
    ordered = [...measurable].sort((a,b) => Number(String(b.profit).replace(/[^0-9.-]/g,'')) - Number(String(a.profit).replace(/[^0-9.-]/g,'')));
    metricLabel = 'contribution profit';
  } else {
    ordered = [...measurable].sort((a,b) => (b.balancedScore ?? -1) - (a.balancedScore ?? -1));
    metricLabel = 'balanced performance';
  }

  if (wantsWorst) ordered.reverse();
  const selected = named ? [named] : wantsProfile ? profiles : ordered.slice(0, 12);
  const target = named || ordered[0];
  const isWorst = !named && wantsWorst;

  let lead;
  if (named) {
    lead = `${target.employee} is a ${target.role} on the ${target.team} team at ${target.store}. The supplied data records ${target.orders.toLocaleString()} sales orders, ${target.revenue} revenue, ${target.profit} contribution profit, a ${target.margin} margin and ${target.returnRate} returns.`;
  } else if (isWorst) {
    lead = `${target.employee} has the lowest recorded ${metricLabel} among sales employees with transaction activity in the supplied data: ${metricLabel === 'revenue' ? target.revenue : metricLabel === 'contribution profit' ? target.profit : `${target.balancedScore}/100 balanced performance`}.`;
  } else {
    lead = metricLabel === 'balanced performance'
      ? `${target.employee} is the strongest balanced sales performer in the supplied data, combining revenue and contribution profit into a transparent 50/50 ranking aid at ${target.balancedScore}/100.`
      : `${target.employee} has the highest recorded ${metricLabel} among sales employees with transaction activity: ${metricLabel === 'revenue' ? target.revenue : target.profit}.`;
  }

  const detail = `${target.employee} is a ${target.role} on the ${target.team} team at ${target.store}. Their recorded activity is concentrated in ${target.primaryCategory} through ${target.primaryChannel}, with ${target.revenue} revenue, ${target.profit} contribution profit, a ${target.margin} margin and ${target.returnRate} returns.`;
  return {
    headline: named ? (target.balancedScore == null ? 'Profile' : `${target.balancedScore}/100`) : (metricLabel === 'revenue' ? target.revenue : metricLabel === 'contribution profit' ? target.profit : `${target.balancedScore}/100`),
    lines: [lead, detail, `This analysis covers ${measurable.length} sales employees with recorded sales-agent transactions. It is not a complete workforce-performance assessment because the dataset does not contain comparable workload, hours or operating-cost measures for non-sales roles.`],
    table: {
      columns: ['Employee', 'Role', 'Team', 'Store', 'Orders', 'Revenue', 'Profit', 'Margin', 'Target attainment', 'Main activity', 'Balanced index', 'Recommendation'],
      rows: selected.map(x => [x.employee, x.role, x.team, x.store, x.orders.toLocaleString(), x.revenue, x.profit, x.margin, x.targetAttainment, `${x.primaryCategory} / ${x.primaryChannel}`, x.balancedScore == null ? '—' : `${x.balancedScore}/100`, x.recommendation || '—'])
    },
    trace: `profiled ${measurable.length} sales employees; ranking selected by ${metricLabel}${isWorst ? ' ascending' : ' descending'}`
  };
}

function overviewAnswer(ctx) {
  const ov = ctx.ov;
  return {
    headline: ov.revenueDisplay,
    lines: [
      `Across ${ov.orders.toLocaleString()} orders from ${ov.customers.toLocaleString()} customers ` +
      `over ${ov.monthCount} months, NexaSphere realised ${ov.revenueDisplay} in revenue and ` +
      `${ov.profitDisplay} in contribution profit — a margin of ${ov.marginPct}%.`,
      `Discounting accounts for ${ov.discountDisplay}, which is ${ov.discountSharePct}% of revenue. ` +
      `Refunds account for ${ov.refundDisplay}.`,
      `${ov.returnPct}% of orders are returned and ${ov.latePct}% arrive late. Average customer ` +
      `rating is ${ov.avgRating} out of 5.`
    ],
    trace: `computed from all ${ov.orders.toLocaleString()} order lines`
  };
}

/** Rank an interned text dimension: region, channel, courier, customer type. */
function byDimension(ctx, column, label, opts = {}) {
  const groups = groupBy(ctx.t, (r) => ctx.t.str(r, column)).filter((g) => g.orders >= 20);
  if (!groups.length) return null;
  return rankAnswer(ctx, groups, label, opts);
}

/** Rank an id dimension, resolving names from the dimension table. */
function byId(ctx, column, label, dim, nameKeys, dimKey) {
  /* The fact table and the dimension table do not always agree on the column
   * name for the same id — Sales_Agent_ID here, Employee_ID there. */
  const nameFor = lookup(dim, dimKey || column, nameKeys);
  const min = label === 'product' ? 20 : 10;
  const groups = groupBy(ctx.t, (r) => r[ctx.t.idx[column]])
    .filter((g) => g.orders >= min)
    .map((g) => ({ ...g, key: nameFor(g.key) || String(g.key) }));
  if (!groups.length) return null;
  return rankAnswer(ctx, groups, label);
}

/**
 * The shared ranking answer.
 *
 * Ranks on the measure the question asked for, states the winner in a sentence,
 * and hands back the full table so the manager can see the rest — including the
 * order counts that tell them how much weight a percentage carries.
 */
function rankAnswer(ctx, groups, label, opts = {}) {
  const sortKey = opts.sortBy || (ctx.measure === 'profit' ? 'profit' : 'revenue');
  const sorted = [...groups].sort((a, b) => (b[sortKey] ?? -Infinity) - (a[sortKey] ?? -Infinity));

  /* Direction depends on whether MORE of this metric is good or bad. Sorting
   * descending then reversing for "worst" is right for revenue and exactly
   * wrong for late delivery: it answered "which courier is worst" with the
   * best one. */
  const higherIsWorse = Boolean(opts.higherIsWorse);
  const wantsWorst = ctx.worst !== higherIsWorse;
  const ordered = wantsWorst ? [...sorted].reverse() : sorted;
  const top = ordered[0];
  const other = ordered[ordered.length - 1];

  const lines = [];

  if (opts.sortBy === 'latePct') {
    lines.push(
      `${top.key} is the ${ctx.worst ? 'worst' : 'best'} on delivery: ${top.latePct}% of its ` +
      `${top.orders.toLocaleString()} orders arrived late, ${top.returnPct}% were returned, and ` +
      `customers rated it ${top.avgRating} out of 5.`
    );
    lines.push(
      `${other.key} is at the other end — ${other.latePct}% late, ${other.returnPct}% returned, ` +
      `rated ${other.avgRating}.`
    );
  } else {
    const measureWord = ctx.measure === 'profit' ? 'contribution profit' : 'revenue';
    const val = ctx.measure === 'profit' ? top.profitDisplay : top.revenueDisplay;
    lines.push(
      `${top.key} is ${ctx.worst ? 'the weakest' : 'the strongest'} ${label} by ${measureWord}: ` +
      `${val} across ${top.orders.toLocaleString()} orders, at a ${top.marginPct}% margin.`
    );
    if (ordered.length > 1) {
      const otherVal = ctx.measure === 'profit' ? other.profitDisplay : other.revenueDisplay;
      lines.push(`At the other end, ${other.key} returned ${otherVal} at ${other.marginPct}%.`);
    }
  }

  /* Revenue rank and profit rank often disagree, and that disagreement is
   * usually the insight. Say it when it happens. */
  const byRevenue = [...groups].sort((a, b) => b.revenue - a.revenue);
  const byMargin = [...groups].filter((g) => g.marginPct !== null).sort((a, b) => b.marginPct - a.marginPct);
  if (byRevenue.length > 1 && byMargin.length > 1 && byRevenue[0].key !== byMargin[0].key) {
    lines.push(
      `Worth noting: the biggest ${label} by revenue (${byRevenue[0].key}) is not the most ` +
      `profitable (${byMargin[0].key} at ${byMargin[0].marginPct}%). Size and profitability are ` +
      `not the same question.`
    );
  }

  return {
    headline:
      opts.sortBy === 'latePct'
        ? `${top.latePct}% late`
        : ctx.measure === 'profit'
          ? top.profitDisplay
          : top.revenueDisplay,
    lines,
    table: {
      columns: ['', 'Orders', 'Revenue', 'Profit', 'Margin', 'Returns'],
      rows: ordered
        .slice(0, 12)
        .map((g) => [g.key, g.orders.toLocaleString(), g.revenueDisplay, g.profitDisplay, pct(g.marginPct), pct(g.returnPct)])
    },
    trace: `grouped ${ctx.t.count.toLocaleString()} order lines into ${groups.length} ${label}s`
  };
}

function returnsAnswer(ctx) {
  const ov = ctx.ov;
  const nameFor = lookup(ctx.dims.products, 'Product_ID', ['Product_Name', 'Product', 'Name']);
  const products = groupBy(ctx.t, (r) => r[ctx.t.idx.Product_ID])
    .filter((p) => p.orders >= 30)
    .sort((a, b) => b.returnPct - a.returnPct);

  if (!products.length) return null;
  const worst = products.slice(0, 10);

  return {
    headline: `${ov.returnPct}% overall`,
    lines: [
      `${ov.returnPct}% of all orders are returned, refunding ${ov.refundDisplay} in total.`,
      `The worst product returns ${worst[0].returnPct}% of its ${worst[0].orders} orders — more than ` +
      `${Math.round(worst[0].returnPct / ov.returnPct)} times the company rate.`,
      `A return rate this far above the norm points at the product or the batch, not the customer.`
    ],
    table: {
      columns: ['Product', 'Orders', 'Return rate', 'Refunded'],
      rows: worst.map((p) => [nameFor(p.key) || String(p.key), p.orders.toLocaleString(), pct(p.returnPct), p.refundDisplay])
    },
    trace: `ranked ${products.length} products with 30+ orders each`
  };
}

function discountAnswer(ctx) {
  const bands = discountBands(ctx.t);
  const losing = bands.filter((b) => b.marginPct !== null && b.marginPct < 0);

  const lines = [
    `Discounting costs ${ctx.ov.discountDisplay}, which is ${ctx.ov.discountSharePct}% of revenue.`
  ];

  if (losing.length) {
    const l = losing.reduce((a, b) => (a.revenueMinor > b.revenueMinor ? a : b));
    lines.push(
      `Margin falls with every step of discount, and past the "${l.label}" band it turns negative: ` +
      `${l.orders.toLocaleString()} orders worth ${l.revenueDisplay} came back at ${l.marginPct}%.`
    );
    lines.push(`Those orders are buying revenue with profit.`);
  } else {
    lines.push('No discount band is loss-making on this data.');
  }

  return {
    headline: ctx.ov.discountDisplay,
    lines,
    table: {
      columns: ['Discount band', 'Orders', 'Revenue', 'Profit', 'Margin'],
      rows: bands.map((b) => [b.label, b.orders.toLocaleString(), b.revenueDisplay, b.profitDisplay, pct(b.marginPct)])
    },
    trace: `${ctx.t.count.toLocaleString()} order lines bucketed by discount percentage`
  };
}

function marginTrendAnswer(ctx) {
  const months = monthly(ctx.t).filter((m) => m.orders >= 20);
  if (months.length < 4) return null;

  const half = Math.floor(months.length / 2);
  const early = months.slice(0, half);
  const late = months.slice(half);
  const avg = (arr) => {
    const rev = arr.reduce((s, m) => s + m.revenueMinor, 0);
    const prof = arr.reduce((s, m) => s + m.profitMinor, 0);
    return { rev, prof, margin: rev > 0 ? Math.round((prof / rev) * 10000) / 100 : null };
  };
  const a = avg(early);
  const b = avg(late);
  const worst = [...months].sort((x, y) => x.marginPct - y.marginPct).slice(0, 3);

  return {
    headline: `${a.margin}% → ${b.margin}%`,
    lines: [
      `Revenue rose from ${formatNaira(a.rev, { minor: true })} in the first half of the period to ` +
      `${formatNaira(b.rev, { minor: true })} in the second.`,
      `Margin went the other way: ${a.margin}% down to ${b.margin}%. The business is getting bigger ` +
      `and less profitable at the same time.`,
      `The thinnest margins land in ${worst.map((w) => `${w.key} (${w.marginPct}%)`).join(', ')} — ` +
      `and those are among the heaviest revenue months, which points at campaign discounting rather ` +
      `than rising costs.`
    ],
    table: {
      columns: ['Month', 'Orders', 'Revenue', 'Profit', 'Margin'],
      rows: months.map((m) => [m.key, m.orders.toLocaleString(), m.revenueDisplay, m.profitDisplay, pct(m.marginPct)])
    },
    trace: `${months.length} months, each computed from its own order lines`
  };
}

function campaignAnswer(ctx) {
  const c = campaignPerformance(ctx.dims.marketing, ctx.dims.campaigns);
  if (!c.ok) return null;

  const lines = [
    `${c.count} campaigns spent ${c.totalSpendDisplay} and were credited with ` +
    `${c.totalRevenueDisplay} of revenue and ${c.totalProfitDisplay} of contribution profit.`,
    c.overallPaidForItself
      ? `Net of spend, the programme is ahead by ${c.totalNetDisplay}.`
      : `Net of what they cost to run, the programme is DOWN ${c.totalNetDisplay}. ` +
        `${c.loserCount} of the ${c.count} campaigns cost more than they returned.`,
    `Blended return on ad spend is ${c.blendedRoas}×, which sounds healthy — but revenue is not ` +
    `profit. Measured on profit against spend, only ${c.best.name} clears 1.0 ` +
    `(${c.best.profitRoi}). The worst is ${c.worst.name} at ${c.worst.profitRoi}.`
  ];

  /* The sheet publishes its own ROAS column. Ours is spend-weighted; theirs is
   * a plain average of monthly rows. Saying so is cheaper than being asked. */
  if (c.statedAverageRoas !== null && Math.abs(c.statedAverageRoas - c.blendedRoas) > 0.05) {
    lines.push(
      `Note on method: the dataset's own ROAS column averages ${c.statedAverageRoas}× across monthly ` +
      `rows, unweighted. The ${c.blendedRoas}× above weights by spend, which is the figure that ` +
      `answers "did the money work".`
    );
  }

  return {
    headline: c.overallPaidForItself ? `+${c.totalNetDisplay}` : `−${c.totalNetDisplay}`,
    lines,
    table: {
      columns: ['Campaign', 'Spend', 'Attributed profit', 'Net', 'Profit ROI'],
      rows: c.campaigns.map((x) => [x.name, x.spendDisplay, x.profitDisplay, x.netDisplay, x.profitRoi])
    },
    trace: `${ctx.dims.marketing.length.toLocaleString()} monthly marketing rows across ${c.count} campaigns`
  };
}

function targetsAnswer(ctx) {
  const tg = targetAttainment(ctx.dims.targets, ctx.dims.sales, ctx.dims.stores);
  if (!tg.ok) return null;

  return {
    headline: `${tg.profitAttainPct}% of profit target`,
    lines: [
      `Revenue reached ${tg.revenueActualDisplay} against a target of ${tg.revenueTargetDisplay} — ` +
      `${tg.revenueAttainPct}% attainment, short by ${tg.revenueGapDisplay}.`,
      `Profit reached ${tg.profitActualDisplay} against ${tg.profitTargetDisplay} — ` +
      `${tg.profitAttainPct}% attainment, short by ${tg.profitGapDisplay}.`,
      `${tg.storesMissingProfit} of ${tg.storeCount} stores missed their profit target. Revenue ` +
      `attainment running ahead of profit attainment means the plan is being chased with discount ` +
      `rather than met with margin.`
    ],
    table: {
      columns: ['Store', 'Revenue attainment', 'Profit attainment', 'Profit gap', 'Months trading'],
      rows: tg.stores
        .slice(0, 12)
        .map((s) => [s.name, `${s.revenueAttainPct}%`, `${s.profitAttainPct}%`, s.profitGapDisplay, `${s.tradingMonths}/${s.targetMonths}`])
    },
    trace: `${ctx.dims.targets.length} monthly targets across ${tg.storeCount} stores, actuals from ${ctx.t.count.toLocaleString()} order lines`
  };
}

function inventoryAnswer(ctx) {
  const inv = inventoryHealth(ctx.dims.inventory, ctx.dims.stores);
  if (!inv.ok) return null;

  return {
    headline: inv.stockValueDisplay,
    lines: [
      `As at ${inv.stockValueAsAt}, ${inv.stockValueDisplay} of stock was on hand, and ` +
      `${inv.overstockSharePct}% of that value is classified Overstock.`,
      `At the same time ${inv.totalStockoutDays} stockout days were recorded across ` +
      `${inv.storesWithStockouts} stores — the business is over-stocked and running out at once, ` +
      `which is a distribution problem rather than a purchasing one.`,
      `Worst affected is ${inv.worstStockout.name} with ${inv.worstStockout.stockoutDays} days out of stock.`,
      `Method note: stock value is read from the latest month only. This sheet is a monthly snapshot, ` +
      `so adding the months together would count the same shelves ${inv.monthCount} times.`
    ],
    table: {
      columns: ['Store', 'Stockout days', 'Months overstocked', 'Stock on hand'],
      rows: inv.stores
        .slice(0, 12)
        .map((s) => [s.name, String(s.stockoutDays), `${s.overstockSharePct}%`, s.latestValueDisplay])
    },
    trace: `${inv.recordCount.toLocaleString()} monthly inventory records across ${inv.storeCount} stores`
  };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function pct(v) {
  return v === null || v === undefined ? '—' : `${v}%`;
}

function lookup(dim, idKey, nameKeys) {
  if (!Array.isArray(dim)) return () => null;
  const map = new Map();
  for (const row of dim) {
    const id = row[idKey];
    if (id === undefined || id === null) continue;
    const name = nameKeys.map((k) => row[k]).find((v) => v);
    if (name) map.set(String(id), String(name));
  }
  return (id) => map.get(String(id)) || null;
}
