/** Derived analytics that stay deterministic and auditable. */
import { table, groupBy } from './kpi.js';

export function returnReasons(data) {
  const t = table(data.sales);
  const groups = groupBy(t, (r) => t.str(r, 'Return_Reason') || 'No reason recorded')
    .filter(g => g.returns > 0)
    .sort((a,b) => b.returns - a.returns);
  const total = groups.reduce((s,g) => s + g.returns, 0);
  return groups.map(g => ({
    reason: g.key,
    returnedOrders: g.returns,
    shareOfReturns: total ? round2(g.returns / total * 100) + '%' : '0%',
    refunded: g.refundDisplay
  }));
}

export function categoryPerformance(data) {
  const t = table(data.sales);
  const products = new Map((data.products || []).map(p => [String(p.Product_ID), p]));
  const groups = groupBy(t, r => products.get(String(r[t.idx.Product_ID]))?.Category || 'Unknown')
    .filter(g => g.orders >= 20);
  return groups.map(g => ({
    category: g.key, orders: g.orders, revenue: g.revenueDisplay, profit: g.profitDisplay,
    margin: pct(g.marginPct), returnRate: pct(g.returnPct)
  }));
}

export function customerValue(data) {
  const t = table(data.sales);
  const groups = groupBy(t, r => t.str(r, 'Customer_Type')).filter(g => g.orders >= 20);
  return groups.map(g => ({
    segment: g.key, orders: g.orders, revenue: g.revenueDisplay, profit: g.profitDisplay,
    margin: pct(g.marginPct), returnRate: pct(g.returnPct), avgOrderValue: g.orders ? naira(g.revenueMinor / g.orders) : '—'
  }));
}

export function employeePerformance(data) {
  const t = table(data.sales);
  const names = new Map((data.employees || []).map(e => [String(e.Employee_ID), e.Employee_Name]));
  const groups = groupBy(t, r => r[t.idx.Sales_Agent_ID]).filter(g => g.orders >= 10);
  return groups.map(g => ({
    employee: names.get(String(g.key)) || String(g.key), orders: g.orders,
    revenue: g.revenueDisplay, profit: g.profitDisplay, margin: pct(g.marginPct),
    returnRate: pct(g.returnPct)
  }));
}

export function dataCoverage(data) {
  const t = table(data.sales);
  const employeeCount = new Set(t.rows.map(r => String(r[t.idx.Sales_Agent_ID]))).size;
  return {
    transactionRows: t.count,
    uniqueOrders: new Set(t.rows.map(r => String(r[t.idx.Order_ID]))).size,
    customers: new Set(t.rows.map(r => String(r[t.idx.Customer_ID]))).size,
    products: (data.products || []).length,
    stores: (data.stores || []).length,
    employeesInSales: employeeCount,
    employeesInDimension: (data.employees || []).length,
    campaigns: (data.campaigns || []).length,
    inventoryRows: (data.inventory || []).length,
    marketingRows: (data.marketing || []).length,
    targetRows: (data.targets || []).length,
    limitations: [
      'Customer segmentation is limited to New vs Repeat in the supplied sales fact table.',
      'Inventory is monthly by store and category, not SKU-level.',
      'Employee analysis is sales-agent performance; employee cost, hours and productivity inputs are not supplied.',
      'Campaign ROI uses the workbook\'s attributed revenue/profit rather than independent attribution.',
      'The dataset supports correlation and comparison, not causal proof.'
    ]
  };
}

function pct(v) { return v == null ? '—' : `${v}%`; }
function naira(n) { return `₦${Math.round(Number(n)).toLocaleString('en-NG')}`; }
function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Employee command centre.
 *
 * The source has employee master data (role, department, team, store and
 * monthly target) plus sales-agent IDs on transactions. This lets us answer
 * "who performs well and why" without pretending we have payroll, hours or
 * warehouse productivity data.
 */
