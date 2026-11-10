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

test('主界面侧栏图标引用都在清单里，且没有外链或 inline 回退脚本', () => {
  const html = fs.readFileSync(path.join(DESKTOP, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/src="(assets\/vendor\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 12, `expected 12 sidebar icons, got ${refs.length}`);
  for (const ref of refs) {
    assert.ok(files.some((f) => f.local === 'desktop/' + ref), ref);
  }
  assert.doesNotMatch(html, /src="https?:/i);
  assert.match(html, /<script src="vendor-icons\.js"><\/script>/);
  assert.match(html, /href="vendor-icons\.css"/);
  // CSP 是 script-src 'self'：回退必须走外部文件里的 addEventListener。
  assert.doesNotMatch(html, /onerror\s*=/i);
  assert.ok(fs.existsSync(path.join(DESKTOP, 'vendor-icons.js')));
  assert.ok(fs.existsSync(path.join(DESKTOP, 'vendor-icons.css')));
});

test('协作舱状态情绪图都指向清单里的 Fluent Emoji', () => {
  const js = fs.readFileSync(path.join(DESKTOP, 'stage-ui.js'), 'utf8');
  const block = js.slice(js.indexOf('const MOOD_ART'), js.indexOf('const MOOD_LABEL'));
  const names = [...block.matchAll(/'([a-z0-9_-]+\.svg)'/g)].map((m) => m[1]);
  assert.ok(names.length >= 5, `expected 5 mood images, got ${names.length}`);
  for (const name of names) {
    const local = 'desktop/assets/vendor/fluent-emoji/' + name;
    assert.ok(files.some((f) => f.local === local), local);
  }
  assert.doesNotMatch(js, /MOOD_DIR\s*=\s*['"]https?:/i);
});

test('状态情绪标用的表情缩到 14px 后仍有饱和色', () => {
  const js = fs.readFileSync(path.join(DESKTOP, 'stage-ui.js'), 'utf8');
  const block = js.slice(js.indexOf('const MOOD_ART'), js.indexOf('const MOOD_LABEL'));
  const names = [...block.matchAll(/'([a-z0-9_-]+\.svg)'/g)].map((m) => m[1]);
  assert.equal(names.length, 5, `expected 5 mood images, got ${names.length}`);
  for (const name of names) {
    const text = fs.readFileSync(path.join(DESKTOP, 'assets/vendor/fluent-emoji', name), 'utf8');
    const hexes = [...text.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => m[1]);
    const sats = hexes.map((h) => {
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return Math.max(r, g, b) - Math.min(r, g, b);
    });
    const ratio = sats.length ? sats.filter((s) => s > 60).length / sats.length : 0;
    // 💭/💬 是 #CECECE 灰 + 近白（占比 0.17~0.36），贴在半透明白色 ID 牌上等于隐形。
    assert.ok(ratio >= 0.9, `${name} 饱和色占比只有 ${ratio.toFixed(2)}，缩略后会看不清`);
    assert.ok(Math.max(...sats) >= 150, `${name} 没有足够鲜艳的颜色`);
  }
});
