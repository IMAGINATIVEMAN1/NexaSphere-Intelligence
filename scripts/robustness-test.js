import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildContext, allowedFigures } from '../lib/context.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/nexasphere.json', import.meta.url)));

function testContext() {
  const cases = [
    ['Who made the least sales?', 'employee'],
    ['Which employees perform well based on both revenue and profitability?', 'employee'],
    ['Where is the business failing to meet its targets?', 'targets'],
    ['Which stores are experiencing stockouts or excess inventory?', 'inventory'],
    ['What if we cut marketing by 50%?', 'campaigns'],
    ['How can we grow the company?', null]
  ];
  for (const [q, topic] of cases) {
    const c = buildContext(q, data);
    if (topic) assert(c.topics.includes(topic), `${q}: missing topic ${topic}`);
    assert(c.findings.length >= 3, `${q}: no audit evidence`);
    assert(JSON.stringify(c).length < 100000, `${q}: context unexpectedly huge`);
    assert(Object.keys(allowedFigures(c)).length > 0, `${q}: no allowed figures`);
  }
  const all = buildContext('Show me each employee and what they do', data);
  assert.equal(all.tables.find(t => t.name.includes('role profiles')).rows.length, data.employees.length);
}

async function testFunctionFallbacks() {
  process.env.ANTHROPIC_API_KEY = 'test-anthropic';
  process.env.NVIDIA_API_KEY = 'test-nvidia';
  process.env.ANTHROPIC_MODEL = 'missing-model';
  process.env.NVIDIA_MODEL = 'missing-model';

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).includes('api.anthropic.com/v1/messages')) return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('integrate.api.nvidia.com/v1/chat/completions')) {
      if (calls.filter(x => x.includes('integrate.api.nvidia.com/v1/chat/completions')).length === 1) return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ choices: [{ message: { content: '<answer>NVAPI fallback works with the supplied evidence.</answer>' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).includes('api.anthropic.com/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-5' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).includes('integrate.api.nvidia.com/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'nvidia/nemotron-3-super-120b-a12b' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500 });
  };

  const { handler } = await import('../netlify/functions/analyse.js?robustness=1');
  const c = buildContext('Which employees perform well based on both revenue and profitability?', data);
  const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ question: c.question, context: c, allowed: allowedFigures(c), history: [] }) });
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.provider, 'nvidia');
  assert.equal(body.mode, 'nvidia-fallback');
  assert(body.text.includes('NVAPI fallback'));
  assert(calls.some(x => x.includes('api.anthropic.com/v1/messages')));
  assert(calls.some(x => x.includes('integrate.api.nvidia.com/v1/chat/completions')));
  globalThis.fetch = originalFetch;
}


async function testDeterministicFallback() {
  process.env.ANTHROPIC_API_KEY = 'test-anthropic';
  process.env.NVIDIA_API_KEY = 'test-nvidia';
  process.env.ANTHROPIC_MODEL = 'missing-model';
  process.env.NVIDIA_MODEL = 'missing-model';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  const { handler } = await import('../netlify/functions/analyse.js?deterministic=2');
  const c = buildContext('Who made the least sales?', data);
  const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ question: c.question, context: c, allowed: allowedFigures(c), history: [] }) });
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.provider, 'nexa-analytics');
  assert.equal(body.mode, 'deterministic-fallback');
  assert(body.text.length > 50);
  globalThis.fetch = originalFetch;
}

await testFunctionFallbacks();
await testDeterministicFallback();
testContext();
console.log('NexaSphere robustness test — PASS');
