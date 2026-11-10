/* 第三方素材完整性：这些 SVG 是从上游仓库复制进来的，不是本项目手绘。
   防止清单漂移、素材缺失、或有人把 CDN 外链塞回离线页面。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DESKTOP = __dirname;
const LIST = path.join(DESKTOP, 'assets', 'vendor', 'SOURCES.json');
const cfg = JSON.parse(fs.readFileSync(LIST, 'utf8'));
const files = cfg.sources.flatMap((s) => s.files);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// 清单里的路径以仓库根为基准；桌宠代码被同步到运行实例后，那段前缀不复存在。
// 统一按「desktop 目录」定位，仓库和运行实例都能跑同一套测试。
const localAbs = (rel) => path.join(DESKTOP, rel.replace(/^desktop\//, ''));

test('来源清单固定到上游 commit，本地路径不越界', () => {
  assert.equal(cfg.sources.length, 2);
  for (const source of cfg.sources) {
    assert.match(source.repo, /^[\w-]+\/[\w-]+$/);
    assert.match(source.commit, /^[0-9a-f]{40}$/);
    assert.equal(source.license, 'MIT');
    for (const file of source.files) {
      assert.ok(file.local.startsWith('desktop/assets/vendor/'), file.local);
      assert.ok(!file.local.includes('..'), file.local);
    }
  }
});

test('每个 vendor 文件存在，哈希与字节数与清单一致', () => {
  for (const file of files) {
    const abs = localAbs(file.local);
    assert.ok(fs.existsSync(abs), file.local);
    const buf = fs.readFileSync(abs);
    assert.equal(sha(buf), file.sha256, file.local);
    assert.equal(buf.length, file.bytes, file.local);
  }
});

test('两份上游 LICENSE 原文随附且标明 MIT', () => {
  for (const source of cfg.sources) {
    const abs = localAbs(source.licenseLocal);
    assert.ok(fs.existsSync(abs), source.licenseLocal);
    const text = fs.readFileSync(abs, 'utf8');
    assert.match(text, /MIT License/);
    assert.match(text, /Copyright \(c\)/);
  }
});

test('SVG 是真的矢量文件，不是 404 页面', () => {
  for (const file of files.filter((f) => f.upstream.endsWith('.svg'))) {
    const text = fs.readFileSync(localAbs(file.local), 'utf8').slice(0, 2000);
    assert.match(text, /<svg[\s>]/i, file.local);
  }
});

test('桌宠 HTML 的图标引用全部指向本地 vendor 且无外链', () => {
  const html = fs.readFileSync(path.join(DESKTOP, 'pet.html'), 'utf8');
  const refs = [...html.matchAll(/src="(assets\/vendor\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 6, `expected 6 toolbar icons, got ${refs.length}`);
  for (const ref of refs) {
    assert.ok(files.some((f) => f.local === 'desktop/' + ref), ref);
  }
  assert.doesNotMatch(html, /src="https?:/i);
});

test('表情映射都指向清单里的 Fluent Emoji，脚本没有外链', () => {
  const js = fs.readFileSync(path.join(DESKTOP, 'pet-ui.js'), 'utf8');
  const block = js.slice(js.indexOf('const GLYPH_ART'), js.indexOf('function artNode'));
  const names = [...block.matchAll(/'([a-z0-9_-]+\.svg)'/g)].map((m) => m[1]);
  assert.ok(names.length >= 8, `expected the emote map, got ${names.length}`);
  for (const name of names) {
    const local = 'desktop/assets/vendor/fluent-emoji/' + name;
    assert.ok(files.some((f) => f.local === local), local);
  }
  assert.doesNotMatch(js, /(?:src|href)\s*=\s*["']https?:/i);
  assert.doesNotMatch(js, /(?:EMOJI_DIR|ICON_DIR)\s*=\s*['"]https?:/i);
});
