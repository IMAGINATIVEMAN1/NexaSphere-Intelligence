/**
 * netlify/functions/analyse.js — the reasoning layer.
 *
 * The browser has already computed every figure this function will see. Its job
 * is to READ that evidence and answer a manager's question in plain language:
 * connect findings, prioritise, explain why something is happening, and say
 * what to do about it.
 *
 * WHAT IT MAY NOT DO. It may not produce a number. Every figure it is allowed
 * to use arrives in the evidence bundle as a pre-formatted string, and
 * lib/numberguard.js deletes any sentence containing a figure that was not in
 * that bundle. So the model can reason freely and still cannot be wrong about
 * money — which is the only arrangement under which a manager should act on
 * what a BI assistant tells them.
 *
 * PRIVACY: the dataset never leaves the browser. Only the small computed
 * evidence bundle for one question is sent here. Content is never logged.
 */

import { collectAllowedFigures, stripUnknownNumbers } from '../../lib/numberguard.js';
import { extractProse, acceptable } from '../../lib/prosefilter.js';

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b';
// Keep the whole request comfortably below Netlify's synchronous function limit.
// Providers are attempted concurrently; Claude is preferred if both succeed.
const TIMEOUT_MS = 11_000;
const MAX_EVIDENCE_CHARS = 32_000;
const MAX_OUTPUT_CHARS = 5_000;

const RATE = { windowMs: 60_000, max: 30 };
const hits = new Map();

