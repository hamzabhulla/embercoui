// Regression gate for the Vercel serverless entry (api/index.ts).
//
// Why this exists: the generated Vercel function is ESM, and Node ESM
// rejects extensionless relative imports — a class of breakage that the
// frontend typecheck (covers src/ only), the backend typecheck and local
// tsx runs ALL fail to catch. The only trustworthy check is to build the
// function with Vercel's own @vercel/node builder, import the generated
// output with plain Node, and hit it over HTTP. That's what this does.
//
// Usage: npm run verify:vercel   (needs network once to fetch @vercel/node)
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'ember-vercel-gate-'));
const tools = path.join(work, 'tools');
const out = path.join(work, 'out');
mkdirSync(tools, { recursive: true });

console.log('[gate] installing @vercel/node builder…');
// --prefix into a plain lowercase dir: `npm init` would reject the random
// mixed-case temp folder name as a package name.
execSync(`npm install --silent --prefix ${tools} @vercel/node@26`, { stdio: 'inherit', shell: '/bin/bash' });

const buildScript = path.join(work, 'build.mjs');
writeFileSync(buildScript, `
import { build } from '${tools}/node_modules/@vercel/node/dist/index.js';
import { FileFsRef, download } from '${tools}/node_modules/@vercel/build-utils/dist/index.js';
import path from 'node:path';
const workPath = ${JSON.stringify(root)};
const entrypoint = 'api/index.ts';
const files = { [entrypoint]: new FileFsRef({ fsPath: path.join(workPath, entrypoint) }) };
const result = await build({ files, entrypoint, workPath, repoRootPath: workPath, config: {}, meta: { skipDownload: true } });
await download(result.output.files, ${JSON.stringify(out)});
console.log('[gate] function built');
`);
try {
  execSync(`node ${buildScript}`, { stdio: 'inherit' });
} catch {
  console.error(`[gate] FAIL: @vercel/node build failed. Work dir kept for debugging: ${work}`);
  process.exit(1);
}

if (!existsSync(path.join(out, 'api/index.js'))) {
  console.error(`[gate] FAIL: builder did not emit api/index.js. Work dir kept for debugging: ${work}`);
  process.exit(1);
}

writeFileSync(path.join(out, 'run.mjs'), `
import app from './api/index.js';
app.listen(4300, () => console.log('up'));
`);
const server = spawn('node', ['run.mjs'], { cwd: out, stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const deadline = Date.now() + 20000;
let ok = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch('http://localhost:4300/api/v1/health');
    const body = await res.json();
    if (res.status === 200 && body.status === 'ok') { ok = true; break; }
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 500));
}
server.kill('SIGTERM');
if (!ok) {
  console.error('[gate] FAIL: generated function did not answer /api/v1/health with 200 {status:"ok"}');
  console.error(serverLog.slice(0, 2000));
  console.error(`[gate] work dir kept for debugging: ${work}`);
  process.exit(1);
}
console.log('[gate] PASS: generated Vercel function loads in plain Node and serves /api/v1/health');
rmSync(work, { recursive: true, force: true });
