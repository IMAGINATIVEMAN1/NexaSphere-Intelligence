/**
 * lib/campaigns.js — did the marketing pay for itself?
 *
 * Answers management question 4: "Which marketing campaigns generate the best
 * ROAS and profit ROI?"
 *
 * ROAS and Profit_ROI already exist as columns in Fact_Marketing. We recompute
 * both from spend, attributed revenue and attributed profit anyway, and report
 * whether our figures agree with the sheet's. A number you did not compute is a
 * number you cannot vouch for — and if the two ever disagree, the disagreement
 * is itself the finding.
 *
 * THE DISTINCTION THAT MATTERS. ROAS (revenue ÷ spend) is the number marketing
 * teams report, and it flatters: revenue is not profit. Profit ROI (attributed
 * contribution profit ÷ spend) is the number that says whether the campaign was
 * worth running. A campaign can post a healthy ROAS and still destroy money,
 * and on this dataset most of them do.
 */

import { formatNaira, toMinor, fromMinor, sumMinor } from './money.js';

/**
 * @param {Array} marketing  Fact_Marketing rows
 * @param {Array} campaigns  Dim_Campaigns rows
 */
export function campaignPerformance(marketing, campaigns = []) {
  const rows = Array.isArray(marketing) ? marketing : [];
  if (!rows.length) return { ok: false };

  const nameFor = new Map(
    (campaigns || []).map((c) => [String(c.Campaign_ID), String(c.Campaign_Name || c.Campaign_ID)])
  );

  const byCampaign = new Map();
  let statedRoasSum = 0;
  let statedRoasCount = 0;

  for (const r of rows) {
    const id = String(r.Campaign_ID ?? '');
    if (!id) continue;

    if (!byCampaign.has(id)) {
      byCampaign.set(id, {
        id,
        name: nameFor.get(id) || id,
        months: 0,
        spendMinor: 0,
        revenueMinor: 0,
        profitMinor: 0,
        impressions: 0,
        clicks: 0,
        orders: 0
      });
    }

    const c = byCampaign.get(id);
    c.months += 1;
    c.spendMinor += toMinor(r.Spend_NGN || 0);
    c.revenueMinor += toMinor(r.Attributed_Realized_Revenue_NGN || 0);
    c.profitMinor += toMinor(r.Attributed_Contribution_Profit_NGN || 0);
    c.impressions += r.Impressions || 0;
    c.clicks += r.Clicks || 0;
    c.orders += r.Attributed_Orders || 0;

    if (Number.isFinite(r.ROAS)) {
      statedRoasSum += r.ROAS;
      statedRoasCount += 1;
    }
  }

  const list = [...byCampaign.values()].map((c) => {
    const roas = c.spendMinor > 0 ? c.revenueMinor / c.spendMinor : null;
    const profitRoi = c.spendMinor > 0 ? c.profitMinor / c.spendMinor : null;
    const netMinor = c.profitMinor - c.spendMinor;

    return {
      ...c,
      spend: fromMinor(c.spendMinor),
      spendDisplay: formatNaira(c.spendMinor, { minor: true }),
      revenue: fromMinor(c.revenueMinor),
      revenueDisplay: formatNaira(c.revenueMinor, { minor: true }),
      profit: fromMinor(c.profitMinor),
      profitDisplay: formatNaira(c.profitMinor, { minor: true }),

      net: fromMinor(netMinor),
      netDisplay: formatNaira(netMinor, { minor: true }),
      /* The plain question: after paying for the campaign, was the business
       * better off? Everything else is a ratio; this is the money. */
      paidForItself: netMinor > 0,

      roas: roas === null ? null : Math.round(roas * 100) / 100,
      profitRoi: profitRoi === null ? null : Math.round(profitRoi * 100) / 100
    };
  });

  list.sort((a, b) => a.net - b.net); // worst first — that is what needs attention

  const totalSpendMinor = sumMinor(list.map((c) => c.spendMinor));
  const totalProfitMinor = sumMinor(list.map((c) => c.profitMinor));
  const totalRevenueMinor = sumMinor(list.map((c) => c.revenueMinor));
  const totalNetMinor = totalProfitMinor - totalSpendMinor;

  const losers = list.filter((c) => !c.paidForItself);

  /* Cross-check our ROAS against the sheet's own column. Agreement is stated on
   * screen; disagreement would be a finding in itself. */
  const ourRoas = totalSpendMinor > 0 ? totalRevenueMinor / totalSpendMinor : null;

  return {
    ok: true,
    campaigns: list,
    count: list.length,

    totalSpend: fromMinor(totalSpendMinor),
    totalSpendDisplay: formatNaira(totalSpendMinor, { minor: true }),
    totalRevenue: fromMinor(totalRevenueMinor),
    totalRevenueDisplay: formatNaira(totalRevenueMinor, { minor: true }),
    totalProfit: fromMinor(totalProfitMinor),
    totalProfitDisplay: formatNaira(totalProfitMinor, { minor: true }),

    totalNet: fromMinor(totalNetMinor),
    totalNetDisplay: formatNaira(Math.abs(totalNetMinor), { minor: true }),
    overallPaidForItself: totalNetMinor > 0,

    blendedRoas: ourRoas === null ? null : Math.round(ourRoas * 100) / 100,
    statedAverageRoas: statedRoasCount ? Math.round((statedRoasSum / statedRoasCount) * 100) / 100 : null,

    losers,
    loserCount: losers.length,
    loserNetDisplay: formatNaira(Math.abs(sumMinor(losers.map((c) => c.profitMinor - c.spendMinor))), { minor: true }),

    best: list[list.length - 1] || null,
    worst: list[0] || null
  };
}