export function employeeProfiles(data) {
  const t = table(data.sales);
  const employees = data.employees || [];
  const stores = new Map((data.stores || []).map(s => [String(s.Store_ID), s.Store_Name]));
  const products = new Map((data.products || []).map(p => [String(p.Product_ID), p]));
  const salesByEmployee = new Map();
  const categoryByEmployee = new Map();
  const channelByEmployee = new Map();

  const addGroup = (map, id, key, g) => {
    if (!map.has(id)) map.set(id, new Map());
    const m = map.get(id);
    if (!m.has(key)) m.set(key, { revenueMinor: 0, profitMinor: 0, orders: 0 });
    const x = m.get(key);
    x.revenueMinor += g.revenueMinor;
    x.profitMinor += g.profitMinor;
    x.orders += 1;
  };

  for (const row of t.rows) {
    const id = String(row[t.idx.Sales_Agent_ID]);
    if (!salesByEmployee.has(id)) salesByEmployee.set(id, { orders: 0, revenueMinor: 0, profitMinor: 0, returns: 0, late: 0, ratingSum: 0, ratingCount: 0 });
    const x = salesByEmployee.get(id);
    x.orders += 1;
    x.revenueMinor += t.minor(row, 'Realized_Revenue_NGN');
    x.profitMinor += t.minor(row, 'Contribution_Profit_NGN');
    x.returns += t.num(row, 'Return_Flag');
    x.late += t.num(row, 'Late_Delivery_Flag');
    const rating = t.num(row, 'Customer_Rating');
    if (rating > 0) { x.ratingSum += rating; x.ratingCount += 1; }

    const product = products.get(String(row[t.idx.Product_ID]));
    const category = product?.Category || 'Unknown';
    addGroup(categoryByEmployee, id, category, { revenueMinor: t.minor(row, 'Realized_Revenue_NGN'), profitMinor: t.minor(row, 'Contribution_Profit_NGN') });
    addGroup(channelByEmployee, id, t.str(row, 'Sales_Channel'), { revenueMinor: t.minor(row, 'Realized_Revenue_NGN'), profitMinor: t.minor(row, 'Contribution_Profit_NGN') });
  }

  const salesProfiles = employees.map(e => {
    const id = String(e.Employee_ID);
    const x = salesByEmployee.get(id);
    const isSalesRole = /sales|account/i.test(String(e.Role || ''));
    if (!x) return {
      employee: e.Employee_Name,
      employeeId: id,
      role: e.Role,
      department: e.Department,
      team: e.Team,
      store: stores.get(String(e.Store_ID)) || e.Store_ID || '—',
      status: e.Employment_Status,
      monthlyTarget: e.Monthly_Target_NGN ? naira(e.Monthly_Target_NGN) : '—',
      salesActivity: isSalesRole ? 'No sales transactions in supplied fact table' : 'Not a sales-agent role',
      orders: 0, revenue: '—', profit: '—', margin: '—', returnRate: '—', targetAttainment: '—',
      primaryCategory: '—', primaryChannel: '—', balancedScore: null
    };

    const cats = [...(categoryByEmployee.get(id)?.entries() || [])].sort((a,b) => b[1].revenueMinor - a[1].revenueMinor);
    const channels = [...(channelByEmployee.get(id)?.entries() || [])].sort((a,b) => b[1].revenueMinor - a[1].revenueMinor);
    const activeMonths = new Set(t.rows.filter(r => String(r[t.idx.Sales_Agent_ID]) === id).map(r => t.str(r, 'Order_Month'))).size;
    const targetMinor = Number(e.Monthly_Target_NGN || 0) * 100 * activeMonths;
    const targetAttainment = targetMinor > 0 ? round2(x.revenueMinor / targetMinor * 100) : null;
    const margin = x.revenueMinor ? round2(x.profitMinor / x.revenueMinor * 100) : null;
    return {
      employee: e.Employee_Name,
      employeeId: id,
      role: e.Role,
      department: e.Department,
      team: e.Team,
      store: stores.get(String(e.Store_ID)) || e.Store_ID || '—',
      status: e.Employment_Status,
      monthlyTarget: e.Monthly_Target_NGN ? naira(e.Monthly_Target_NGN) : '—',
      salesActivity: 'Sales activity recorded',
      orders: x.orders,
      revenue: naira(x.revenueMinor / 100),
      profit: naira(x.profitMinor / 100),
      margin: margin == null ? '—' : `${margin}%`,
      returnRate: x.orders ? `${round2(x.returns / x.orders * 100)}%` : '—',
      targetAttainment: targetAttainment == null ? '—' : `${targetAttainment}%`,
      primaryCategory: cats[0]?.[0] || '—',
      primaryChannel: channels[0]?.[0] || '—',
      balancedScore: null,
      _revenue: x.revenueMinor,
      _profit: x.profitMinor,
      _margin: margin,
      _targetAttainment: targetAttainment,
      _orders: x.orders
    };
  });

  // Balanced score is a transparent 50/50 percentile index across revenue and
  // contribution profit. It is a ranking aid, not an HR decision score.
  const measurable = salesProfiles.filter(x => x.orders > 0);
  const rank = (field) => {
    const sorted = [...measurable].sort((a,b) => b[field] - a[field]);
    const out = new Map(sorted.map((x,i) => [x.employeeId, sorted.length === 1 ? 100 : 100 - (i / (sorted.length - 1)) * 100]));
    return out;
  };
  const rr = rank('_revenue');
  const rp = rank('_profit');
  for (const x of measurable) x.balancedScore = round2((rr.get(x.employeeId) + rp.get(x.employeeId)) / 2);

  // Human-readable recommendation based only on supplied measures.
  for (const x of measurable) {
    const highRevenue = rr.get(x.employeeId) >= 75;
    const highProfit = rp.get(x.employeeId) >= 75;
    if (highRevenue && highProfit) x.recommendation = 'Protect and replicate this playbook; consider mentoring peers.';
    else if (highRevenue && !highProfit) x.recommendation = 'Protect volume but review discounting, mix and return drivers to improve profit quality.';
    else if (!highRevenue && highProfit) x.recommendation = 'Study what makes this employee profitable and selectively scale their higher-margin approach.';
    else x.recommendation = 'Review pipeline, product mix, conversion opportunities and target attainment with the manager.';
  }

  // Hide internal calculation fields from callers.
  return salesProfiles.map(({_revenue,_profit,_margin,_targetAttainment,_orders,...x}) => x)
    .sort((a,b) => (b.balancedScore ?? -1) - (a.balancedScore ?? -1));
}

