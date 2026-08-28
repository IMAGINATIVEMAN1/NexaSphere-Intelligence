/**
 * public/app.js — NexaSphere Intelligence.
 *
 * THE DIVISION OF LABOUR, and the reason a manager can act on what this says:
 *
 *   1. Load transaction rows.
 *   2. Compute every figure here, in integer kobo            (lib/kpi.js)
 *   3. Discover findings by threshold test                   (lib/findings.js)
 *   4. Assemble the evidence a question needs                (lib/context.js)
 *   5. Send question + evidence to the model, which REASONS over it in plain
 *      language but cannot introduce a figure                (netlify function)
 *   6. Strip any number the model volunteered anyway         (lib/numberguard.js)
 *
 * The model does the thinking and the talking. It never does the arithmetic.
 * If it is unreachable, the UI says so. It never substitutes a canned answer for the model.
 *
 * CHARTS. Revenue and margin are different scales, so they are two charts
 * sharing an x-axis — never one chart with two y-axes, which is the commonest
 * way a chart lies.
 */

import { table, overview, monthly, discountBands, groupBy } from '../lib/kpi.js';
import { runAudit } from '../lib/findings.js';
import { buildContext, allowedFigures } from '../lib/context.js';
import { ask as deterministicAsk } from '../lib/ask.js';

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

let DATA = null;
let T = null;
let BUSY = false;
let HISTORY = [];
let VOICE = null;
let SPEAK = false;

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

(async function boot() {
  try {
    const res = await fetch('/data/nexasphere.json');
    if (!res.ok) throw new Error(`dataset returned ${res.status}`);
    DATA = await res.json();
    T = table(DATA.sales);

    const ov = overview(T);
    const findings = runAudit(DATA.sales, DATA);

    $('status').textContent = `${ov.orders.toLocaleString()} order lines · checking AI providers…`;
    $('status').classList.add('live');
    renderLede(ov, findings);
    renderKpis(ov, findings);
    renderFindings(findings);
    renderCharts();
    renderFoot(ov);
    renderCoverage();
    initVoice();
    await checkClaudeHealth(ov.orders);
  } catch {
    $('status').textContent = 'dataset failed to load';
    $('status').classList.remove('live');
    $('lede').textContent =
      'The dataset could not be loaded, so nothing here would be trustworthy. ' +
      'Run python3 scripts/build-data.py to regenerate data/nexasphere.json.';
  }
})();

function renderLede(ov, findings) {
  const total = findings
    .filter((f) => f.kind === 'profit')
    .reduce((s, f) => s + (f.opportunity?.gap || 0), 0);

  $('lede').textContent =
    `NexaSphere turned ${ov.revenueDisplay} of revenue into ${ov.profitDisplay} of contribution ` +
    `profit — a ${ov.marginPct}% margin. I have been through every order line and found ` +
    `${findings.length} things worth your attention, ${naira(total)} of them recoverable. ` +
    `Ask me about any of it.`;
}

/* ------------------------------------------------------------------ *
 * Briefing panel
 * ------------------------------------------------------------------ */

function renderKpis(ov, findings) {
  const total = findings
    .filter((f) => f.kind === 'profit')
    .reduce((s, f) => s + (f.opportunity?.gap || 0), 0);

  const items = [
    ['wide', 'Recoverable', naira(total), 'priced against margins NexaSphere already achieves'],
    ['', 'Revenue', shortNaira(ov.revenue), `${ov.orders.toLocaleString()} orders`],
    ['', 'Contribution profit', shortNaira(ov.profit), `${ov.marginPct}% margin`],
    ['', 'Discounts', shortNaira(ov.discount), `${ov.discountSharePct}% of revenue`],
    ['', 'Refunded', shortNaira(ov.refund), `${ov.returnPct}% returned`],
    ['', 'Late deliveries', `${ov.latePct}%`, `rating ${ov.avgRating}/5`],
    ['', 'Customers', ov.customers.toLocaleString(), `over ${ov.monthCount} months`]
  ];

  $('kpis').innerHTML = items
    .map(
      ([cls, k, v, s]) =>
        `<div class="kpi ${cls}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`
    )
    .join('');
}

