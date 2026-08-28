const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b';
const HEALTH_TIMEOUT_MS = 6000;

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'method not allowed' });

  const [anthropic, nvidia] = await Promise.all([checkAnthropic(), checkNvidia()]);
  const primary = anthropic.ok ? anthropic : (nvidia.ok ? nvidia : null);
  if (!primary) {
    return json(503, { ok: false, anthropic, nvidia, message: 'Neither Claude nor NVIDIA is currently available.' });
  }

  return json(200, {
    ok: true,
    primary: anthropic.ok ? 'anthropic' : 'nvidia',
    fallbackReady: anthropic.ok && nvidia.ok,
    anthropic,
    nvidia
  });
};

async function checkAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, configured: false, provider: 'anthropic', model: ANTHROPIC_MODEL };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(ANTHROPIC_MODEL)}`, {
      method: 'GET', signal: controller.signal,
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
    });
    const detail = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, configured: true, provider: 'anthropic', model: detail?.id || ANTHROPIC_MODEL };
    if (res.status === 404) {
      const model = await findAnthropicModel(controller.signal);
      if (model) return { ok: true, configured: true, provider: 'anthropic', model, requestedModel: ANTHROPIC_MODEL, resolved: true };
    }
    return { ok: false, configured: true, provider: 'anthropic', model: ANTHROPIC_MODEL, status: res.status, message: detail?.error?.message || `HTTP ${res.status}` };
  } catch {
    return { ok: false, configured: true, provider: 'anthropic', model: ANTHROPIC_MODEL, message: 'unreachable' };
  } finally { clearTimeout(timer); }
}

async function checkNvidia() {
  if (!process.env.NVIDIA_API_KEY) return { ok: false, configured: false, provider: 'nvidia', model: NVIDIA_MODEL };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
      method: 'GET', signal: controller.signal,
      headers: { 'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`, 'Accept': 'application/json' }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, configured: true, provider: 'nvidia', model: NVIDIA_MODEL, status: res.status, message: data?.message || data?.error?.message || `HTTP ${res.status}` };
    const ids = Array.isArray(data?.data) ? data.data.map(x => x?.id).filter(Boolean) : [];
    const available = ids.includes(NVIDIA_MODEL);
    const resolved = available ? NVIDIA_MODEL : (ids.find(id => /nemotron/i.test(id)) || ids.find(id => /instruct|chat/i.test(id)) || ids[0]);
    return { ok: Boolean(resolved), configured: true, provider: 'nvidia', model: resolved || NVIDIA_MODEL, requestedModel: NVIDIA_MODEL, status: 200, availableModel: available, resolved: !available && Boolean(resolved), availableModels: ids.slice(0, 8), message: resolved ? undefined : 'no usable model is listed for this key' };
  } catch {
    return { ok: false, configured: true, provider: 'nvidia', model: NVIDIA_MODEL, message: 'unreachable' };
  } finally { clearTimeout(timer); }
}

function json(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(obj) };
}

async function findAnthropicModel(signal) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=20', { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, signal });
    if (!res.ok) return null;
    const data = await res.json();
    const ids = (data.data || []).map(x => x.id).filter(Boolean);
    return ids.find(id => /sonnet/i.test(id)) || ids[0] || null;
  } catch { return null; }
}
