/**
 * lib/targets.js — where the business is missing its own targets.
 *
 * Answers management question 9: "Where is NexaSphere missing its targets, and
 * what should management do next?"
 *
 * Targets_Monthly holds a revenue, profit, orders, return-rate, delivery and
 * CSAT target per store per month. Attainment is actual ÷ target, and actuals
 * come from the transaction rows — never from another target column.
 *
 * ONE HONEST CONSTRAINT, stated on screen rather than buried. Targets are set
 * per STORE. The fact table records a Store_ID per order line, so store-level
 * attainment is sound. But if a store has targets for months in which it made
 * no sales, attainment for that store reads as a total miss — which may be a
 * store that had not opened yet rather than one that failed. Coverage is
 * therefore reported alongside attainment, so a reader can tell the difference.
 */

import { formatNaira, toMinor, fromMinor, sumMinor } from './money.js';
import { table } from './kpi.js';

/**
 * @param {Array} targets  Targets_Monthly rows
 * @param {object} sales   the sales table payload
 * @param {Array} stores   Dim_Stores rows
 */
export function targetAttainment(targets, sales, stores = []) {
  const rows = Array.isArray(targets) ? targets : [];
  if (!rows.length || !sales) return { ok: false };

  const t = table(sales);
  const storeName = new Map(
    (stores || []).map((s) => [String(s.Store_ID), String(s.Store_Name || s.Store_ID)])
  );

  /* Actuals, per store, from transaction rows. */
  const actual = new Map();
  for (const row of t.rows) {
    const id = String(row[t.idx.Store_ID] ?? '');
    if (!id) continue;
    if (!actual.has(id)) actual.set(id, { revenueMinor: 0, profitMinor: 0, orders: 0, months: new Set() });
    const a = actual.get(id);
    a.revenueMinor += t.minor(row, 'Realized_Revenue_NGN');
    a.profitMinor += t.minor(row, 'Contribution_Profit_NGN');
    a.orders += 1;
    a.months.add(t.str(row, 'Order_Month'));
  }

  /* Targets, per store. */
  const target = new Map();
  for (const r of rows) {
    const id = String(r.Store_ID || '');
    if (!id) continue;
    if (!target.has(id)) target.set(id, { revenueMinor: 0, profitMinor: 0, orders: 0, months: 0 });
    const g = target.get(id);
    g.revenueMinor += toMinor(r.Revenue_Target_NGN || 0);
    g.profitMinor += toMinor(r.Contribution_Profit_Target_NGN || 0);
    g.orders += r.Orders_Target || 0;
    g.months += 1;
  }

  const list = [];
  for (const [id, tg] of target.entries()) {
    const act = actual.get(id) || { revenueMinor: 0, profitMinor: 0, orders: 0, months: new Set() };

    const revenueAttain = tg.revenueMinor > 0 ? act.revenueMinor / tg.revenueMinor : null;
    const profitAttain = tg.profitMinor > 0 ? act.profitMinor / tg.profitMinor : null;

    list.push({
      id,
      name: storeName.get(id) || id,
      targetMonths: tg.months,
      tradingMonths: act.months.size,
      /* Coverage separates "failed" from "was not open yet". */
      coveragePct: tg.months ? Math.round((act.months.size / tg.months) * 1000) / 10 : null,

      revenueTargetDisplay: formatNaira(tg.revenueMinor, { minor: true }),
      revenueActualDisplay: formatNaira(act.revenueMinor, { minor: true }),
      revenueGap: fromMinor(act.revenueMinor - tg.revenueMinor),
      revenueGapDisplay: formatNaira(act.revenueMinor - tg.revenueMinor, { minor: true }),
      revenueAttainPct: revenueAttain === null ? null : Math.round(revenueAttain * 1000) / 10,

      profitTargetDisplay: formatNaira(tg.profitMinor, { minor: true }),
      profitActualDisplay: formatNaira(act.profitMinor, { minor: true }),
      profitGap: fromMinor(act.profitMinor - tg.profitMinor),
      profitGapDisplay: formatNaira(act.profitMinor - tg.profitMinor, { minor: true }),
      profitAttainPct: profitAttain === null ? null : Math.round(profitAttain * 1000) / 10,

      metRevenue: revenueAttain !== null && revenueAttain >= 1,
      metProfit: profitAttain !== null && profitAttain >= 1
    });
  }

  list.sort((a, b) => (a.profitAttainPct ?? 999) - (b.profitAttainPct ?? 999));

  const totalRevenueTargetMinor = sumMinor([...target.values()].map((g) => g.revenueMinor));
  const totalProfitTargetMinor = sumMinor([...target.values()].map((g) => g.profitMinor));
  const totalRevenueActualMinor = sumMinor([...actual.values()].map((g) => g.revenueMinor));
  const totalProfitActualMinor = sumMinor([...actual.values()].map((g) => g.profitMinor));

  return {
    ok: true,
    storeCount: list.length,
    stores: list,

    revenueTargetDisplay: formatNaira(totalRevenueTargetMinor, { minor: true }),
    revenueActualDisplay: formatNaira(totalRevenueActualMinor, { minor: true }),
    revenueGap: fromMinor(totalRevenueActualMinor - totalRevenueTargetMinor),
    revenueGapDisplay: formatNaira(Math.abs(totalRevenueActualMinor - totalRevenueTargetMinor), { minor: true }),
    revenueAttainPct: totalRevenueTargetMinor
      ? Math.round((totalRevenueActualMinor / totalRevenueTargetMinor) * 1000) / 10
      : null,

    profitTargetDisplay: formatNaira(totalProfitTargetMinor, { minor: true }),
    profitActualDisplay: formatNaira(totalProfitActualMinor, { minor: true }),
    profitGap: fromMinor(totalProfitActualMinor - totalProfitTargetMinor),
    profitGapDisplay: formatNaira(Math.abs(totalProfitActualMinor - totalProfitTargetMinor), { minor: true }),
    profitAttainPct: totalProfitTargetMinor
      ? Math.round((totalProfitActualMinor / totalProfitTargetMinor) * 1000) / 10
      : null,

    missedRevenue: totalRevenueActualMinor < totalRevenueTargetMinor,
    missedProfit: totalProfitActualMinor < totalProfitTargetMinor,
    storesMissingProfit: list.filter((s) => !s.metProfit).length,
    worst: list[0] || null
  };
}
