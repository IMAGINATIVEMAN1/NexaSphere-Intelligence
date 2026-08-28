# NexaSphere Intelligence

**AI BuildFest 2026 · Track 1: AI for Business & Productivity · Case Study 4 — AI Business Intelligence Assistant**

Akinbi Oluwafemi · Participant ID **BF-0968**

---

## 1. The problem, in one line from their own brief

> *"Revenue may appear to be increasing while profit margins, delivery performance,
> returns or customer satisfaction are declining."*

That is exactly what is happening at NexaSphere, and this assistant finds it,
prices it, and explains it.

Revenue grew from ₦5.44bn to ₦6.36bn across the two halves of the period.
Contribution margin fell from 16.26% to 12.78% over the same stretch. The
business is getting bigger and less profitable at the same time, and nobody in
the regular reports is saying so.

---

## 2. The architecture, and why it is the whole submission

> **The engine computes. The model explains. It cannot do both.**

A business intelligence assistant that invents a revenue figure is worse than no
assistant at all — it is confidently wrong in the one place a manager cannot
check, and they will act on it. So the two jobs are separated by force:

| Step | What happens | Model involved? |
|---|---|---|
| 1 | Load 16,733 transaction rows | No |
| 2 | Compute every figure in **integer kobo** (`lib/kpi.js`) | No |
| 3 | Discover findings by threshold test (`lib/findings.js`) | No |
| 4 | Assemble the evidence a question needs (`lib/context.js`) | No |
| 5 | **Reason** over that evidence and answer in plain language | **Yes** |
| 6 | Delete any figure the model volunteered anyway (`lib/numberguard.js`) | No |
| 7 | Reject the reply if it leaks reasoning or is truncated (`lib/prosefilter.js`) | No |

The model does the thinking and the talking. It never does the arithmetic. Every
number it is permitted to say arrives pre-computed as a string, and anything else
is stripped before the manager sees it.

**If the model is unreachable the assistant still answers** — from a
deterministic composition. Blunter, never absent, never wrong.

---

## 3. Against the case study's requirements

| Requirement | Where |
|---|---|
| Analyse the dataset and calculate relevant KPIs | `lib/kpi.js` — revenue, contribution profit, margin, discount share, return and late rates, ratings |
| Answer management questions in plain language | The assistant pane. Evidence computed locally, reasoned over by the model |
| Identify trends, unusual results, risks and performance gaps | `lib/findings.js` — 8 findings, discovered by threshold, not scripted |
| Compare across products, stores, regions, employees, campaigns, customer segments | All six, plus channels, couriers, discount bands and months |
| Present insights using charts, dashboards or summaries | Four charts, a KPI panel, and a collapsible audit |
| Explain possible reasons behind important changes | The model connects findings — e.g. the November margin collapse against Black Friday spend |
| Recommend practical actions | Every finding carries an action and what it is worth |

### The nine suggested business questions — all nine answered

1. **Which products, stores or regions generate the most revenue and profit?** — ranked, with the note that the biggest by revenue is usually not the most profitable.
2. **Is revenue growth leading to stronger profitability?** — no. 16.26% → 12.78%.
3. **Which products have unusually high return rates?** — four at more than double the company rate.
4. **Which campaigns generate the best return on investment?** — one of fourteen.
5. **Which stores have stockouts or excess inventory?** — 577 stockout days while 99.7% of stock value sits as overstock.
6. **Which delivery partners are associated with delays or poor ratings?** — QuickDrop: 89.97% late, 15.05% returned, rated 2.93.
7. **Which customer segments are most valuable?** — by revenue, profit and margin.
8. **Which employees perform well on revenue and profitability?** — both, side by side, because they disagree.
9. **Where is the business failing to meet its targets?** — everywhere. 77.1% of the profit target; 24 of 24 stores short.

---

## 4. What the audit found — ₦2,233,879,085 recoverable

Findings are **discovered**, not written in advance. Each detector is a threshold
test that returns nothing when the pattern is absent; point the tool at a healthy
business and the audit comes back short.

| Finding | Worth |
|---|---|
| Marketing spend is not paying for itself | ₦628,299,343 |
| Corporate Sales earns far less per naira than Retail | ₦537,745,729 |
| Every store is short of its profit target | ₦504,790,100 |
| Deep discounts are selling below cost | ₦239,487,882 |
| Revenue is growing and profitability is falling | ₦221,221,690 |
| QuickDrop is failing on delivery | ₦86,849,141 |
| Four products return at double the company rate | ₦15,485,200 |
| Almost all stock is sitting as overstock | ₦13.88bn **working capital** |