/**
 * Findings, collapsed by default.
 *
 * Eight expanded cards is a wall nobody reads. Collapsed, the whole audit is
 * scannable in one screen — title and what it is worth — and opens on demand.
 */
function renderFindings(findings) {
  const host = $('findings');
  host.innerHTML = '';

  for (const f of findings) {
    const d = el('details', `find ${f.severity}`);

    const sum = document.createElement('summary');
    sum.appendChild(el('span', 'f-title', f.title));
    if (f.opportunity?.gapDisplay) {
      sum.appendChild(
        el('span', `f-worth${f.kind === 'capital' ? ' capital' : ''}`, shortNaira(f.opportunity.gap))
      );
    }
    d.appendChild(sum);

    const open = el('div', 'f-open');
    open.appendChild(line('What', f.what));
    open.appendChild(line('Cost', f.cost));
    open.appendChild(line('Do this', f.action, 'action'));

    /* Status never rides on colour alone — icon plus word. */
    const note = el('div', `sev-note ${f.severity}`);
    note.textContent = `${sevIcon(f.severity)} ${f.severity}${
      f.kind === 'capital'
        ? ' · working capital, not profit'
        : f.shareOfProfitPct
          ? ` · ${f.shareOfProfitPct}% of profit made`
          : ''
    }`;
    open.appendChild(note);

    d.appendChild(open);
    host.appendChild(d);
  }

  $('audit-sub').textContent =
    `${findings.length} findings, discovered by threshold tests over the transaction rows — not written ` +
    `in advance. Each is priced against a margin this business already achieves in its own data.`;
}

function line(label, text, cls) {
  const w = el('div', `f-line${cls ? ' ' + cls : ''}`);
  w.appendChild(el('span', 'lab', label));
  w.appendChild(el('span', 'txt', text));
  return w;
}

function sevIcon(s) {
  return s === 'critical' ? '●' : s === 'high' ? '▲' : '■';
}

/* ------------------------------------------------------------------ *
 * Asking
 * ------------------------------------------------------------------ */

async function checkClaudeHealth(orderCount) {
  try {
    const res = await fetch('/.netlify/functions/health', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      let label = data.primary === 'anthropic' ? 'Claude connected' : 'NVIDIA fallback active';
      if (data.fallbackReady) label += ' · NVIDIA standby';
      $('status').textContent = `${orderCount.toLocaleString()} order lines · ${label}`;
      $('status').classList.add('live');
      return true;
    }
    $('status').textContent = `${orderCount.toLocaleString()} order lines · AI providers unavailable`;
    $('status').classList.remove('live');
    return false;
  } catch {
    $('status').textContent = `${orderCount.toLocaleString()} order lines · AI providers unavailable`;
    $('status').classList.remove('live');
    return false;
  }
}

