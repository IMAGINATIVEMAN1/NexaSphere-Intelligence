/**
 * lib/findings.js — the Growth Audit.
 *
 * Case Study 4 asks for "at least three important business findings" and
 * "practical recommendations". Most tools answer that with observations:
 * revenue is up, margins are under pressure, consider reviewing discounting.
 *
 * An observation is not a decision. Every finding here carries three things:
 *
 *   1. WHAT is happening, in figures computed from transaction rows
 *   2. WHAT IT COST, in naira
 *   3. WHAT TO DO, and what doing it is worth
 *
 * The benchmark used to price an opportunity is always a rate the business is
 * ALREADY achieving somewhere in its own data — never an invented target. When
 * a manager pushes back with "that is not realistic", the answer is: your own
 * South-West stores did it last quarter.
 *
 * Findings are DISCOVERED, not hard-coded. Each detector runs against whatever
 * data is loaded and returns nothing when the pattern is not there. Point this
 * at a healthy business and the audit comes back short — which is the correct
 * behaviour, and the reason the detectors are written as thresholds rather than
 * as a script.
 */

import { formatNaira, fromMinor } from './money.js';
import { table, groupBy, overview, monthly, discountBands, opportunity } from './kpi.js';
import { campaignPerformance } from './campaigns.js';
import { inventoryHealth } from './inventory.js';
import { targetAttainment } from './targets.js';

/** A group needs this many orders before a percentage means anything. */
const MIN_ORDERS = 100;

/**
 * Run every detector against the dataset.
 * @returns {Array} findings, most valuable first
 */
export function runAudit(sales, dims = {}) {
  const t = table(sales);
  const ov = overview(t);

  const found = [
    detectMarketingLoss(dims),
    detectLossMakingDiscounts(t, ov),
    detectMarginDecline(t, ov),
    detectFailingCourier(t, ov),
    detectReturnHotspots(t, ov, dims),
    detectUnprofitableChannel(t, ov),
    detectTargetMiss(dims),
    detectDeadStock(dims)
  ].filter(Boolean);

  /* TWO KINDS OF VALUE, AND THEY MUST NOT BE ADDED.
   *
   * A profit opportunity is money the business could have earned. Capital tied
   * up in unsold stock is money it already owns, sitting in the wrong form —
   * it is not profit, it is not lost, and it cannot be recovered by earning it.
   * Summing the two produced a headline "recoverable" figure larger than annual
   * revenue, which is the kind of number that discredits a whole analysis.
   *
   * So they are typed, ranked separately, and totalled separately. */
  for (const f of found) {
    const gap = f.opportunity?.gap || 0;
    f.kind = f.opportunity?.kind || 'profit';

    if (f.kind === 'profit') {
      const share = ov.profit > 0 ? gap / ov.profit : 0;
      f.shareOfProfitPct = Math.round(share * 1000) / 10;
      f.severity = share >= 0.15 ? 'critical' : share >= 0.05 ? 'high' : 'medium';
    } else {
      /* Capital findings are graded against the money involved, not against
       * profit, because the comparison is meaningless. */
      f.shareOfProfitPct = null;
      f.severity = 'high';
    }
  }

  /* Profit findings first, biggest first; capital findings after, so the
   * reading order still puts earnings ahead of balance-sheet housekeeping. */
  const profitFindings = found.filter((f) => f.kind === 'profit').sort((a, b) => (b.opportunity?.gap || 0) - (a.opportunity?.gap || 0));
  const capitalFindings = found.filter((f) => f.kind !== 'profit').sort((a, b) => (b.opportunity?.gap || 0) - (a.opportunity?.gap || 0));

  return [...profitFindings, ...capitalFindings];
}

/* ------------------------------------------------------------------ *
 * 1. Discounting past the point where it pays
 * ------------------------------------------------------------------ */

