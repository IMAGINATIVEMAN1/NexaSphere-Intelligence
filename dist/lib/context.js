/**
 * lib/context.js — assemble the evidence a question needs.
 *
 * THE ARCHITECTURE THIS FILE EXISTS TO SERVE.
 *
 * An earlier version of this app matched a question to one canned handler and
 * printed its output. Two different questions — "what do we do to make more
 * profit" and "can we still make more profit" — returned an identical
 * paragraph, and "tell me all of this in plain English" was refused outright.
 * That is a lookup table, not an assistant, and the case study asks for an
 * assistant.
 *
 * The correct division of labour:
 *
 *   COMPUTE the facts here, deterministically, in integer kobo.
 *   REASON over them in the model, which may not introduce a single figure.
 *   ENFORCE that with lib/numberguard.js, which deletes any number the model
 *   volunteers that was not in the evidence bundle.
 *
 * So this file does retrieval, not answering. It reads the question, decides
 * which slices of the business are relevant, computes them, and hands back a
 * fact sheet. Breadth is deliberate: a manager asking "where is profit leaking"
 * needs the campaign, discount and courier numbers together, and a router that
 * picks exactly one of them cannot answer that question at all.
 */

import { table, overview, monthly, discountBands, groupBy } from './kpi.js';
import { runAudit } from './findings.js';
import { campaignPerformance } from './campaigns.js';
import { inventoryHealth } from './inventory.js';
import { targetAttainment } from './targets.js';
import { returnReasons, categoryPerformance, customerValue, employeePerformance, employeeProfiles, growthPlaybook, dataCoverage } from './insights.js';

/** Topics a question can touch. A question may touch several. */
const TOPICS = [
  { id: 'campaigns', re: /\b(campaign|marketing|advertis|ad spend|roas|roi|promotion)\b/i },
  { id: 'targets',   re: /\b(targets?|quotas?|goals?|plan|attainment|behind|short(fall|falls|falls?)?)\b/i },
  { id: 'inventory', re: /\b(stocks?|stockouts?|inventor|overstock|excess|reorder|warehouse|shelves?)\b/i },
  { id: 'delivery',  re: /\b(courier|deliver|late|shipping|logistics|dispatch)\b/i },
  { id: 'returns',   re: /\b(returns?|returned|refund|defect|batch|quality)\b/i },
  { id: 'discount',  re: /\b(discount|markdown|price|pricing|promo)\b/i },
  { id: 'trend',     re: /\b(trend|month|growth|growing|over time|declin|season|expensive)\b/i },
  { id: 'region',    re: /\b(region|state|geography|location|lagos|north|south|east|west)\b/i },
  { id: 'channel',   re: /\b(channel|online|retail|corporate|wholesale|marketplace)\b/i },
  { id: 'customer',  re: /\b(customer|segment|loyalty|tier|buyer|repeat|new)\b/i },
  { id: 'product',   re: /\b(product|item|sku|category|brand|supplier)\b/i },
  { id: 'store',     re: /\b(store|branch|outlet|shop|hub)\b/i },
  { id: 'employee',  re: /\b(employees?|staff|agents?|reps?|sales ?people|sales ?persons?|salespeople|performers?|team)\b/i }
];

/**
 * Questions that need the whole picture rather than one slice: strategy,
 * summaries, "what should we do", "explain this to me".
 */
const BROAD =
  /\b(what should|what do we|what can we|how (do|can) we|improve|fix|increase|grow|more profit|better|advice|recommend|priorit|strategy|plan|summar|overview|explain|plain english|simple|overall|biggest problem|main issue|going wrong|why)\b/i;

/**
 * Build the evidence bundle for a question.
 *
 * @param {string} question
 * @param {object} data  full dataset
 * @returns {{question:string, topics:string[], broad:boolean, facts:object, findings:Array, tables:Array}}
 */