async function handleAsk(question) {
  if (!DATA || BUSY) return;
  BUSY = true;
  $('go').disabled = true;

  // The opening pitch steps aside once a conversation has started.
  $('opening').style.display = 'none';

  const turn = el('div', 'turn');
  turn.appendChild(el('div', 'asked', question));

  const replied = el('div', 'replied');
  replied.appendChild(el('div', 'av', 'N'));
  const body = el('div', 'body');
  replied.appendChild(body);
  turn.appendChild(replied);
  $('thread').appendChild(turn);

  const thinking = el('div', 'thinking');
  thinking.innerHTML = '<i></i><i></i><i></i><span>reading 16,733 order lines…</span>';
  body.appendChild(thinking);
  turn.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Evidence, computed here.
  const ctx = buildContext(question, DATA);
  const allowed = allowedFigures(ctx);

  // Reasoning, over that evidence.
  let prose = null;
  let provider = null;
  let aiError = null;
  try {
    const res = await fetch('/.netlify/functions/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context: ctx, allowed, history: HISTORY.slice(-8) })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.text) {
      prose = data.text;
      provider = data.provider;
    } else {
      aiError = data?.message || `Claude returned HTTP ${res.status}`;
    }
  } catch (e) {
    aiError = 'Nexa could not reach the AI service.';
  }

  thinking.remove();

  if (!prose) {
    // Final client-side safety net: compute a fresh evidence-based response from
    // the loaded dataset. This is analytics, not a canned answer.
    const local = deterministicAsk(question, DATA);
    if (local?.ok) {
      prose = [...(local.lines || [])].join('\n\n');
      provider = 'nexa-analytics';
      aiError = null;
    }
  }

  if (prose) {
    for (const para of prose.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
      body.appendChild(el('p', null, para));
    }
  } else {
    body.appendChild(el('p', 'ai-error',
      `The AI providers are temporarily unavailable, and Nexa could not compute a reliable answer from the supplied data. ${aiError || ''}`
    ));
  }

  const spoken = prose || '';

  // Voice is opt-in: answers are never spoken automatically.
  if (spoken) {
    const speakBtn = el('button', 'speak-answer', '🔊 Speak answer');
    speakBtn.type = 'button';
    speakBtn.addEventListener('click', () => speak(spoken));
    body.appendChild(speakBtn);
  }
  HISTORY.push({ role: 'user', content: question });
  if (spoken) { HISTORY.push({ role: 'assistant', content: spoken }); }

  // The receipts.
  for (const tbl of ctx.tables.slice(0, 3)) {
    if (!tbl.rows.length) continue;
    const d = el('details', 'ev');
    const sum = document.createElement('summary');
    sum.textContent = tbl.name;
    d.appendChild(sum);
    d.appendChild(
      dataTable(
        Object.keys(tbl.rows[0]).map(titleCase),
        ((/employee/i.test(tbl.name) && /\b(each|every|all)\b/i.test(question)) ? tbl.rows : tbl.rows.slice(0, 15)).map((r) => Object.values(r))
      )
    );
    body.appendChild(d);
  }

  const bits = [`${ctx.findings.length} findings · ${ctx.tables.length} tables · 16,733 order lines`];
  bits.push(provider === 'nexa-analytics' ? 'computed by Nexa analytics fallback' : provider ? `reasoned by ${provider} over computed evidence` : 'AI unavailable');
  body.appendChild(el('div', 'trace', bits.join(' · ')));

  BUSY = false;
  $('go').disabled = false;
  turn.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function dataTable(columns, rows) {
  const scroll = el('div', 'tbl-scroll');
  const tbl = el('table', 'tbl');

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const c of columns) {
    const th = document.createElement('th');
    th.textContent = c;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const cell of r) {
      const td = document.createElement('td');
      const s = String(cell ?? '—');
      td.textContent = s;
      if (s.startsWith('-') || s.startsWith('−')) td.className = 'neg';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  scroll.appendChild(tbl);
  return scroll;
}

/* ------------------------------------------------------------------ *
 * Charts
 * ------------------------------------------------------------------ */

function renderCharts() {
  const host = $('charts');
  host.innerHTML = '';

  const months = monthly(T).filter((m) => m.orders >= 20);

  host.appendChild(
    barChart({
      title: 'Revenue by month',
      caption: 'Realised revenue. Growing throughout.',
      labels: months.map((m) => m.key),
      values: months.map((m) => m.revenue),
      color: 'var(--series-1)',
      format: (v) => naira(v),
      sparse: true
    })
  );

  host.appendChild(
    lineChart({
      title: 'Contribution margin by month',
      caption: 'Same months, same order. Margin falls as revenue rises — the two biggest revenue months are the two thinnest margins.',
      labels: months.map((m) => m.key),
      values: months.map((m) => m.marginPct),
      color: 'var(--series-3)',
      format: (v) => `${v}%`
    })
  );

  const bands = discountBands(T);
  host.appendChild(
    divergingChart({
      title: 'Margin by discount band',
      caption: 'Where discounting stops buying volume and starts destroying profit.',
      labels: bands.map((b) => b.label),
      values: bands.map((b) => b.marginPct ?? 0),
      counts: bands.map((b) => b.orders)
    })
  );

  const couriers = groupBy(T, (r) => T.str(r, 'Courier'))
    .filter((c) => c.orders >= 100)
    .sort((a, b) => b.latePct - a.latePct);

  host.appendChild(
    barChart({
      title: 'Late deliveries by courier',
      caption: 'Share of each partner’s orders arriving after the promised date.',
      labels: couriers.map((c) => c.key),
      values: couriers.map((c) => c.latePct),
      color: 'var(--series-2)',
      format: (v) => `${v}%`,
      horizontal: true
    })
  );
}

function shell(title, caption) {
  const box = el('div', 'chart');
  box.appendChild(el('h4', null, title));
  box.appendChild(el('p', 'cap', caption));
  return box;
}

function svgEl(name, attrs = {}) {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function tip(text) {
  const t = document.createElementNS(SVG_NS, 'title');
  t.textContent = text;
  return t;
}

/** Single series. No legend — the title names it. */
function barChart({ title, caption, labels, values, color, format, horizontal, sparse }) {
  const box = shell(title, caption);
  const W = 380;
  const H = horizontal ? Math.max(120, labels.length * 26 + 16) : 150;
  const padL = horizontal ? 96 : 44;
  const padR = horizontal ? 46 : 6;
  const padT = 6;
  const padB = horizontal ? 8 : 24;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });
  const max = Math.max(...values, 0) * 1.08 || 1;

  if (horizontal) {
    const band = (H - padT - padB) / labels.length;
    labels.forEach((lab, i) => {
      const y = padT + i * band;
      const w = (values[i] / max) * (W - padL - padR) || 0;

      const t = svgEl('text', { x: padL - 7, y: y + band / 2 + 3.5, 'text-anchor': 'end', class: 'axis-label' });
      t.textContent = lab;
      svg.appendChild(t);

      const bar = svgEl('rect', {
        x: padL, y: y + 3, width: Math.max(w, 2), height: Math.max(band - 7, 3),
        rx: 4, fill: color
      });
      bar.appendChild(tip(`${lab}: ${format(values[i])}`));
      svg.appendChild(bar);

      const v = svgEl('text', { x: padL + w + 6, y: y + band / 2 + 3.5, class: 'axis-label' });
      v.textContent = format(values[i]);
      svg.appendChild(v);
    });
  } else {
    const band = (W - padL - padR) / labels.length;
    const plotH = H - padT - padB;

    for (let g = 0; g <= 2; g++) {
      const y = padT + (plotH / 2) * g;
      svg.appendChild(svgEl('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'grid-line' }));
      const t = svgEl('text', { x: padL - 6, y: y + 3.5, 'text-anchor': 'end', class: 'axis-label' });
      t.textContent = shortNaira(max - (max / 2) * g);
      svg.appendChild(t);
    }

    labels.forEach((lab, i) => {
      const h = (values[i] / max) * plotH || 0;
      const x = padL + i * band;
      const bar = svgEl('rect', {
        x: x + 1, y: padT + plotH - h,
        width: Math.max(band - 2, 1.5), height: Math.max(h, 1.5),
        rx: 2, fill: color
      });
      bar.appendChild(tip(`${lab}: ${format(values[i])}`));
      svg.appendChild(bar);

      if (!sparse || i === 0 || i === labels.length - 1 || i === Math.floor(labels.length / 2)) {
        const t = svgEl('text', {
          x: x + band / 2, y: H - padB + 13, 'text-anchor': 'middle', class: 'axis-label'
        });
        t.textContent = lab;
        svg.appendChild(t);
      }
    });
  }

  box.appendChild(svg);
  return box;
}

function lineChart({ title, caption, labels, values, color, format }) {
  const box = shell(title, caption);
  const W = 380, H = 150, padL = 34, padR = 8, padT = 8, padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });

  const max = Math.max(...values) * 1.12;
  const min = Math.min(0, Math.min(...values));
  const span = max - min || 1;
  const xF = (i) => padL + (i / Math.max(labels.length - 1, 1)) * plotW;
  const yF = (v) => padT + plotH - ((v - min) / span) * plotH;

  for (let g = 0; g <= 2; g++) {
    const y = padT + (plotH / 2) * g;
    svg.appendChild(svgEl('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'grid-line' }));
    const t = svgEl('text', { x: padL - 6, y: y + 3.5, 'text-anchor': 'end', class: 'axis-label' });
    t.textContent = `${Math.round(max - (span / 2) * g)}%`;
    svg.appendChild(t);
  }

  const d = values.map((v, i) => `${i ? 'L' : 'M'}${xF(i)},${yF(v)}`).join(' ');
  svg.appendChild(svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));

  values.forEach((v, i) => {
    const c = svgEl('circle', {
      cx: xF(i), cy: yF(v), r: 2.6,
      fill: color, stroke: 'var(--surface-1)', 'stroke-width': 1.5
    });
    c.appendChild(tip(`${labels[i]}: ${format(v)}`));
    svg.appendChild(c);
  });

  [0, labels.length - 1].forEach((i) => {
    const t = svgEl('text', { x: xF(i), y: H - padB + 13, 'text-anchor': i ? 'end' : 'start', class: 'axis-label' });
    t.textContent = labels[i];
    svg.appendChild(t);
  });

  // Direct-label the two thinnest months — the whole point of the chart.
  values
    .map((v, i) => [v, i])
    .sort((a, b) => a[0] - b[0])
    .slice(0, 2)
    .forEach(([v, i]) => {
      const t = svgEl('text', {
        x: xF(i), y: yF(v) + 14, 'text-anchor': 'middle',
        class: 'axis-label', fill: 'var(--text)'
      });
      t.textContent = format(v);
      svg.appendChild(t);
    });

  box.appendChild(svg);
  return box;
}

/** Diverging around zero: profit above, loss below. */
function divergingChart({ title, caption, labels, values, counts }) {
  const box = shell(title, caption);
  const W = 380, H = 168, padL = 8, padR = 8, padT = 14, padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });

  const max = Math.max(...values.map(Math.abs)) * 1.25 || 1;
  const zeroY = padT + plotH / 2;
  const band = plotW / labels.length;

  svg.appendChild(svgEl('line', { x1: padL, y1: zeroY, x2: W - padR, y2: zeroY, class: 'zero-line' }));

  labels.forEach((lab, i) => {
    const v = values[i];
    const h = (Math.abs(v) / max) * (plotH / 2);
    const x = padL + i * band;
    const up = v >= 0;

    const bar = svgEl('rect', {
      x: x + 5, y: up ? zeroY - h : zeroY,
      width: Math.max(band - 10, 2), height: Math.max(h, 2),
      rx: 3, fill: up ? 'var(--pos)' : 'var(--neg)'
    });
    bar.appendChild(tip(`${lab}: ${v}% across ${counts[i].toLocaleString()} orders`));
    svg.appendChild(bar);

    const val = svgEl('text', {
      x: x + band / 2, y: up ? zeroY - h - 5 : zeroY + h + 11,
      'text-anchor': 'middle', class: 'axis-label', fill: 'var(--text)'
    });
    val.textContent = `${v}%`;
    svg.appendChild(val);

    const t = svgEl('text', { x: x + band / 2, y: H - padB + 16, 'text-anchor': 'middle', class: 'axis-label' });
    t.textContent = lab;
    svg.appendChild(t);

    const c = svgEl('text', { x: x + band / 2, y: H - padB + 27, 'text-anchor': 'middle', class: 'axis-label' });
    c.textContent = counts[i].toLocaleString();
    svg.appendChild(c);
  });

  box.appendChild(svg);

  /* Two colours carry meaning, so identity is also stated in words. */
  const legend = el('div', 'legend');
  legend.innerHTML =
    `<span><i style="background:var(--pos)"></i>Profitable</span>` +
    `<span><i style="background:var(--neg)"></i>Loss-making</span>`;
  box.appendChild(legend);
  return box;
}

