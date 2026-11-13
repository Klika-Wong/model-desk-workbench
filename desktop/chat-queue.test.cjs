'use strict';

// 「排队位次是编的 / 排队被画成并行」的接线回归断言。
// 排序与文案的行为由 task-dispatch.test.cjs、dispatch-state.test.cjs、chat-multi.test.cjs
// 以真实函数调用覆盖；这里只守住「算出来的 queue 有没有真的接到界面」。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const ui = read('chat-ui.js');
const multi = read('chat-multi.js');
const dispatchUi = read('dispatch-ui.js');
const state = read('dispatch-state.js');
const dispatch = read('task-dispatch.cjs');

function slice(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + 1);
  assert.ok(start >= 0 && end > start, `源码里找不到 ${from} → ${to} 这一段`);
  return source.slice(start, end);
}

const watch = slice(ui, 'async function watchBranch', 'async function sendMulti');
const discuss = slice(ui, 'async function runDiscussionTurn', '// 讨论发言的');
const paint = slice(ui, 'function paintBranch', 'function adoptBranch');

test('排队位次按创建时间或列表顺序，不再按 task id 字典序', () => {
  const block = slice(dispatch, 'const WAITING_STATUSES', 'function exitCodeFailure');
  assert.match(block, /QUEUE_TIME_FIELDS/, '没有声明可用的创建时间字段');
  assert.match(block, /order = exact \? 'created_at' : 'list'/, '没有标明位次的依据');
  assert.match(dispatch, /队列|入队顺序|字典序/, '应写明为什么不能按 id 排序');
  // 仍然把 id 排序当成排队依据就直接失败。
  assert.doesNotMatch(block, /\.map\(\(t\) => String\(t\.id\)\)\s*\.sort\(\)/);
});

test('排队文案在纯逻辑模块里定义并导出', () => {
  assert.match(state, /function queueLabel\(queue, compact = false\)/);
  assert.match(state, /const api = \{ describeTask, queueLabel, TERMINAL, ACTIVE \}/);
  assert.match(state, /order === 'created_at'/);
  assert.match(state, /按任务列表顺序/);
});

test('单聊与派发页不再无条件报精确位次', () => {
  assert.match(ui, /window\.DispatchState\.queueLabel\(queue\)/);
  assert.match(dispatchUi, /window\.DispatchState\.queueLabel\(reply\.data\.queue\)/);
  assert.doesNotMatch(ui + dispatchUi, /排队第 \$\{queue\.position\} 位/,
    '还有一份硬编码的精确位次文案');
});

test('多视角与讨论轮询都把 queue 传给 applyStatus', () => {
  for (const [name, block] of [['多视角', watch], ['讨论', discuss]]) {
    assert.match(block, /queue: status\.data\.queue/, `${name} 轮询丢掉了排队信息`);
  }
  assert.match(paint, /window\.DispatchState\.queueLabel\(branch\.queue, true\)/,
    '卡片没有显示排队信息');
  assert.match(multi, /WAITING\.has\(raw\)\s*\?\s*branch\.status = 'queued'|WAITING\.has\(raw\)\) branch\.status = 'queued'/,
    '排队状态没映射成分支 queued');
});

test('讨论的排队文字只走 labelOverride，不给形象组件新增状态', () => {
  assert.match(discuss, /multi\.WAITING\.has\(raw\)/, '讨论没有识别排队状态');
  assert.match(discuss, /onState\('thinking', badge \? `排队中 · \$\{badge\}` : '排队中'\)/);
  assert.match(ui, /\(state, labelOverride\) => setAgentState\(model\.id, state, undefined, true, labelOverride\)/);
  // 讨论里传给 avatars 的仍是 thinking，不能引入未定义动作帧。
  assert.doesNotMatch(discuss, /onState\('queued'/);
});
