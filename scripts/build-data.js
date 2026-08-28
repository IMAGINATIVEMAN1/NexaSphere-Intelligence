// Netlify-safe build step.
// The supplied dataset is already compiled to data/nexasphere.json.
// The original project referenced a Python source-data compiler that is not
// available in the deployment environment, so this build simply prepares the
// static site without requiring Python or the original XLSX.

import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DIST = resolve(ROOT, 'dist');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(resolve(ROOT, 'public'), DIST, { recursive: true });
await mkdir(resolve(DIST, 'data'), { recursive: true });
await cp(resolve(ROOT, 'data', 'nexasphere.json'), resolve(DIST, 'data', 'nexasphere.json'));
await cp(resolve(ROOT, 'lib'), resolve(DIST, 'lib'), { recursive: true });

console.log('NexaSphere build complete: public + compiled dataset copied to dist/.');