### The finding that explains the others

₦996,909,343 of campaign spend was credited with ₦368,610,000 of contribution
profit — **a net loss of ₦628,299,343**. Thirteen of fourteen campaigns cost more
than they returned. Black Friday posted *negative* attributed profit in both
years, and Black Friday lands in November — the month where margin collapses to
7.10% and 7.82%, the two thinnest margins in twenty-four months.

Revenue is growing because it is being bought. That is the story, and the
campaign table is the receipt.

### Two kinds of money, never added together

The ₦13.88bn of overstock is **working capital**, not profit. It is money the
business already owns, sitting in the wrong form. Summing it with the profit
opportunities would produce a "recoverable" headline larger than annual revenue —
so findings are typed, ranked and totalled separately, and the interface says why.

---

## 5. How every figure is priced

An opportunity is always measured against a margin **this business already
achieves somewhere in its own data** — never an invented target.

The deep-discount finding is priced at 20.91%, because that is what NexaSphere
earns on its own 9,428 lightly-discounted orders. When a manager says "that is
not realistic", the answer is: your own orders did it.

Where the evidence does not support a target, the tool says so. The Corporate
Sales finding carries its own caveat — B2B margins are naturally thinner than
retail, so closing that gap entirely is *not* a realistic goal, and the interface
states that before the recommendation.

---

## 6. Evidence of testing

```bash
node scripts/selftest.js     # 102 checks, all passing
```

**The expected values were not produced by this engine.** They were computed
independently in **Python with openpyxl, straight from the original .xlsx** — a
different language, a different library, a different code path — and pasted in as
literals. Two implementations agree **to the kobo** on ₦11,797,494,000.

A BI tool grading its own arithmetic proves nothing: if the aggregation is wrong,
a test written against it is wrong in exactly the same way.

**Mutation-tested.** The suite was deliberately broken to prove it bites:

| Injected fault | Result |
|---|---|
| Revenue read from the wrong column | 15 failures |
| Grouping silently drops one row | 4 failures, including *"regions sum to total revenue"* |
| Monthly stock snapshot summed across months | 3 failures |
| Profit ROI computed from revenue | 5 failures |

The suite also pins the **wrong** answer for the inventory snapshot
(₦220bn, 15.8× too large) so the guard against it cannot be quietly removed.

---

## 7. Tools and data

| Layer | Choice |
|---|---|
| Runtime | Node 18, ES modules, **zero dependencies** |
| Front end | Vanilla HTML/CSS/JS, no framework, no build step |
| Charts | Hand-written inline SVG |
| Model (primary) | `claude-haiku-4-5` via the Anthropic API |
| Model (fallback) | `nvidia/nemotron-3-super-120b-a12b`, free tier |
| Model (floor) | none — deterministic composition still answers |
| Data prep | one Python script, run once, `scripts/build-data.py` |

All fourteen sheets of the supplied workbook are used. The build script
aggregates nothing — every fact-table row survives into the app, so any figure
can be traced to the orders behind it.

---

## 8. Honest limitations

1. **Attribution is the dataset's, not ours.** Campaign profit comes from the
   workbook's own attribution columns. If that attribution is wrong, the
   campaign finding inherits the error. Nothing here re-attributes revenue.
2. **Correlation is stated as correlation.** The November margin collapse
   coincides with the biggest campaigns. The tool says the pattern points at
   discounting and names what would confirm it — it does not claim causation.
3. **Overstock is not a loss.** The goods can still be sold. What it costs is the
   use of the money while it sits, and this dataset states no cost of capital, so
   none is invented.
4. **Store targets assume a store was trading.** Coverage is reported next to
   attainment so a store that had not opened is not mistaken for one that failed.
5. **The dataset is synthetic**, as its own case brief states.
6. **The free fallback model takes 10–15 seconds** and occasionally returns
   nothing. When that happens the assistant falls back to deterministic prose.

---

## 9. Running it

```bash
cd nexa
node scripts/dev.js          # → http://localhost:8899
node scripts/selftest.js     # 102 checks
```

No install. No dependencies. Node 18 or newer.

To rebuild the data from the original workbook:

```bash
python3 scripts/build-data.py
```
