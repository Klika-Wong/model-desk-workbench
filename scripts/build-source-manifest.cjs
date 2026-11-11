/* 重建 SOURCE-MANIFEST.json：列出 git 跟踪的源码文件的路径、字节数和 SHA-256。
   清单自身不纳入（避免自引用）。发布前跑一次，配合 scripts/check_public_source.py 核对。 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
// 规则放在 desktop/ 里：E 盘运行实例是 desktop 的平铺副本，也要能跑同一套核对。
const { canonicalBytes } = require('../desktop/source-manifest-bytes.cjs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'SOURCE-MANIFEST.json');

const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
  .split('\n').map((s) => s.trim()).filter(Boolean)
  .filter((rel) => rel !== 'SOURCE-MANIFEST.json')
  .sort();

const files = [];
for (const rel of tracked) {
  const abs = path.join(ROOT, rel);
  let stat;
  try { stat = fs.statSync(abs); } catch { continue; }
  if (!stat.isFile()) continue;
  // 按规范化字节记录，不能用工作区原始字节：本机 core.autocrlf=true 会把检出转成 CRLF，
  // 换台机器（LF）按原字节核对就会全量 mismatch。二进制由 canonicalBytes 原样保留。
  const buf = canonicalBytes(fs.readFileSync(abs));
  files.push({
    path: rel.replace(/\\/g, '/'),
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
  });
}

const manifest = {
  project: 'Model Desk Workbench',
  version: '0.1.0-preview',
  date: new Date().toISOString().slice(0, 10),
  scope: 'Source-only snapshot; excludes runtime data and this manifest itself.',
  hashing: 'sha256 over LF-normalized bytes; files containing NUL bytes are hashed verbatim',
  files,
};
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(`SOURCE-MANIFEST.json 已重建：${files.length} 个文件`);
