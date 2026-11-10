/* 真实启动路径验证的接线检查：只锁「这条验证存在且没有被改成摆设」，
   真正的窗口/托盘/退出行为由 `npm run verify:main` 在 Electron 里跑。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const mainSource = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('package.json 里有 test 与 verify:main（README 承诺过 npm test）', () => {
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.scripts['verify:main'], 'node main-verify-run.cjs');
});

test('验证模式和 smoke 是两个独立开关，不会互相顶掉', () => {
  assert.match(mainSource, /MODEL_DESK_MAIN_VERIFY/);
  assert.match(mainSource, /--verify-main/);
  // smoke 分支必须仍然先返回，否则 smoke 会去建真窗口
  const smokeIdx = mainSource.indexOf('await runSmoke()');
  const verifyIdx = mainSource.indexOf('await runMainVerify()');
  assert.ok(smokeIdx > 0 && verifyIdx > smokeIdx, 'runMainVerify 应排在 runSmoke 之后');
});

test('验证用自己的 userData，不碰用户真实目录', () => {
  assert.match(mainSource, /MODEL_DESK_MAIN_VERIFY_PROFILE/);
  assert.match(mainSource, /requestSingleInstanceLock/);
});

test('验证不会拉起外部 Python 服务', () => {
  assert.match(mainSource, /if \(smokeMode \|\| mainVerifyMode \|\| !PANEL_AUTOSTART\)/);
});

test('backgroundThrottling 只在 smoke 里关掉', () => {
  // Electron 的 getLastWebPreferences() 不返回这个键，只能在源码层锁住。
  assert.match(mainSource, /backgroundThrottling: !smokeMode/);
});

test('判定不靠 isVisible()：这台机器上它会在 show 事件后读回 false', () => {
  assert.match(mainSource, /window\.__shown = true/);
  assert.doesNotMatch(mainSource, /if \(!await waitFor\(\(\) => win\.isVisible\(\)/);
});

test('运行器用系统临时目录的独立 profile，不递归删固定目录', () => {
  const runner = fs.readFileSync(path.join(root, 'main-verify-run.cjs'), 'utf8');
  assert.match(runner, /mkdtemp/);
  assert.match(runner, /MODEL_DESK_MAIN_VERIFY_PROFILE/);
  assert.doesNotMatch(runner, /fs\.promises\.rm\(resultFile, \{ recursive/);
});
