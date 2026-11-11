'use strict';

// SOURCE-MANIFEST 跨平台核对：生成端、Python 校验端、单测共用同一套字节规则。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const { canonicalBytes } = require('./source-manifest-bytes.cjs');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// E 盘运行实例是 desktop/ 的平铺副本，没有仓库根目录的清单和 scripts/。
// 缺布局时明确 skip，不把「没测到」算成通过。
const manifestPath = path.join(ROOT, 'SOURCE-MANIFEST.json');
const checkerPath = path.join(ROOT, 'scripts', 'check_public_source.py');
const hasRepoLayout = fs.existsSync(manifestPath) && fs.existsSync(checkerPath);
const skipLayout = hasRepoLayout ? undefined : '运行实例是 desktop 平铺副本，没有根目录清单与校验脚本';

test('CRLF 与 LF 两种检出规范化后哈希一致', () => {
  const crlf = Buffer.from('# 标题\r\nconst a = 1;\r\n', 'utf8');
  const lf = Buffer.from('# 标题\nconst a = 1;\n', 'utf8');
  assert.equal(sha(canonicalBytes(crlf)), sha(canonicalBytes(lf)), '换台机器检出就对不上了');
  assert.equal(canonicalBytes(crlf).length, lf.length, '字节数也要按规范化后的算');
});

test('二进制文件原样保留，CRLF 字节序列不被改写', () => {
  const pngish = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0x1a]);
  assert.deepEqual(canonicalBytes(pngish), pngish);
});

test('孤立 CR 与 UTF-8 BOM 不被破坏', () => {
  const raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\rb\r\nc', 'utf8')]);
  const out = canonicalBytes(raw);
  assert.equal(out[0], 0xef, 'BOM 必须保留');
  assert.ok(out.includes(0x0d), '只有 CR 后面紧跟 LF 时才去掉 CR');
  assert.equal(sha(out), sha(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\rb\nc', 'utf8')])));
});

test('清单对本机工作区逐文件核对通过', { skip: skipLayout }, () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.match(manifest.hashing, /^sha256 over LF-normalized/, '清单没有声明哈希规则');
  const bad = [];
  for (const row of manifest.files) {
    const abs = path.join(ROOT, row.path);
    if (!fs.existsSync(abs)) { bad.push(row.path + ' (missing)'); continue; }
    const buf = canonicalBytes(fs.readFileSync(abs));
    if (sha(buf) !== row.sha256 || buf.length !== row.bytes) bad.push(row.path);
  }
  assert.deepEqual(bad, [], `清单与工作区不一致：${bad.slice(0, 6).join(', ')}`);
});

test('Python 校验端与生成端用同一套规则', { skip: skipLayout }, () => {
  const py = fs.readFileSync(checkerPath, 'utf8');
  assert.ok(py.includes('canonical_bytes(file.read_bytes())'), '校验端没有用规范化字节');
  assert.ok(py.includes("b'\\0' in raw"), '二进制判定与生成端不一致');
  assert.ok(py.includes("raw.replace(b'\\r\\n', b'\\n')"), 'CRLF 规范化与生成端不一致');
  assert.ok(py.includes('manifest-hashing-rule-missing-or-old'), '旧格式清单没有被明确识别');
  assert.ok(py.includes('BINARY_SUFFIXES'), '校验脚本没有区分合法二进制素材');
  assert.ok(py.includes("'.gif', '.webp'"), '角色序列帧没有被列入跳过名单');
  assert.ok(py.includes('unreadable-or-binary'), '未知二进制的告警不能丢');
});

test('发布源码校验脚本实际返回零 findings', { skip: skipLayout }, (t) => {
  const probe = spawnSync('python', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) { t.skip('本机没有可用的 python 命令'); return; }
  // 真的跑一遍，而不是只读源码：清单 0 mismatch + 扫描 0 告警才算「可离线核对」。
  const run = spawnSync('python', [checkerPath], { cwd: ROOT, encoding: 'utf8' });
  const out = String(run.stdout || '').trim();
  assert.ok(out.startsWith('{'), `校验脚本没有输出 JSON：${String(run.stderr).slice(0, 200)}`);
  const result = JSON.parse(out);
  assert.equal(run.status, 0, `校验脚本返回非零：${out.slice(0, 300)}`);
  assert.deepEqual(result.findings, [], `源码扫描有告警：${JSON.stringify(result.findings.slice(0, 3))}`);
});

test('生成脚本使用共享规则而不是自己读原始字节', { skip: skipLayout }, () => {
  const js = fs.readFileSync(path.join(ROOT, 'scripts', 'build-source-manifest.cjs'), 'utf8');
  assert.ok(js.includes("require('../desktop/source-manifest-bytes.cjs')"), '生成端没有引用共享规则');
  assert.ok(js.includes('canonicalBytes(fs.readFileSync(abs))'), '生成端还在对原始字节算哈希');
});
