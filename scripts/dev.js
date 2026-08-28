/**
 * scripts/dev.js — local dev server.
 *
 * Mirrors the routing in netlify.toml exactly, including /api/analyse, so what
 * you demo locally is what deploys. Zero dependencies: node scripts/dev.js
 *
 * Reads .env from the repo root or the home directory if present, so the
 * provider keys work locally without exporting anything.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const PORT = Number(process.env.PORT) || 8787;

/* Load .env without a dependency. Repo root wins over home. */
for (const p of [join(ROOT, '.env'), join(process.env.HOME || '', '.env')]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/* Same rewrites as netlify.toml. */
const REWRITES = {
  '/': '/public/index.html',
  '/app/app.js': '/public/app.js',
  '/app/styles.css': '/public/styles.css'
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let path = decodeURIComponent(url.pathname);

  if (path === '/api/analyse') {
    return handleApi(req, res);
  }

  path = REWRITES[path] || path;

  // Block traversal, and do not serve the plumbing.
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  if (safe.startsWith('/netlify') || safe.startsWith('/scripts') || safe.includes('..')) {
    res.writeHead(404).end('not found');
    return;
  }

  try {
    const file = join(ROOT, safe);
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
});

async function handleApi(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  const { handler } = await import('../netlify/functions/analyse.js');
  const result = await handler({
    httpMethod: req.method,
    headers: { 'x-nf-client-connection-ip': '127.0.0.1' },
    body
  });

  res.writeHead(result.statusCode, result.headers || {});
  res.end(result.body || '');
}

server.listen(PORT, () => {
  const providers = [
    process.env.ANTHROPIC_API_KEY ? 'anthropic' : null,
    process.env.NVIDIA_API_KEY ? 'nvidia' : null
  ].filter(Boolean);

  console.log(`\n  NexaSphere Intelligence  →  http://localhost:${PORT}`);
  console.log(`  prose providers  →  ${providers.length ? providers.join(', ') : 'none (verdicts still work)'}\n`);
});
