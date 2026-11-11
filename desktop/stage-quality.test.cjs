'use strict';

// 这一组锁住「看得见的品质」：动作名真的解析成走路帧、归位真的会走、
// 空房间有交代、项目定位写清楚。都是静态 / 纯逻辑断言，不需要 Electron。
//
// 仓库布局是 <root>/desktop/*.js，但 E 盘运行实例是 desktop/ 的平铺副本
// （没有 desktop/ 一层，也没有根目录 README / docs）。resolveFile 两种都试，
// 免得同一份测试在仓库里过、在真正跑起来的那份代码上挂掉。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DESKTOP = __dirname;
const ROOT = path.join(DESKTOP, '..');
const resolveFile = (p) => [
  path.join(DESKTOP, p.replace(/^desktop\//, '')),
  path.join(ROOT, p),
].find((f) => fs.existsSync(f)) || null;
const read = (p) => {
  const f = resolveFile(p);
  return f === null ? null : fs.readFileSync(f, 'utf8');
};
const readCode = (p) => {
  const text = read(p);
  assert.ok(text !== null, `找不到源码文件：${p}`);
  return text;
};
const avatars = require('./avatars.js');

test('动作名能直接解析成 spritesheet 的行，不再回落 idle', () => {
  // 根因：setVisual() 传 'moveLeft' / 'moveRight'，旧 actionName 只查 STATE_ACTION，
  // 查不到就回落 idle，于是「归位走路」实际播的是待机帧在平移。
  assert.equal(avatars.actionName(null, 'moveLeft', 'discuss'), 'moveLeft');
  assert.equal(avatars.actionName(null, 'moveRight', 'discuss'), 'moveRight');
  assert.equal(avatars.actionName(null, 'wave', 'discuss'), 'wave');
  assert.equal(avatars.actionName(null, 'jump', 'discuss'), 'jump');
  assert.equal(avatars.actionRow(null, 'moveLeft', 'discuss'), 2);
  assert.equal(avatars.actionRow(null, 'moveRight', 'discuss'), 1);
  // 走路行是满 8 帧；沿用 idle 的 6 帧会扫到空白格 = 闪。
  assert.equal(avatars.actionFrames(null, 'moveLeft', 'discuss'), 8);
  assert.equal(avatars.actionFrames(null, 'moveRight', 'discuss'), 8);
});

test('放行直接动作名没有破坏真实状态映射与场景覆盖', () => {
  assert.equal(avatars.actionName(null, 'waiting', 'discuss'), 'idle');
  assert.equal(avatars.actionName(null, 'thinking', 'discuss'), 'work');
  assert.equal(avatars.actionName(null, 'speaking', 'discuss'), 'work');
  assert.equal(avatars.actionName(null, 'done', 'discuss'), 'wave');
  assert.equal(avatars.actionName(null, 'failed', 'discuss'), 'fail');
  assert.equal(avatars.actionName(null, 'stalled', 'discuss'), 'wait');
  assert.equal(avatars.actionName(null, 'poke', 'discuss'), 'jump');
  assert.equal(avatars.actionName(null, 'drag', 'discuss'), 'moveRight');
  assert.equal(avatars.actionName(null, '不存在的状态', 'discuss'), 'idle');
  assert.equal(avatars.actionName(null, 'thinking', 'work'), 'work');
  assert.equal(avatars.actionName(null, 'thinking', 'slack'), 'idle');
});

test('归位走路不再只限于讨论中，且首次进场 / 降低动效 / 隐藏页不空踩', () => {
  const js = readCode('stage-ui.js');
  assert.doesNotMatch(js, /moved\s*&&\s*discussing/, '走路仍被限制在讨论进行中');
  assert.match(readCode('avatars.js'), /hasOwnProperty\.call\(ACTIONS, state\)/,
    '动作名放行逻辑不在 avatars.js 里');
  assert.match(js, /const firstSeat = !a\.hasSeat/, '首次进场没有跳过走路帧');
  assert.match(js, /!firstSeat && !motionReduced\(\) && !page\.hidden/, '缺少动效/可见性保护');
  assert.match(js, /setVisual\(a, x < prevX \? 'moveLeft' : 'moveRight', walkMs \+ 40\)/,
    '走路时长没有跟 CSS --walk 对齐');
  assert.match(js, /const walking = a\.visualState === 'moveLeft' \|\| a\.visualState === 'moveRight'/,
    '连续归位时走路方向无法刷新，或会打断招手/戳一下');
  // 走路帧有独立左右两行，不能再被连线朝向镜像一次。
  assert.match(js, /\(v === 'moveLeft' \|\| v === 'moveRight'\) \? 'right' : facing/);
  const hide = js.slice(js.indexOf('function hide()'), js.indexOf("$('nav-stage').addEventListener"));
  assert.match(hide, /clearVisual\(a\)/, '切页隐藏时没有收回走路帧');
});

test('空房间有引导，且按真实状态区分文案、不写编造的数值', () => {
  const html = readCode('index.html');
  const css = readCode('stage.css');
  const js = readCode('stage-ui.js');
  assert.match(html, /id="stage-empty"[^>]*hidden/, '空状态默认应隐藏');
  assert.match(html, /id="stage-empty-goto"/);
  assert.match(html, /房间里还没有人/);
  assert.match(css, /\.stage-empty\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.stage-empty button\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.stage-empty \{[\s\S]*?position: absolute/);
  assert.match(js, /box\.hidden = actors\.size > 0/, '空状态显隐不是只看真实角色数');
  assert.match(js, /updateEmptyState\(\);[\s\S]*?applyEcosystem\(true\);|applyEcosystem\(true\);\s*updateEmptyState\(\)/);
  assert.match(js, /\$\('stage-empty-goto'\)\?\.addEventListener/);
  // 有在线模型只是没勾选 vs 一个都没连上，是两件事，不能混成一句笼统提示。
  assert.match(js, /models\.filter\(isOnline\)\.length/, '空状态没读真实在线模型数');
  assert.match(js, /还没有人参与/);
  assert.match(js, /btn\.hidden = true/);
  // 文案是人话，不是「开启你的协作之旅」这类套话，也没有假百分比 / 假产出。
  const card = html.slice(html.indexOf('id="stage-empty"'), html.indexOf('id="facility-panel"'));
  assert.doesNotMatch(card, /\d+\s*%|效率|产出|心情|算力|之旅|赋能|一站式/);
  assert.doesNotMatch(card, /onclick|onerror/i, 'CSP 是 script-src self，不能写内联 handler');
});

test('README 明确写出「商用品质 / 不商用」的定位', (t) => {
  const readme = read('README.md');
  const third = read('THIRD_PARTY.md');
  // 运行实例只含 desktop/ 的平铺副本，没有根目录文档；此处明确跳过而不是假装通过。
  if (readme === null || third === null) {
    return t.skip('精简运行实例不含根目录文档');
  }
  assert.match(readme, /## 定位与品质目标/);
  assert.match(readme, /不分发、不商用、不对外提供服务/);
  assert.match(readme, /用途非商业，不等于品质可以凑合/);
  assert.match(readme, /若将来改变用途/);
  assert.doesNotMatch(third, /公开发布或商业化前必须替换这批素材/,
    '已确定不商用，不该继续留悬置的替换警告');
  assert.match(third, /若将来改变用途/);
});