/* ------------------------------------------------------------------ *
 * Data coverage + voice
 * ------------------------------------------------------------------ */

function renderCoverage() {
  const host = $('coverage');
  if (!host || !DATA) return;
  const c = dataCoverageForUI();
  host.innerHTML = `
    <div class="coverage-grid">
      <div><strong>${c.transactionRows.toLocaleString()}</strong><span>fact rows</span></div>
      <div><strong>${c.customers.toLocaleString()}</strong><span>customers</span></div>
      <div><strong>${c.products}</strong><span>products</span></div>
      <div><strong>${c.stores}</strong><span>stores</span></div>
    </div>
    <div class="coverage-note"><b>Transparent limits</b><br>${c.limitations.map(esc).join('<br>')}</div>`;
}

function dataCoverageForUI() {
  const rows = DATA.sales.rows;
  const idx = Object.fromEntries(DATA.sales.columns.map((c,i) => [c,i]));
  return {
    transactionRows: rows.length,
    customers: new Set(rows.map(r => r[idx.Customer_ID])).size,
    products: DATA.products.length,
    stores: DATA.stores.length,
    limitations: [
      'Customer segments: New vs Repeat only.',
      'Inventory: monthly store/category, not SKU-level.',
      'Employees: sales-agent performance; no labour-cost or hours data.',
      'Campaign ROI uses supplied attribution.',
      'Patterns are evidence of association, not causation.'
    ]
  };
}

