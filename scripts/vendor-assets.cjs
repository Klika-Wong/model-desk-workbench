#!/usr/bin/env node
/* Re-fetch the vendored third-party assets listed in desktop/assets/vendor/SOURCES.json.
 *
 *   node scripts/vendor-assets.cjs               download from the pinned upstream commits (direct)
 *   node scripts/vendor-assets.cjs --proxy URL   route through a proxy if direct access is blocked
 *   node scripts/vendor-assets.cjs --check       offline: verify local files against recorded SHA-256
 *
 * Why this exists: the SVGs are copied from real open-source projects, not redrawn here.
 * Pinning each file to a commit SHA + recording its hash makes that claim checkable.
 * Requires the system `curl` (bundled with Windows 10+ and Git Bash). Direct access is
 * the default because a stale https_proxy in the environment is a common failure here;
 * pass --proxy explicitly when the network needs it. No npm dependency is added.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LIST = path.join(ROOT, 'desktop', 'assets', 'vendor', 'SOURCES.json');
const checkOnly = process.argv.includes('--check');
const proxyAt = process.argv.indexOf('--proxy');
const proxy = proxyAt > -1 ? process.argv[proxyAt + 1] : null;
if (proxyAt > -1 && !proxy) {
  process.stderr.write('--proxy needs a URL, e.g. --proxy http://127.0.0.1:7897\n');
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(LIST, 'utf8'));
const shaOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const urlOf = (src, upstream) =>
  `https://raw.githubusercontent.com/${src.repo}/${src.commit}/${upstream.replace(/ /g, '%20')}`;

// Network here is flaky: direct access and local proxies alternate between working and
// being reset. Try each channel per file, then remember whichever one succeeded.
const channels = [];
const addChannel = (args) => {
  const key = args.join(' ');
  if (key && !channels.some((c) => c.key === key)) channels.push({ key, args });
};
if (proxy) addChannel(['-x', proxy]);
addChannel(['--noproxy', '*']);
for (const env of [process.env.https_proxy, process.env.HTTPS_PROXY, process.env.http_proxy]) {
  if (env) addChannel(['-x', env]);
}
let preferred = 0;
function fetchUrl(url) {
  let lastErr;
  for (let i = preferred; i < channels.length; i += 1) {
    const args = ['-fsSL', '--retry', '2', '--retry-delay', '1', '--retry-all-errors', '--max-time', '25',
      ...channels[i].args, url];
    try {
      const buf = execFileSync('curl', args, { maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      preferred = i;
      return buf;
    } catch (err) { lastErr = err; }
  }
  throw new Error(`all ${channels.length} channels failed for ${url}: ${lastErr && lastErr.message}`);
}

let verified = 0;
let refreshed = 0;
let cached = 0;
const problems = [];
const persist = () => fs.writeFileSync(LIST, JSON.stringify(cfg, null, 2) + '\n');

try {
  for (const src of cfg.sources) {
    for (const file of src.files) {
      const dst = path.join(ROOT, file.local);
      const exists = fs.existsSync(dst);
      if (checkOnly) {
        if (!exists) { problems.push(`missing: ${file.local}`); continue; }
        const buf = fs.readFileSync(dst);
        if (!file.sha256) { problems.push(`no recorded sha256: ${file.local}`); continue; }
        if (shaOf(buf) !== file.sha256) problems.push(`hash mismatch: ${file.local}`);
        else verified += 1;
        continue;
      }
      // Resume: a file already on disk with a matching recorded hash is left alone.
      if (file.sha256 && exists && shaOf(fs.readFileSync(dst)) === file.sha256) {
        cached += 1;
        continue;
      }
      const url = urlOf(src, file.upstream);
      const buf = fetchUrl(url);
      if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error(`empty download: ${url}`);
      // Fluent Emoji starts with <svg>; Tabler Icons prefixes an XML comment header.
      if (file.upstream.endsWith('.svg') && !/<svg[\s>]/i.test(buf.toString('utf8').slice(0, 2000))) {
        throw new Error(`not an SVG: ${url}`);
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, buf);
      file.sha256 = shaOf(buf);
      file.bytes = buf.length;
      persist();                 // write progress after every file, so a dropped connection is resumable
      refreshed += 1;
      process.stdout.write(`  ${file.local} (${buf.length} B)\n`);
    }
  }
} catch (err) {
  persist();
  process.stderr.write(`vendored assets: FAILED — ${err.message}\n`);
  process.stderr.write('  Re-run the same command: already-downloaded files are skipped.\n');
  process.exit(1);
}

if (checkOnly) {
  if (problems.length) {
    for (const p of problems) process.stderr.write(`  ${p}\n`);
    process.exit(1);
  }
  process.stdout.write(`vendored assets OK: ${verified} files, ${cfg.sources.length} sources (offline check)\n`);
} else {
  persist();
  process.stdout.write(`vendored assets OK: ${refreshed} downloaded, ${cached} unchanged, ${cfg.sources.length} sources\n`);
}
