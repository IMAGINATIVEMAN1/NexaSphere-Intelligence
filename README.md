# NexaSphere Intelligence

### AI Business Intelligence & Growth Advisor

**Hack-AI-thon & BuildFest 2026 · AI for Business & Productivity · Case Study 4**

[Live Demo](https://buildfestwinner.netlify.app/) · [Hack-AI-thon Submission](https://hack-ai-thon.10alyticsbusiness.ca/submission)

---

## Overview

NexaSphere Intelligence is an AI-powered business intelligence and growth advisor designed to help management move from **business data → insight → decision → profitable action**.

Instead of acting as a scripted question-and-answer bot, NexaSphere combines:

- deterministic business analytics
- natural-language AI reasoning
- evidence-grounded answers
- interactive charts and dashboards
- employee performance intelligence
- inventory, marketing and delivery analysis
- scenario / "what-if" reasoning
- voice interaction
- AI provider failover
- transparent limitations and data provenance

The goal is simple:

> **Don't just tell management what happened. Help management understand what it means and what to do next.**

---

## The Business Problem

The Case Study 4 scenario describes a business where revenue can appear healthy while profitability, delivery performance, returns, customer satisfaction or operational efficiency deteriorate.

NexaSphere addresses this by connecting business signals instead of looking at isolated KPIs.

The supplied dataset contains:

| Metric | Coverage |
|---|---:|
| Order lines | **16,733** |
| Customers | **3,677** |
| Products | **212** |
| Stores | **24** |
| Time period | **24 months** |

The dataset is synthetic, as stated in the case materials.

---

## What NexaSphere Can Answer

Management can ask questions in natural language such as:

- **Which employees perform well based on both revenue and profitability?**
- **Where is the business failing to meet its targets?**
- **Which products, stores or regions generate the most revenue and profit?**
- **Is revenue growth leading to stronger profitability?**
- **Which products have unusually high return rates?**
- **Which campaigns generate the best return on investment?**
- **Which stores have stockouts or excess inventory?**
- **Which delivery partners are associated with delays or poor ratings?**
- **Which customer segments are most valuable?**
- **What should we do to make more profit?**
- **What if we reduce marketing spend by 50%?**

The assistant can combine an answer with the underlying evidence, relevant metrics and visualizations.

---

# The Intelligence Architecture

The core design principle is:

> **The engine computes. The model explains.**

The language model is not trusted to perform the underlying business arithmetic.

```text
                    USER
                      │
                      ▼
             Natural-language question
                      │
                      ▼
             Question understanding
                      │
                      ▼
        ┌─────────────────────────────┐
        │ Deterministic BI Engine     │
        │                             │
        │ KPIs • Findings • Targets   │
        │ Employees • Inventory       │
        │ Campaigns • Stores • Months │
        └──────────────┬──────────────┘
                       │
                       ▼
              Evidence / context
                       │
              ┌────────┴────────┐
              ▼                 ▼
       Anthropic Claude    NVIDIA AI
          Primary          Fallback
              │                 │
              └────────┬────────┘
                       ▼
                 AI explanation
                       │
                       ▼
                 Output validation
                       │
                       ▼
            Answer + Evidence + Graph
                       │
                       ▼
             Recommended business action
```

### Why this separation matters

Every business number is computed before the model is called.

The AI receives evidence that has already been calculated. A number that the model invents is not accepted as trusted business data.

This makes the assistant useful for decision support without pretending that an LLM is a database or accounting system.

---

# Reliability and Failover

NexaSphere is designed around the principle that **AI provider failure should not become business intelligence failure**.

### Primary AI

**Anthropic Claude**

Used for natural-language reasoning and explanation.

### Secondary AI

**NVIDIA AI**

Used as the fallback provider when the primary provider is unavailable.

### Deterministic floor

If AI providers are unavailable, NexaSphere can still produce a data-derived response from its deterministic analytics layer rather than displaying a fabricated or pre-written answer.

The system is deliberately designed **not to silently replace an unavailable AI answer with a fake programmed response**.

---

# Business Intelligence Capabilities

## Employee Performance

NexaSphere evaluates employees using multiple business dimensions rather than simply ranking sales.

For example, it can compare:

- revenue
- contribution profit
- contribution margin
- returns
- employee/team context

This allows management to identify employees who generate **high-value revenue**, not merely high transaction volume.

---

## Revenue & Profitability

The system tracks:

- realised revenue
- contribution profit
- contribution margin
- monthly trends
- store performance
- regional performance
- product performance
- channel performance

A central insight from the supplied data is that revenue growth is accompanied by declining profitability.

The two largest revenue months are also among the thinnest-margin months.

---

## Marketing Intelligence

NexaSphere evaluates campaign performance using the attribution contained in the supplied dataset.

One major finding:

**₦996.9m** of campaign spend was associated with approximately **₦368.6m** of contribution profit.

That creates a quantified opportunity of approximately:

**₦628.3m**

The system can identify campaigns that destroy value and prioritize where management should investigate or redirect spending.

---

## Inventory Intelligence

The system analyses inventory at the level supported by the supplied dataset.

It identifies:

- stockouts
- excess inventory
- store/category inventory patterns
- inventory value tied up in overstock

An important distinction is maintained:

> **₦13.88bn of overstock is working capital, not profit.**

It is therefore not incorrectly added to the recoverable-profit headline.

---

## Delivery & Returns

NexaSphere connects delivery performance with operational outcomes.

For example, the supplied data identifies **QuickDrop** as having a very high late-delivery rate and elevated returns.

The assistant can surface this relationship and help management prioritize operational investigation.

The system distinguishes evidence of association from proof of causation.

---

# Automated Business Audit

NexaSphere can discover material patterns using threshold-based detectors rather than relying on a list of hard-coded questions.

The supplied dataset produced eight major findings:

| Finding | Quantified opportunity |
|---|---:|
| Marketing spend is not paying for itself | **₦628.3m** |
| Corporate Sales earns less per naira than Retail | **₦537.7m** |
| Stores are below profit targets | **₦504.8m** |
| Deep discounts are selling below cost | **₦239.5m** |
| Revenue is growing while profitability falls | **₦221.2m** |
| QuickDrop delivery problems | **₦86.8m** |
| High-return products | **₦15.5m** |
| Overstock | **₦13.88bn working capital** |

The first seven are treated as profit/opportunity findings. Overstock is kept separate because inventory value is not equivalent to recoverable profit.

---

# Growth Advisor

NexaSphere is designed to go beyond reporting.

It helps management move through:

### Detect
Find where performance is deteriorating.

### Explain
Connect related evidence and identify plausible drivers.

### Prioritize
Quantify the opportunities that matter most.

### Recommend
Suggest practical actions grounded in the available evidence.

### Grow
Help management make better decisions around profitability, customers, people, inventory, marketing and operations.

Examples of strategic recommendations include:

- redirect inefficient marketing spend
- control margin-destroying discounts
- investigate store-level profit gaps
- rebalance overstock
- identify and replicate high-performing employee practices
- investigate delivery partners associated with delays and returns

---

# Scenario Intelligence

NexaSphere can also handle "what-if" questions.

For example:

> **What if we cut marketing spend by 50%?**

The system distinguishes between:

**What can be calculated directly from the dataset**

and

**What requires an assumption about future customer behaviour.**

It does not invent a revenue response simply to make a scenario look precise.

This distinction is important for responsible business AI.

---

# Voice Assistant

NexaSphere supports voice interaction so an executive can ask a business question naturally.

Example:

> **"Which employees are driving the most profitable revenue?"**

The system can process the question, retrieve the relevant business evidence and return the same analytical response as a typed question.

### Voice output is opt-in

NexaSphere does **not** automatically speak every answer.

The user chooses when to use the **Speak Answer** control.

---

# Data Integrity

The supplied workbook is transformed into a structured data representation used by the application.

The analytics layer performs deterministic calculations using integer kobo for monetary values.

The application can calculate and validate:

- revenue
- contribution profit
- margins
- discounts
- returns
- ratings
- late deliveries
- targets
- employee performance
- product/store/region comparisons
- campaign performance
- inventory patterns

The AI receives the resulting evidence rather than being asked to calculate the source-of-truth business numbers itself.

---

# Testing

The project includes a self-test suite covering the core business calculations.

```bash
node scripts/selftest.js
```

The current suite contains:

**102 checks**

The expected values were independently calculated from the source workbook using Python and compared against the application's analytics implementation.

The testing strategy intentionally includes checks that catch errors such as:

- reading revenue from the wrong column
- dropping transaction rows during grouping
- incorrectly summing monthly inventory snapshots
- calculating campaign ROI from revenue rather than profit

The purpose is to validate the **business logic**, not simply whether the application loads.

---

# Technology

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Runtime | Node.js 18+ |
| Analytics | Deterministic JavaScript business logic |
| Primary AI | Anthropic Claude |
| AI fallback | NVIDIA AI |
| Backend | Netlify Functions |
| Charts | Inline SVG |
| Data preparation | Python |
| Hosting | Netlify |

The project intentionally avoids a heavy frontend framework and keeps the business intelligence logic inspectable.

---

# Data & Responsible AI

NexaSphere follows several principles:

### Evidence before explanation
The model receives computed business evidence.

### No invented business numbers
AI-generated numbers are not treated as trusted source data.

### Transparent limitations
If the dataset cannot answer a question reliably, the system should say so rather than manufacture an answer.

### Association ≠ causation
Observed relationships are presented as evidence or signals, not automatically as causal proof.

### Separate profit from working capital
Inventory value is not incorrectly presented as profit.

### Secrets stay server-side
AI credentials belong in Netlify environment variables and should never be committed to the repository.

---

# Honest Limitations

The system intentionally states the boundaries of the supplied dataset.

- The dataset is synthetic.
- Campaign attribution comes from the supplied workbook.
- Customer segmentation is limited to the categories supported by the dataset.
- Inventory analysis is limited to the available store/category inventory data rather than unsupported SKU-level conclusions.
- Employee analysis uses sales-agent performance because labour cost and hours are not available.
- Overstock is working capital, not automatically recoverable profit.
- Correlation or association is not presented as proof of causation.
- Future scenario outcomes may require assumptions that the historical dataset cannot establish.

These limitations are part of the product design rather than hidden from the user.

---

# Running Locally

Node.js 18+ is required.

```bash
node scripts/dev.js
```

Then open:

```text
http://localhost:8899
```

Run the validation suite:

```bash
node scripts/selftest.js
```

---

# Project Structure

```text
NexaSphere-Intelligence/
├── data/
├── docs/
├── lib/
│   ├── ask.js
│   ├── campaigns.js
│   ├── context.js
│   ├── findings.js
│   ├── inventory.js
│   ├── kpi.js
│   ├── numberguard.js
│   ├── targets.js
│   └── ...
├── netlify/
│   └── functions/
├── public/
├── scripts/
├── dist/
├── netlify.toml
├── package.json
└── START-HERE.md
```

---

# Live Product

**NexaSphere Intelligence**

[Launch the live demo →](https://buildfestwinner.netlify.app/)

---

## Vision

NexaSphere is built around a simple idea:

> **The next generation of business intelligence should not stop at dashboards. It should help people decide what to do next.**

NexaSphere combines trusted analytics, AI reasoning, visualization, voice interaction and growth recommendations into one business assistant.

**Data → Intelligence → Insight → Recommendation → Decision → Profitable Growth**

---

### Hack-AI-thon & BuildFest 2026

**Track:** AI for Business & Productivity  
**Case Study:** 4 — AI Business Intelligence Assistant