function detectLossMakingDiscounts(t, ov) {
  const bands = discountBands(t);
  const losing = bands.filter((b) => b.marginPct !== null && b.marginPct < 0 && b.orders >= 20);
  if (!losing.length) return null;

  /* Benchmark: the best margin the business achieves at a SUSTAINABLE discount
   * level — light or moderate. Not the zero-discount rate, which is unrealistic
   * as a target for orders that needed a discount to close. */
  const sustainable = bands.filter((b) => ['light', 'moderate'].includes(b.key) && b.orders >= MIN_ORDERS);
  if (!sustainable.length) return null;
  const benchmark = sustainable.reduce((best, b) => (b.marginPct > best.marginPct ? b : best));

  const combined = mergeGroups(losing);
  const opp = opportunity(combined, benchmark.marginPct);

  return {
    id: 'loss-making-discounts',
    title: 'Deep discounts are selling below cost',
    what:
      `${combined.orders.toLocaleString()} orders worth ${combined.revenueDisplay} were sold at a ` +
      `discount steep enough to lose money. Their combined margin is ${combined.marginPct}%.`,
    cost:
      `Those orders returned ${combined.profitDisplay}. At the ${benchmark.marginPct}% margin this ` +
      `business already achieves on "${benchmark.label}" orders, they would have returned ` +
      `${opp.wouldEarnDisplay}.`,
    action:
      `Cap discounting at the level where margin is still positive. Every order beyond that point ` +
      `is buying revenue with profit.`,
    opportunity: opp,
    evidence: bands.map((b) => ({
      label: b.label,
      orders: b.orders,
      revenue: b.revenueDisplay,
      margin: b.marginPct
    }))
  };
}

/* ------------------------------------------------------------------ *
 * 2. Growth that costs more than it earns
 * ------------------------------------------------------------------ */

function detectMarginDecline(t, ov) {
  const months = monthly(t).filter((m) => m.orders >= 20);
  if (months.length < 8) return null;

  const half = Math.floor(months.length / 2);
  const early = mergeGroups(months.slice(0, half));
  const late = mergeGroups(months.slice(half));

  const revenueGrew = late.revenueMinor > early.revenueMinor;
  const marginFell = late.marginPct < early.marginPct;
  if (!revenueGrew || !marginFell) return null;

  const drop = Math.round((early.marginPct - late.marginPct) * 100) / 100;
  if (drop < 1) return null;

  const opp = opportunity(late, early.marginPct);

  /* The worst months are usually the biggest months — that is the whole point,
   * and naming them makes the pattern concrete rather than statistical. */
  const worst = [...months].sort((a, b) => a.marginPct - b.marginPct).slice(0, 2);

  return {
    id: 'margin-decline',
    title: 'Revenue is growing and profitability is falling',
    what:
      `Revenue rose from ${early.revenueDisplay} to ${late.revenueDisplay} across the two halves of ` +
      `this period, while margin fell from ${early.marginPct}% to ${late.marginPct}% — a drop of ${drop} points.`,
    cost:
      `Holding the earlier ${early.marginPct}% margin through the later period would have produced ` +
      `${opp.wouldEarnDisplay} instead of ${late.profitDisplay}.`,
    action:
      `Growth is being bought rather than earned. The worst margins land in the biggest months ` +
      `(${worst.map((w) => `${w.key} at ${w.marginPct}%`).join(', ')}), which points at campaign ` +
      `discounting rather than cost inflation. Look there first.`,
    opportunity: opp,
    evidence: months.map((m) => ({
      label: m.key,
      orders: m.orders,
      revenue: m.revenueDisplay,
      margin: m.marginPct
    }))
  };
}

/* ------------------------------------------------------------------ *
 * 3. A delivery partner costing more than it carries
 * ------------------------------------------------------------------ */