/**
 * A compact growth playbook for broad questions. It deliberately ranks only
 * evidence-backed levers discovered in the dataset; it never invents a market
 * size, forecast or promised ROI.
 */
export function growthPlaybook(data) {
  const audit = runAuditSafe(data);
  const profiles = employeeProfiles(data).filter(x => x.balancedScore != null);
  const bestEmployees = profiles.slice(0, 5).map(x => `${x.employee} (${x.role}) — ${x.profit}, ${x.margin}, balanced performance ${x.balancedScore}/100`).join('; ');
  return {
    principle: 'Grow profit, not revenue alone: protect high-quality revenue, remove proven profit leaks, and scale practices already working inside the business.',
    priorities: audit.slice(0, 5).map(f => ({ title: f.title, action: f.action, worth: f.opportunity?.gapDisplay || null })),
    employeePlaybook: bestEmployees,
    guardrails: [
      'Use the supplied data to compare and prioritise; do not claim causation where the dataset only shows association.',
      'Do not use sales metrics to judge warehouse or support employees when their productivity measures are absent.',
      'Treat the balanced employee index as a management aid, not an automatic hiring, firing or compensation decision.'
    ]
  };
}

function runAuditSafe(data) {
  // Lazy import is not possible in this synchronous module; the audit is kept
  // in context/findings. Return the small set of universal profit levers here
  // from deterministic primitives instead.
  const t = table(data.sales);
  const ov = overviewSimple(t);
  const bands = groupBy(t, r => {
    const d = t.num(r, 'Discount_Pct');
    return d > 0.2 ? 'Over 20%' : d > 0.1 ? '10–20%' : d > 0.05 ? '5–10%' : d > 0 ? 'Up to 5%' : 'No discount';
  });
  const losing = bands.filter(x => x.profitMinor < 0).sort((a,b) => a.profitMinor - b.profitMinor)[0];
  const out = [];
  if (losing) out.push({ title: 'Deep discounts are destroying profit', action: `Review orders in the ${losing.key} discount band and set a margin floor.`, opportunity: { gap: 0, gapDisplay: '—' } });
  if (ov.marginPct != null) out.push({ title: 'Protect contribution margin while growing', action: 'Make contribution profit and margin first-class growth KPIs alongside revenue.', opportunity: { gap: 0, gapDisplay: '—' } });
  return out;
}
function overviewSimple(t) {
  let r=0,p=0; for (const row of t.rows){r+=t.minor(row,'Realized_Revenue_NGN');p+=t.minor(row,'Contribution_Profit_NGN');}
  return { marginPct:r?round2(p/r*100):null };
}
