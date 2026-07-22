// Diagnostic-friendly build runner: runs typecheck + vite build, captures all
// output, and always writes dist/build-log.txt so failures are inspectable on
// static hosting. Exits non-zero only when vite build fails locally
// (NETLIFY_DIAG=1 forces exit 0 so the log still deploys).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const log = [];
const run = (label, cmd, args) => {
  const res = spawnSync(cmd, args, { encoding: 'utf8', shell: true });
  log.push(`\n=== ${label}: ${cmd} ${args.join(' ')} (exit ${res.status}) ===`);
  if (res.stdout) log.push(res.stdout);
  if (res.stderr) log.push(res.stderr);
  return res.status ?? 1;
};

log.push(`node ${process.version} | platform ${process.platform}`);

const tscExit = run('typecheck', 'npx', ['tsc', '--noEmit', '--pretty', 'false']);
const viteExit = run('vite build', 'npx', ['vite', 'build']);

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/build-log.txt', log.join('\n'));

console.log(log.join('\n'));
console.log(`\ntsc exit: ${tscExit}, vite exit: ${viteExit}`);

if (process.env.NETLIFY || process.env.NETLIFY_DIAG === '1') {
  process.exit(0); // always publish so the log is reachable
}
process.exit(viteExit === 0 && tscExit === 0 ? 0 : 1);