function detectFailingCourier(t, ov) {
  const couriers = groupBy(t, (r) => t.str(r, 'Courier')).filter((c) => c.orders >= MIN_ORDERS);
  if (couriers.length < 2) return null;

  const worst = couriers.reduce((w, c) => (c.latePct > w.latePct ? c : w));
  const best = couriers.reduce((b, c) => (c.returnPct < b.returnPct ? c : b));

  if (worst.key === best.key) return null;
  if (worst.latePct < 50 || worst.returnPct <= best.returnPct) return null;

  /* What the extra returns cost: the gap in return rate, applied to this
   * courier's own order count, at its own average refund per return. */
  const excessReturns = Math.round(((worst.returnPct - best.returnPct) / 100) * worst.orders);
  const refundPerReturn = worst.returns > 0 ? worst.refundMinor / worst.returns : 0;
  const excessCostMinor = Math.round(excessReturns * refundPerReturn);

  return {
    id: 'failing-courier',
    title: `${worst.key} is failing on delivery and it shows in returns`,
    what:
      `${worst.key} carried ${worst.orders.toLocaleString()} orders worth ${worst.revenueDisplay}. ` +
      `${worst.latePct}% arrived late, ${worst.returnPct}% came back, and customers rated it ` +
      `${worst.avgRating} out of 5.`,
    cost:
      `${best.key} returns just ${best.returnPct}% of its orders. Matching that rate would have ` +
      `avoided roughly ${excessReturns.toLocaleString()} returns, worth about ` +
      `${formatNaira(excessCostMinor, { minor: true })} in refunds alone — before the cost of ` +
      `handling them or the customers who do not come back.`,
    action:
      `Move volume from ${worst.key} to ${best.key}, or renegotiate on delivery times with a ` +
      `penalty attached. A courier late nine times in ten is not a logistics problem, it is a ` +
      `contract problem.`,
    opportunity: {
      gap: fromMinor(excessCostMinor),
      gapDisplay: formatNaira(excessCostMinor, { minor: true }),
      worthFixing: excessCostMinor > 0
    },
    evidence: couriers.map((c) => ({
      label: c.key,
      orders: c.orders,
      late: c.latePct,
      returns: c.returnPct,
      rating: c.avgRating
    }))
  };
}

/* ------------------------------------------------------------------ *
 * 4. Products coming back
 * ------------------------------------------------------------------ */

function detectReturnHotspots(t, ov, dims) {
  const products = groupBy(t, (r) => r[t.idx.Product_ID]).filter((p) => p.orders >= 30);
  if (products.length < 5) return null;

  const threshold = ov.returnPct * 2;
  const hot = products.filter((p) => p.returnPct >= threshold).sort((a, b) => b.refundMinor - a.refundMinor);
  if (!hot.length) return null;

  const nameFor = buildLookup(dims.products, 'Product_ID', ['Product_Name', 'Product', 'Name']);
  const combined = mergeGroups(hot);

  return {
    id: 'return-hotspots',
    title: `${hot.length} product${hot.length === 1 ? '' : 's'} return at more than double the company rate`,
    what:
      `The business returns ${ov.returnPct}% of orders overall. These ${hot.length} products return ` +
      `${combined.returnPct}% across ${combined.orders.toLocaleString()} orders.`,
    cost: `They have refunded ${combined.refundDisplay} between them.`,
    action:
      `A return rate this far above the norm is a product or batch problem, not a customer problem. ` +
      `Check the return reasons and the batch codes before reordering any of them.`,
    opportunity: {
      gap: combined.refund,
      gapDisplay: combined.refundDisplay,
      worthFixing: combined.refundMinor > 0
    },
    evidence: hot.slice(0, 10).map((p) => ({
      label: nameFor(p.key) || String(p.key),
      orders: p.orders,
      returns: p.returnPct,
      refunded: p.refundDisplay
    }))
  };
}

/* ------------------------------------------------------------------ *
 * 5. A sales channel that does not pay for itself
 * ------------------------------------------------------------------ */