function initVoice() {
  const btn = $('voice');
  if (!btn) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.disabled = true;
    btn.title = 'Voice input is not supported in this browser';
    $('voice-status').textContent = 'voice input unavailable';
    return;
  }
  const recognition = new SR();
  recognition.lang = 'en-NG';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  let finalText = '';
  recognition.onstart = () => { VOICE = recognition; btn.classList.add('listening'); $('voice-status').textContent = 'Listening…'; };
  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const text = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += text + ' '; else interim += text;
    }
    $('q').value = (finalText + interim).trim();
  };
  recognition.onerror = () => { $('voice-status').textContent = 'Couldn’t hear that — try again'; };
  recognition.onend = () => {
    btn.classList.remove('listening');
    VOICE = null;
    $('voice-status').textContent = '';
    const q = finalText.trim();
    finalText = '';
    if (q) { $('q').value = ''; handleAsk(q); }
  };
  btn.addEventListener('click', () => {
    if (VOICE) { VOICE.stop(); return; }
    try { finalText = ''; recognition.start(); } catch { /* already active */ }
  });
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-NG';
  u.rate = 0.96;
  u.pitch = 1;
  window.speechSynthesis.speak(u);
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

function renderFoot(ov) {
  $('foot').textContent =
    `Every figure here was computed in integer kobo from ${ov.orders.toLocaleString()} order lines in ` +
    `NexaSphere_BI_Case_Study_Dataset.xlsx. The language model reads those figures and explains them; ` +
    `it cannot produce, alter or estimate one. Dataset synthetic, per its own case brief.`;
}

function submit() {
  const v = $('q').value.trim();
  if (!v) return;
  $('q').value = '';
  handleAsk(v);
}

$('go').addEventListener('click', submit);
$('q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
});
/* ?q=<question> asks on load. Used for the recorded demonstration so the same
 * run is reproducible, and for screenshotting during development. */
const preset = new URLSearchParams(location.search).get('q');
if (preset) setTimeout(() => handleAsk(preset), 600);

$('starters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && b.dataset.q) handleAsk(b.dataset.q);
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function naira(v) {
  return '₦' + Math.round(Number(v)).toLocaleString('en-NG');
}

function shortNaira(v) {
  const n = Number(v);
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}₦${(a / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${sign}₦${(a / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `${sign}₦${Math.round(a / 1e3)}k`;
  return `${sign}₦${Math.round(a)}`;
}

function titleCase(s) {
  return String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