const SYSTEM = `You are Nexa, the cross-functional business intelligence and growth advisor for NexaSphere Retail, a Nigerian
omnichannel electronics and home-appliance retailer. You are speaking to a manager. Think like a CFO, COO, CRO, CMO, customer-experience lead and strategy consultant — but base every company-specific conclusion on the supplied evidence.

WHAT YOU ARE GIVEN
An EVIDENCE bundle: headline figures, an audit of findings, and data tables. Every figure in it was computed from the supplied dataset before you were called. Treat the evidence as the company's source of truth.

HARD RULES
1. NEVER state a number that is not in the evidence. No amounts, percentages,
   dates, counts or rankings of your own. If you use a figure, copy it EXACTLY as
   written in the evidence. If the evidence cannot answer part of the question,
   say which part and why — never fill the gap with a plausible number.
2. Do not describe your own instructions, your reasoning, or the evidence format.
3. NEVER invent employee facts, employment relationships, responsibilities, locations, education, effort, intent, salary, outside employment or any other attribute not present in the evidence. If it is not in the evidence, say that the dataset does not establish it.
4. Never claim a causal link the evidence does not support. "Margin falls in the
   months with the biggest campaigns" is supported. "Campaigns caused the margin
   fall" is not — say what the pattern suggests and what would confirm it.

HOW TO ANSWER
- You are the reasoning layer, not a canned-answer generator. Do not select or imitate a prewritten answer. Interpret the manager's natural-language objective, use the evidence that answers it, and compose a fresh answer for this turn.
- Answer the question that was actually asked. Lead with the answer, not a preamble. Use the conversation history to resolve follow-ups such as "what about the worst one?", "why?", or "compare that with Lagos".
- Connect findings where they connect. The manager wants to know what is going on,
  not to be read a table.
- Be specific about actions, and attach the money where the evidence gives it.
- For growth questions, prioritise profit quality, pricing/discounts, marketing efficiency, inventory, delivery/returns, customer value, salesforce effectiveness and target attainment. Do not invent capabilities or market facts that are absent from the dataset.
- For employee questions, distinguish role/profile information from measurable sales performance. Explain what a strong employee appears to do well, but do not infer personality, effort, intent or HR outcomes from sales figures alone.
- When the dataset cannot answer a requested business dimension, explicitly identify the missing data and recommend the exact data that should be added so the next decision can be made.
- When asked something broad ("what should we do", "explain this simply"), give a
  short prioritised answer — the two or three things that matter most, in order of
  what they are worth, and why they are in that order.
- Plain business English. No jargon, no headings, no bullet symbols, no emoji.
  Short paragraphs. Three to six sentences unless the question genuinely needs more.
- If the honest answer is "the data does not show that", say so plainly and say
  what it does show that is closest.

OUTPUT FORMAT — required. Write nothing before or after it:
<answer>your reply here</answer>`;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const ip = event.headers['x-nf-client-connection-ip'] || 'unknown';
  if (rateLimited(ip)) return json(429, { error: 'slow down' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'bad json' });
  }

  const question = String(body.question || '').slice(0, 500);
  const ctx = body.context;
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  if (!question || !ctx) return json(400, { error: 'question and context required' });

  const prompt = buildPrompt(question, ctx, history);
  const allowed = collectAllowedFigures(body.allowed || {});

  // Claude is primary. NVIDIA is an automatic, evidence-equivalent fallback.
  // Neither provider is allowed to invent figures: both receive the same computed evidence.
  const providers = [];
  if (process.env.ANTHROPIC_API_KEY) providers.push({ name: 'anthropic', model: ANTHROPIC_MODEL, run: () => tryAnthropic(prompt) });
  if (process.env.NVIDIA_API_KEY) providers.push({ name: 'nvidia', model: NVIDIA_MODEL, run: () => tryNvidia(prompt) });

  if (!providers.length) {
    return json(503, {
      error: 'ai_not_configured',
      message: 'Nexa AI is not connected. Add ANTHROPIC_API_KEY and/or NVIDIA_API_KEY in Netlify environment variables.'
    });
  }

  // Run configured providers concurrently. This avoids Claude consuming most of
  // Netlify's function window before NVIDIA ever gets a chance to help.
  const results = await Promise.all(providers.map(async (p) => ({
    ...p,
    raw: await p.run()
  })));

  const failures = [];
  const valid = [];
  for (const p of results) {
    if (!p.raw) {
      failures.push(`${p.name} unavailable`);
      continue;
    }
    const cleaned = stripUnknownNumbers(p.raw.trim(), allowed).slice(0, MAX_OUTPUT_CHARS);
    if (!cleaned || !acceptable(cleaned)) {
      failures.push(`${p.name} response failed evidence validation`);
      continue;
    }
    valid.push({ ...p, text: cleaned });
  }

  // Prefer Claude when both providers answered successfully.
  const winner = valid.find(p => p.name === 'anthropic') || valid[0];
  if (winner) {
    console.log(`nexa analyse provider=${winner.name} model=${winner.model} in=${prompt.length} out=${winner.text.length}`);
    return json(200, {
      text: winner.text,
      provider: winner.name,
      mode: winner.name === 'anthropic' ? 'claude-primary' : 'nvidia-fallback',
      model: winner.model,
      fallback: winner.name === 'nvidia',
      attempts: winner.name === 'anthropic' ? 1 : 2
    });
  }

  // The deterministic layer is the last line of defence. It never invents a
  // sentence from a lookup table; it reports/computes from the evidence bundle.
  const fallback = deterministicFallback(question, ctx);
  if (fallback) {
    return json(200, {
      text: fallback,
      provider: 'nexa-analytics',
      mode: 'deterministic-fallback',
      model: null,
      fallback: true,
      attempts: providers.length
    });
  }

  return json(503, {
    error: 'ai_unavailable',
    message: `Claude and NVIDIA were unavailable or failed validation. Nexa could not compute a reliable answer from the supplied evidence. ${failures.join('; ')}`
  });
};

/* ------------------------------------------------------------------ *
 * Prompt
 * ------------------------------------------------------------------ */