function detectUnprofitableChannel(t, ov) {
  const channels = groupBy(t, (r) => t.str(r, 'Sales_Channel')).filter((c) => c.orders >= MIN_ORDERS);
  if (channels.length < 2) return null;

  const worst = channels.reduce((w, c) => (c.marginPct < w.marginPct ? c : w));
  const best = channels.reduce((b, c) => (c.marginPct > b.marginPct ? c : b));
  if (worst.key === best.key) return null;
  if (best.marginPct - worst.marginPct < 3) return null;

  const opp = opportunity(worst, best.marginPct);

  return {
    id: 'weak-channel',
    title: `${worst.key} earns far less per naira than ${best.key}`,
    what:
      `${worst.key} turned ${worst.revenueDisplay} into ${worst.profitDisplay} — a ${worst.marginPct}% ` +
      `margin, against ${best.marginPct}% on ${best.key}.`,
    cost: `Closing that gap on existing volume is worth ${opp.gapDisplay}.`,
    action:
      `Read this one carefully before acting: corporate and wholesale channels normally carry ` +
      `thinner margins than retail, so part of this gap is expected and closing it entirely is not ` +
      `a realistic target. The question worth asking is whether the gap is wider than the channel ` +
      `justifies — compare discounting and delivery cost between the two before concluding anything.`,
    opportunity: opp,
    evidence: channels.map((c) => ({
      label: c.key,
      orders: c.orders,
      revenue: c.revenueDisplay,
      margin: c.marginPct
    }))
  };
}

/* ------------------------------------------------------------------ *
 * 6. Marketing that costs more than it returns
 *
 * The largest finding in this dataset, and the one that explains the others:
 * the months with the worst margins are the months with the biggest campaigns.
 * ------------------------------------------------------------------ */

function detectMarketingLoss(dims) {
  const c = campaignPerformance(dims.marketing, dims.campaigns);
  if (!c.ok || c.overallPaidForItself) return null;

  const gap = Math.abs(c.totalNet);

  return {
    id: 'marketing-loss',
    title: 'Marketing spend is not paying for itself',
    what:
      `${c.count} campaigns spent ${c.totalSpendDisplay} and were credited with ` +
      `${c.totalProfitDisplay} of contribution profit. ${c.loserCount} of the ${c.count} cost more ` +
      `than they returned.`,
    cost:
      `Net of what they cost to run, the campaign programme is down ${c.totalNetDisplay}. The worst ` +
      `single campaign is ${c.worst.name}: ${c.worst.spendDisplay} spent for ` +
      `${c.worst.profitDisplay} of profit.`,
    action:
      `Marketing reports return on ad spend, and blended ROAS of ${c.blendedRoas}× looks healthy — but ` +
      `revenue is not profit. Judge campaigns on profit against spend and only ${c.best.name} clears ` +
      `the bar. Stop the negative-ROI campaigns before the next seasonal push and the margin problem ` +
      `largely goes with them.`,
    opportunity: { gap, gapDisplay: formatNaira(Math.round(gap * 100), { minor: true }), worthFixing: gap > 0 },
    evidence: c.campaigns.slice(0, 10).map((x) => ({
      label: x.name,
      spend: x.spendDisplay,
      profit: x.profitDisplay,
      net: x.netDisplay,
      'profit ROI': x.profitRoi
    }))
  };
}

/* ------------------------------------------------------------------ *
 * 7. Missing its own targets
 * ------------------------------------------------------------------ */

function detectTargetMiss(dims) {
  const tg = targetAttainment(dims.targets, dims.sales, dims.stores);
  if (!tg.ok || !tg.missedProfit) return null;

  const gap = Math.abs(tg.profitGap);

  return {
    id: 'target-miss',
    title: 'Every store is short of its profit target',
    what:
      `Against a company profit target of ${tg.profitTargetDisplay}, the business delivered ` +
      `${tg.profitActualDisplay} — ${tg.profitAttainPct}% attainment. Revenue reached ` +
      `${tg.revenueAttainPct}% of its own target.`,
    cost:
      `The profit shortfall is ${tg.profitGapDisplay}. ${tg.storesMissingProfit} of ${tg.storeCount} ` +
      `stores missed, so this is not a few weak branches — it is the plan.`,
    action:
      `Revenue attainment (${tg.revenueAttainPct}%) is running ahead of profit attainment ` +
      `(${tg.profitAttainPct}%), which says the targets are being chased with discount rather than ` +
      `met with margin. Re-cut the targets against contribution profit, not turnover.`,
    opportunity: { gap, gapDisplay: tg.profitGapDisplay, worthFixing: gap > 0 },
    evidence: tg.stores.slice(0, 10).map((s) => ({
      label: s.name,
      'revenue attainment': s.revenueAttainPct,
      'profit attainment': s.profitAttainPct,
      'profit gap': s.profitGapDisplay
    }))
  };
}

