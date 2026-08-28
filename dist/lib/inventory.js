/**
 * lib/inventory.js — stock health, stockouts and capital sitting still.
 *
 * Answers management question 5: "Which stores or regions are experiencing
 * stockouts or excess inventory?"
 *
 * THE TRAP IN THIS SHEET, and the reason this file has a long comment.
 * Fact_Inventory_Monthly is a MONTHLY SNAPSHOT. Closing_Stock_Value is what was
 * on the shelf at the end of that month — not something that happened during
 * it. Summing that column across 24 months counts the same shelves 24 times and
 * produces ₦218 billion of stock against ₦11.8 billion of annual revenue: a
 * figure so wrong it would discredit everything else on the page.
 *
 * Stock VALUE is therefore read from the latest month only.
 * Stockout DAYS are a flow, not a level, so those DO sum across months.
 *
 * Getting that distinction right is most of the work here.
 */

import { formatNaira, toMinor, fromMinor, sumMinor } from './money.js';

/**
 * @param {Array} inventory  Fact_Inventory_Monthly rows
 * @param {Array} stores     Dim_Stores rows
 */
export function inventoryHealth(inventory, stores = []) {
  const rows = Array.isArray(inventory) ? inventory : [];
  if (!rows.length) return { ok: false };

  const storeName = new Map(
    (stores || []).map((s) => [String(s.Store_ID), String(s.Store_Name || s.Store_ID)])
  );

  // The snapshot month to read levels from.
  const months = [...new Set(rows.map((r) => String(r.Month || '')).filter(Boolean))].sort();
  const latestMonth = months[months.length - 1];
  const latest = rows.filter((r) => String(r.Month) === latestMonth);

  /* LEVELS — latest snapshot only. */
  let latestValueMinor = 0;
  const healthCounts = new Map();
  const valueByHealth = new Map();

  for (const r of latest) {
    const v = toMinor(r.Closing_Inventory_Value_NGN || 0);
    latestValueMinor += v;
    const h = String(r.Inventory_Health || 'Unknown');
    healthCounts.set(h, (healthCounts.get(h) || 0) + 1);
    valueByHealth.set(h, (valueByHealth.get(h) || 0) + v);
  }

  /* FLOWS — summed across every month. */
  const byStore = new Map();
  let totalStockoutDays = 0;

  for (const r of rows) {
    const id = String(r.Store_ID || '');
    if (!id) continue;
    const days = r.Stockout_Days || 0;
    totalStockoutDays += days;

    if (!byStore.has(id)) {
      byStore.set(id, {
        id,
        name: storeName.get(id) || id,
        stockoutDays: 0,
        stockoutMonths: 0,
        months: 0,
        overstockMonths: 0,
        latestValueMinor: 0
      });
    }
    const s = byStore.get(id);
    s.months += 1;
    s.stockoutDays += days;
    if (days > 0) s.stockoutMonths += 1;
    if (/overstock/i.test(String(r.Inventory_Health || ''))) s.overstockMonths += 1;
    if (String(r.Month) === latestMonth) s.latestValueMinor += toMinor(r.Closing_Inventory_Value_NGN || 0);
  }

  const storeList = [...byStore.values()]
    .map((s) => ({
      ...s,
      latestValue: fromMinor(s.latestValueMinor),
      latestValueDisplay: formatNaira(s.latestValueMinor, { minor: true }),
      overstockSharePct: s.months ? Math.round((s.overstockMonths / s.months) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.stockoutDays - a.stockoutDays);

  const overstockValueMinor = valueByHealth.get('Overstock') || 0;
  const totalLatest = latestValueMinor || 1;

  return {
    ok: true,
    latestMonth,
    recordCount: rows.length,
    monthCount: months.length,
    storeCount: byStore.size,

    /* Explicitly labelled so nobody later mistakes it for a period total. */
    stockValueAsAt: latestMonth,
    stockValue: fromMinor(latestValueMinor),
    stockValueDisplay: formatNaira(latestValueMinor, { minor: true }),

    overstockValue: fromMinor(overstockValueMinor),
    overstockValueDisplay: formatNaira(overstockValueMinor, { minor: true }),
    overstockSharePct: Math.round((overstockValueMinor / totalLatest) * 1000) / 10,

    healthMix: [...healthCounts.entries()]
      .map(([k, v]) => ({ label: k, count: v, sharePct: Math.round((v / latest.length) * 1000) / 10 }))
      .sort((a, b) => b.count - a.count),

    totalStockoutDays,
    storesWithStockouts: storeList.filter((s) => s.stockoutDays > 0).length,
    stores: storeList,
    worstStockout: storeList[0] || null
  };
}