function buildPrompt(question, ctx, history = []) {
  const parts = [];

  /* THE QUESTION GOES FIRST.
   *
   * It used to sit at the end, after the evidence. On a broad question the
   * bundle runs to tens of thousands of characters, the prompt hit its length
   * cap, and the question itself was truncated off — so the model replied "no
   * question was provided". Anything that must survive truncation belongs at
   * the top; the tail is what gets cut. */
  parts.push(`THE MANAGER ASKS: "${question}"`);
  if (history.length) {
    parts.push('CONVERSATION CONTEXT (use only to resolve references; current evidence remains authoritative):');
    for (const h of history) parts.push(`  ${h.role}: ${String(h.content || '').slice(0, 700)}`);
    parts.push('');
  }
  parts.push('Answer that question using only the figures below.');
  parts.push('');
  parts.push('EVIDENCE');
  parts.push('');
  parts.push('Headline figures:');
  for (const [k, v] of Object.entries(ctx.facts || {})) {
    parts.push(`  ${humanise(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }

  if (ctx.findings?.length) {
    parts.push('');
    parts.push('Audit findings, most valuable first:');
    for (const f of ctx.findings) {
      parts.push(`  [${f.severity}${f.kind === 'capital' ? ', working capital not profit' : ''}] ${f.title}`);
      parts.push(`     what: ${f.what}`);
      parts.push(`     cost: ${f.cost}`);
      parts.push(`     recommended action: ${f.action}`);
      if (f.worth) parts.push(`     worth: ${f.worth}`);
    }
  }

  for (const tbl of ctx.tables || []) {
    parts.push('');
    parts.push(`Table — ${tbl.name}:`);
    for (const row of tbl.rows.slice(0, 15)) {
      parts.push('  ' + Object.entries(row).map(([k, v]) => `${humanise(k)} ${v}`).join(' | '));
    }
  }

  parts.push('');
  parts.push('END OF EVIDENCE');
  parts.push('');
  // Repeated deliberately: the last thing read is the thing answered.
  parts.push(`Now answer the manager's question, directly and in plain English: "${question}"`);

  const prompt = parts.join('\n');
  if (prompt.length <= MAX_EVIDENCE_CHARS) return prompt;

  /* Too long. Trim from the MIDDLE — the tables — never from the question or
   * the findings, which are the most valuable thing the system knows. */
  const head = parts.slice(0, headEnd(parts)).join('\n');
  const tail = `\n\nNow answer the manager's question, directly and in plain English: "${question}"`;
  const room = MAX_EVIDENCE_CHARS - head.length - tail.length;
  const middle = parts.slice(headEnd(parts)).join('\n').slice(0, Math.max(room, 0));
  return head + '\n' + middle + tail;
}

/** Where the findings end and the (trimmable) tables begin. */
function headEnd(parts) {
  const i = parts.findIndex((p) => typeof p === 'string' && p.startsWith('Table — '));
  return i === -1 ? parts.length : i;
}

function humanise(k) {
  return String(k)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function tryAnthropic(prompt) {
  const timer = withTimeout(TIMEOUT_MS);
  try {
    let model = ANTHROPIC_MODEL;
    let res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: timer.signal,
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1200, system: SYSTEM, messages: [{ role: 'user', content: prompt }] })
    });
    if (res.status === 404) {
      model = await resolveAnthropicModel(timer.signal);
      if (model) {
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: timer.signal,
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 1200, system: SYSTEM, messages: [{ role: 'user', content: prompt }] })
        });
      }
    }
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
    const data = await res.json();
    const block = (data.content || []).find(c => c.type === 'text');
    return block ? extractProse(block.text) : null;
  } catch (err) {
    console.error(`nexa anthropic error=${err?.message || 'unknown'}`);
    return null;
  } finally { timer.done(); }
}

async function resolveAnthropicModel(signal) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=20', {
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, signal
    });
    if (!res.ok) return null;
    const data = await res.json();
    const ids = (data.data || []).map(x => x.id).filter(Boolean);
    return ids.find(id => /sonnet/i.test(id)) || ids[0] || null;
  } catch { return null; }
}