/* ------------------------------------------------------------------ *
 * 8. Capital sitting on shelves
 * ------------------------------------------------------------------ */

function detectDeadStock(dims) {
  const inv = inventoryHealth(dims.inventory, dims.stores);
  if (!inv.ok) return null;
  if (inv.overstockSharePct < 50 && inv.totalStockoutDays === 0) return null;

  /* Overstock is not a loss — the goods can still be sold. What it costs is the
   * use of the money while it sits. Nothing in the dataset states a cost of
   * capital, so none is invented: the finding reports the amount tied up and
   * says plainly that the carrying cost is not in this data. */
  return {
    id: 'dead-stock',
    title: 'Almost all stock is sitting as overstock',
    what:
      `As at ${inv.stockValueAsAt}, ${inv.stockValueDisplay} of stock was on hand and ` +
      `${inv.overstockSharePct}% of it was classified Overstock. Separately, ${inv.totalStockoutDays} ` +
      `stockout days were recorded across ${inv.storesWithStockouts} stores — the business is ` +
      `simultaneously over-stocked and running out.`,
    cost:
      `${inv.overstockValueDisplay} of working capital is tied up in goods that are not moving, while ` +
      `${inv.worstStockout.name} lost ${inv.worstStockout.stockoutDays} days to being out of stock.`,
    action:
      `This is a distribution problem before it is a purchasing one: the stock exists, it is in the ` +
      `wrong places. Rebalance between stores before ordering more, and reset reorder points against ` +
      `actual sell-through per store.`,
    opportunity: {
      gap: inv.overstockValue,
      gapDisplay: inv.overstockValueDisplay,
      worthFixing: true,
      kind: 'capital',
      note: 'working capital tied up — not profit lost, and not additive with the figures above'
    },
    evidence: inv.stores.slice(0, 10).map((s) => ({
      label: s.name,
      'stockout days': s.stockoutDays,
      'overstock months': `${s.overstockSharePct}%`,
      'stock on hand': s.latestValueDisplay
    }))
  };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Combine several groups into one, re-deriving every percentage from totals. */
function mergeGroups(groups) {
  const acc = {
    orders: 0,
    revenueMinor: 0,
    profitMinor: 0,
    refundMinor: 0,
    discountMinor: 0,
    returns: 0,
    late: 0
  };

  for (const g of groups) {
    acc.orders += g.orders;
    acc.revenueMinor += g.revenueMinor;
    acc.profitMinor += g.profitMinor;
    acc.refundMinor += g.refundMinor;
    acc.discountMinor += g.discountMinor;
    acc.returns += g.returns;
    acc.late += g.late;
  }

  return {
    ...acc,
    revenue: fromMinor(acc.revenueMinor),
    revenueDisplay: formatNaira(acc.revenueMinor, { minor: true }),
    profit: fromMinor(acc.profitMinor),
    profitDisplay: formatNaira(acc.profitMinor, { minor: true }),
    refund: fromMinor(acc.refundMinor),
    refundDisplay: formatNaira(acc.refundMinor, { minor: true }),
    marginPct: acc.revenueMinor > 0 ? Math.round((acc.profitMinor / acc.revenueMinor) * 10000) / 100 : null,
    returnPct: acc.orders > 0 ? Math.round((acc.returns / acc.orders) * 10000) / 100 : null
  };
}

/** Build an id → name lookup from a dimension table, tolerating column naming. */
function buildLookup(dim, idKey, nameKeys) {
  if (!Array.isArray(dim)) return () => null;
  const map = new Map();
  for (const row of dim) {
    const id = row[idKey];
    if (id === undefined) continue;
    const name = nameKeys.map((k) => row[k]).find((v) => v);
    if (name) map.set(String(id), String(name));
  }
  return (id) => map.get(String(id)) || null;
}