export function buildContext(question, data) {
  const q = String(question || '');
  const t = table(data.sales);
  const ov = overview(t);

  let topics = TOPICS.filter((x) => x.re.test(q)).map((x) => x.id);
  // Natural-language questions often omit the noun: "who made the least sales?"
  // and "who is the weakest performer?" are still employee questions.
  if (!topics.includes('employee') && /\bwho\b.*\b(least|most|highest|lowest|best|worst|weakest|perform|sales?|sold)\b/i.test(q)) topics.push('employee');
  if (!topics.includes('targets') && /\b(where|which|who)\b.*\b(missing|miss|fail|failing|short|behind)\b.*\btarget/i.test(q)) topics.push('targets');
  const broad = BROAD.test(q);

  /* The audit is ALWAYS included. It is the most valuable thing the system
   * knows, it is already computed, and almost every management question is
   * really a question about one of these findings. */
  const findings = runAudit(data.sales, data).map((f) => ({
    title: f.title,
    severity: f.severity,
    kind: f.kind,
    what: f.what,
    cost: f.cost,
    action: f.action,
    worth: f.opportunity?.gapDisplay || null
  }));

  const facts = {
    period: `${ov.monthCount} months`,
    orders: ov.orders.toLocaleString(),
    customers: ov.customers.toLocaleString(),
    revenue: ov.revenueDisplay,
    contributionProfit: ov.profitDisplay,
    margin: `${ov.marginPct}%`,
    discountsGiven: ov.discountDisplay,
    discountShareOfRevenue: `${ov.discountSharePct}%`,
    refunds: ov.refundDisplay,
    returnRate: `${ov.returnPct}%`,
    lateDeliveryRate: `${ov.latePct}%`,
    averageRating: `${ov.avgRating} out of 5`,
    dataCoverage: dataCoverage(data)
  };

  // Scenario questions are calculated from the supplied economics, but the engine
  // never pretends it knows the behavioural response to a hypothetical change.
  if (/\bwhat if\b|\bif we (cut|reduce|increase|raise|stop|remove)\b/i.test(q)) {
    if (/\bmarketing|campaigns?\b/i.test(q) && /\b(cut|reduce|halve|50%|half)\b/i.test(q)) {
      const c = campaignPerformance(data.marketing, data.campaigns);
      if (c.ok) {
        facts.scenario = `A 50% marketing-spend reduction would reduce recorded marketing spend by ${formatHalf(c.totalSpendDisplay)}. The dataset does not establish how much attributed revenue or contribution profit would fall when spend is reduced, so the business impact cannot be predicted without an elasticity assumption.`;
      }
    }
  }

  const tables = [];
  const want = (id) => broad || topics.includes(id);

  if (want('trend')) {
    const m = monthly(t).filter((x) => x.orders >= 20);
    tables.push({
      name: 'Revenue and margin by month',
      rows: m.map((x) => ({ month: x.key, revenue: x.revenueDisplay, margin: `${x.marginPct}%`, orders: x.orders }))
    });
  }

  if (want('discount')) {
    tables.push({
      name: 'Margin by discount band',
      rows: discountBands(t).map((b) => ({
        band: b.label, orders: b.orders, revenue: b.revenueDisplay, margin: `${b.marginPct}%`
      }))
    });
  }

  if (want('campaigns')) {
    const c = campaignPerformance(data.marketing, data.campaigns);
    if (c.ok) {
      facts.marketingSpend = c.totalSpendDisplay;
      facts.marketingAttributedProfit = c.totalProfitDisplay;
      facts.marketingNetPosition = `${c.overallPaidForItself ? '+' : '-'}${c.totalNetDisplay}`;
      facts.blendedROAS = `${c.blendedRoas}x`;
      tables.push({
        name: 'Campaigns, worst first',
        rows: c.campaigns.map((x) => ({
          campaign: x.name, spend: x.spendDisplay, attributedProfit: x.profitDisplay,
          net: x.netDisplay, profitROI: x.profitRoi
        }))
      });
    }
  }

  if (want('targets')) {
    const tg = targetAttainment(data.targets, data.sales, data.stores);
    if (tg.ok) {
      facts.revenueTarget = tg.revenueTargetDisplay;
      facts.revenueAttainment = `${tg.revenueAttainPct}%`;
      facts.profitTarget = tg.profitTargetDisplay;
      facts.profitAttainment = `${tg.profitAttainPct}%`;
      facts.storesMissingProfitTarget = `${tg.storesMissingProfit} of ${tg.storeCount}`;
      tables.push({
        name: 'Target attainment by store, worst first',
        rows: tg.stores.slice(0, 12).map((s) => ({
          store: s.name, revenueAttainment: `${s.revenueAttainPct}%`,
          profitAttainment: `${s.profitAttainPct}%`, profitGap: s.profitGapDisplay
        }))
      });
    }
  }

  if (want('inventory')) {
    const inv = inventoryHealth(data.inventory, data.stores);
    if (inv.ok) {
      facts.stockOnHand = `${inv.stockValueDisplay} as at ${inv.stockValueAsAt}`;
      facts.overstockShare = `${inv.overstockSharePct}% of stock value`;
      facts.stockoutDays = String(inv.totalStockoutDays);
      tables.push({
        name: 'Inventory by store, most stockout days first',
        rows: inv.stores.slice(0, 12).map((s) => ({
          store: s.name, stockoutDays: s.stockoutDays,
          monthsOverstocked: `${s.overstockSharePct}%`, stockOnHand: s.latestValueDisplay
        }))
      });
    }
  }

  if (want('delivery')) tables.push(dimTable(t, 'Courier', 'Delivery partners'));
  if (want('region')) tables.push(dimTable(t, 'Customer_Region', 'Regions'));
  if (want('channel')) tables.push(dimTable(t, 'Sales_Channel', 'Sales channels'));
  if (want('customer')) tables.push(dimTable(t, 'Customer_Type', 'Customer types'));
  if (want('product')) {
    tables.push(idTable(t, 'Product_ID', 'Products, top by revenue', data.products, 'Product_ID', 'Product_Name', 20));
    tables.push(idTable(t, 'Product_ID', 'Products, lowest by revenue', data.products, 'Product_ID', 'Product_Name', 20, null, true));
  }
  if (want('store')) {
    tables.push(idTable(t, 'Store_ID', 'Stores, top by revenue', data.stores, 'Store_ID', 'Store_Name', 24));
    tables.push(idTable(t, 'Store_ID', 'Stores, lowest by revenue', data.stores, 'Store_ID', 'Store_Name', 24, null, true));
  }
  if (want('employee')) tables.push(idTable(t, 'Sales_Agent_ID', 'Sales agents, top by revenue', data.employees, 'Employee_ID', 'Employee_Name', 15));
  if (want('returns')) {
    tables.push(idTable(t, 'Product_ID', 'Products by return rate', data.products, 'Product_ID', 'Product_Name', 15, 'returnPct'));
    tables.push({ name: 'Return reasons', rows: returnReasons(data) });
  }

  // Derived views make the assistant materially smarter without inventing raw data.
  // They are cheap enough to include for broad management questions.
  if (broad || topics.includes('customer')) tables.push({ name: 'Customer value by supplied segment', rows: customerValue(data) });
  if (broad || topics.includes('product')) tables.push({ name: 'Product category performance', rows: categoryPerformance(data).sort((a,b) => Number(b.profit.replace(/[^0-9.-]/g,'')) - Number(a.profit.replace(/[^0-9.-]/g,''))) });
  if (broad || topics.includes('employee')) {
    const profiles = employeeProfiles(data);
    const measurable = profiles.filter(x => x.balancedScore != null && x.orders > 0);
    const explicitAll = /\b(each|every|all)\b/i.test(q);
    const wantsWorst = /\b(worst|lowest|least|poorest|weakest|bottom|underperform|least sale|least sales|fewest sales)\b/i.test(q);
    const wantsProfit = /\b(profit|profitable|profitability|contribution)\b/i.test(q);
    const wantsRevenue = /\b(revenue|sales|sold|selling|turnover)\b/i.test(q);
    const metric = wantsRevenue && wantsProfit ? 'balancedScore' : wantsRevenue ? 'revenue' : wantsProfit ? 'profit' : 'balancedScore';
    const ranked = [...measurable].sort((a,b) => {
      const av = metric === 'balancedScore' ? (a.balancedScore ?? -1) : Number(String(a[metric]).replace(/[^0-9.-]/g,''));
      const bv = metric === 'balancedScore' ? (b.balancedScore ?? -1) : Number(String(b[metric]).replace(/[^0-9.-]/g,''));
      return wantsWorst ? av - bv : bv - av;
    });
    const relevant = explicitAll
      ? profiles
      : [...ranked.slice(0, 12), ...ranked.slice(-12)].filter((x, i, arr) => arr.findIndex(y => y.employeeId === x.employeeId) === i);
    tables.push({ name: `Employee ranking relevant to question (${wantsWorst ? 'lowest' : 'highest'} ${metric})`, rows: relevant.map(x => ({
      employee: x.employee, role: x.role, team: x.team, store: x.store, orders: x.orders, revenue: x.revenue, profit: x.profit, margin: x.margin, returnRate: x.returnRate, targetAttainment: x.targetAttainment, balancedScore: x.balancedScore == null ? '—' : `${x.balancedScore}/100`, mainActivity: `${x.primaryCategory} / ${x.primaryChannel}`
    })) });
    if (explicitAll) tables.push({
      name: 'Employee performance and role profiles',
      rows: profiles.map(x => ({
        employee: x.employee, role: x.role, department: x.department, team: x.team, store: x.store,
        status: x.status, orders: x.orders, revenue: x.revenue, profit: x.profit, margin: x.margin,
        returnRate: x.returnRate, targetAttainment: x.targetAttainment, mainActivity: `${x.primaryCategory} / ${x.primaryChannel}`
      }))
    });
    facts.employeeCount = String(profiles.length);
    facts.measurableSalesEmployees = String(measurable.length);
    facts.growthPrinciple = growthPlaybook(data).principle;
    facts.employeeGuardrails = growthPlaybook(data).guardrails.join(' ');
  }
  if (broad) {
    const gp = growthPlaybook(data);
    facts.growthPlaybook = gp.priorities.map(x => x.title + ': ' + x.action).join(' | ');
  }

  let cleanTables = tables.filter(Boolean);
  // Broad questions need a cross-functional pack, but not every table. Keeping
  // the highest-value domains makes prompts small enough to be reliable while
  // preserving the evidence needed for executive questions.
  if (broad && topics.length === 0) {
    const priority = [
      /campaign/i, /discount/i, /target/i, /employee/i, /inventory/i, /delivery/i,
      /trend/i, /store/i, /product category/i, /region/i, /channel/i, /customer/i
    ];
    cleanTables.sort((a, b) => {
      const ai = priority.findIndex(re => re.test(a.name));
      const bi = priority.findIndex(re => re.test(b.name));
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
    cleanTables = cleanTables.slice(0, 12);
  }
  // Put the domain most likely to answer the current question first. This is
  // retrieval, not an answer: Claude still decides what the question means.
  const employeeQuestion = topics.includes('employee') ||
    /\bwho\b.*\b(sales?|sold|employee|staff|perform|best|worst|least|most)\b/i.test(q) ||
    (data.employees || []).some(e => String(e.Employee_Name || '').toLowerCase() && q.toLowerCase().includes(String(e.Employee_Name || '').toLowerCase()));
  if (employeeQuestion) {
    cleanTables.sort((a,b) => Number(/employee/i.test(b.name)) - Number(/employee/i.test(a.name)));
  }
  return { question: q, topics, broad, facts, findings, tables: cleanTables, coverage: dataCoverage(data) };
}

function dimTable(t, column, name) {
  const rows = groupBy(t, (r) => t.str(r, column))
    .filter((g) => g.orders >= 20)
    .map((g) => ({
      name: g.key, orders: g.orders, revenue: g.revenueDisplay, profit: g.profitDisplay,
      margin: `${g.marginPct}%`, returnRate: `${g.returnPct}%`, lateRate: `${g.latePct}%`,
      rating: g.avgRating
    }));
  return rows.length ? { name, rows } : null;
}

function idTable(t, column, name, dim, dimKey, nameKey, limit, sortBy, ascending = false) {
  const lookup = new Map((dim || []).map((d) => [String(d[dimKey]), String(d[nameKey] || d[dimKey])]));
  let groups = groupBy(t, (r) => r[t.idx[column]]).filter((g) => g.orders >= 15);
  if (sortBy === 'returnPct') groups = groups.sort((a, b) => b.returnPct - a.returnPct);
  else groups = groups.sort((a, b) => ascending ? a.revenueMinor - b.revenueMinor : b.revenueMinor - a.revenueMinor);
  const rows = groups.slice(0, limit).map((g) => ({
    name: lookup.get(String(g.key)) || String(g.key),
    orders: g.orders, revenue: g.revenueDisplay, profit: g.profitDisplay,
    margin: `${g.marginPct}%`, returnRate: `${g.returnPct}%`
  }));
  return rows.length ? { name, rows } : null;
}

/**
 * Every figure in the bundle, flattened — this is what the model is allowed to
 * repeat back, and nothing else survives lib/numberguard.js.
 */
export function allowedFigures(ctx) {
  const out = {};
  let i = 0;
  const add = (v) => {
    if (typeof v === 'string' || typeof v === 'number') out[`f${i++}`] = String(v);
  };

  for (const v of Object.values(ctx.facts)) add(v);
  for (const f of ctx.findings) {
    add(f.what);
    add(f.cost);
    add(f.action);
    add(f.worth);
  }
  for (const tbl of ctx.tables) {
    for (const row of tbl.rows) for (const v of Object.values(row)) add(v);
  }
  return out;
}

function formatHalf(display) {
  const n = Number(String(display).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return display;
  return '₦' + (n / 2).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