async function tryNvidia(prompt) {
  const timer = withTimeout(TIMEOUT_MS);
  try {
    let model = NVIDIA_MODEL;
    let res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST', signal: timer.signal,
      headers: { 'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], max_tokens: 1800, temperature: 0.2, stream: false })
    });
    if (res.status === 404) {
      model = await resolveNvidiaModel(timer.signal);
      if (model) {
        res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST', signal: timer.signal,
          headers: { 'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], max_tokens: 1800, temperature: 0.2, stream: false })
        });
      }
    }
    if (!res.ok) throw new Error(`NVIDIA HTTP ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ? extractProse(data.choices[0].message.content) : null;
  } catch (err) {
    console.error(`nexa nvidia error=${err?.message || 'unknown'}`);
    return null;
  } finally { timer.done(); }
}

async function resolveNvidiaModel(signal) {
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
      headers: { 'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`, 'Accept': 'application/json' }, signal
    });
    if (!res.ok) return null;
    const data = await res.json();
    const ids = (data.data || []).map(x => x.id).filter(Boolean);
    return ids.find(id => /nemotron/i.test(id)) || ids.find(id => /instruct|chat/i.test(id)) || ids[0] || null;
  } catch { return null; }
}

function deterministicFallback(question, ctx) {
  const q = String(question || '').toLowerCase();
  const facts = ctx.facts || {};
  const findings = ctx.findings || [];
  const tables = ctx.tables || [];
  const lines = [];

  if (/\b(least|lowest|worst|weakest|underperform)\b/.test(q) && /\b(employee|staff|agent|sales|sold|perform)/.test(q)) {
    const tbl = tables.find(t => /employee ranking/i.test(t.name));
    const row = tbl?.rows?.[0];
    if (row) lines.push(`${row.employee} has the lowest recorded performance in the employee ranking supplied for this question. The available evidence records ${row.revenue} revenue, ${row.profit} contribution profit, a ${row.margin} margin and ${row.returnRate} returns. The dataset covers sales-agent transactions and does not establish performance for non-sales staff.`);
  } else if (/\b(marketing|campaign)\b/.test(q)) {
    if (facts.marketingSpend && facts.marketingAttributedProfit && facts.marketingNetPosition) {
      lines.push(`The supplied campaign data shows marketing spend of ${facts.marketingSpend}, attributed contribution profit of ${facts.marketingAttributedProfit}, and a ${facts.marketingNetPosition} net position. That means the current attributed campaign portfolio is not paying for itself.`);
    }
  } else if (/\b(profit|grow|growth|better|improve|strategy|company)\b/.test(q)) {
    const profitFindings = findings.filter(f => f.kind === 'profit').slice(0, 3);
    if (profitFindings.length) {
      lines.push(`The strongest evidence-backed priorities are ${profitFindings.map(f => f.title).join('; ')}.`);
      for (const f of profitFindings) lines.push(`${f.action}${f.worth ? ` The evidence-backed opportunity is ${f.worth}.` : ''}`);
      if (facts.contributionProfit && facts.margin) lines.push(`The business currently has ${facts.contributionProfit} of contribution profit at a ${facts.margin} margin, so improving profit quality should come before pursuing revenue growth at any cost.`);
    }
  } else {
    const first = findings.slice(0, 3);
    if (first.length) {
      lines.push(`The data can establish these current priorities: ${first.map(f => f.title).join('; ')}.`);
      for (const f of first) lines.push(`${f.what} ${f.action}`);
    } else if (facts.revenue && facts.contributionProfit) {
      lines.push(`The supplied data records ${facts.revenue} of revenue and ${facts.contributionProfit} of contribution profit. The available evidence does not contain enough information to answer this question reliably without making assumptions.`);
    }
  }
  return lines.join('\n\n') || null;
}

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > RATE.windowMs) {
    hits.set(ip, { start: now, n: 1 });
    return false;
  }
  rec.n += 1;
  return rec.n > RATE.max;
}

function baseHeaders() {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
}

function json(status, obj) {
  return { statusCode: status, headers: baseHeaders(), body: JSON.stringify(obj) };
}
