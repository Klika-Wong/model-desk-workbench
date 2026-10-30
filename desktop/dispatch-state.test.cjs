'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { describeTask } = require('./dispatch-state.js');

test('非终态状态保持非终态', () => {
  for (const status of ['queued', 'pending', 'dispatching', 'running', 'in_progress', 'executing']) {
    const view = describeTask({ status });
    assert.equal(view.terminal, false, status);
    assert.equal(view.tone, 'neutral', status);
    assert.ok(view.label.length > 0, status);
  }
});

test('accepted 且有有效验收证据才标已验收', () => {
  const view = describeTask({ status: 'accepted', review: { state: 'accepted', acceptance_valid: true } });
  assert.deepEqual([view.terminal, view.tone], [true, 'success']);
  assert.match(view.label, /已验收/);

  const final = describeTask({ status: 'accepted', review: { state: 'final_accepted', acceptance_valid: true } });
  assert.equal(final.tone, 'success');
  assert.match(final.label, /已验收/);
});

test('accepted 没有有效验收证据时不算失败、也不算已验收', () => {
  const cases = [
    { status: 'accepted' },
    { status: 'accepted', review: { state: 'accepted' } },
    { status: 'accepted', review: { state: 'accepted', acceptance_valid: 'true' } },
    { status: 'accepted', review: { state: 'accepted', acceptance_valid: 1 } },
    { status: 'accepted', review: { acceptance_valid: true } },
    { status: 'accepted', review: { state: 'returned', acceptance_valid: true } },
  ];
  for (const task of cases) {
    const view = describeTask(task);
    assert.notEqual(view.tone, 'error', JSON.stringify(task));
    assert.notEqual(view.tone, 'success', JSON.stringify(task));
    assert.equal(view.tone, 'neutral', JSON.stringify(task));
    assert.doesNotMatch(view.label, /已验收/, JSON.stringify(task));
    assert.match(view.label, /验收待核实/, JSON.stringify(task));
  }
});

test('completed 单独不能标已验收，有独立有效证据才能升级', () => {
  const view = describeTask({ status: 'completed' });
  assert.notEqual(view.tone, 'success');
  assert.doesNotMatch(view.label, /已验收/);
  assert.equal(view.terminal, true);
  assert.equal(describeTask({ status: 'completed', review: { state: 'accepted', acceptance_valid: true } }).tone, 'success');
  for (const acceptance_valid of [false, 'true', 1, undefined]) {
    assert.equal(describeTask({ status: 'completed', review: { state: 'accepted', acceptance_valid } }).tone, 'neutral');
  }
});

test('非零有限数字退出码优先显示错误', () => {
  for (const task of [{ status: 'running' }, { status: 'completed' }, { status: 'accepted', review: { state: 'accepted', acceptance_valid: true } }, { status: 'failed' }]) {
    const view = describeTask(task, 2);
    assert.equal(view.tone, 'error', task.status);
    assert.equal(view.terminal, true, task.status);
    assert.match(view.label, /退出码 2/, task.status);
  }
});

test('未定义或 0 退出码不视为执行器异常', () => {
  for (const exitCode of [undefined, null, 0, '0', '1', NaN, Infinity, true, {}]) {
    const view = describeTask({ status: 'completed' }, exitCode);
    assert.notEqual(view.tone, 'error', String(exitCode));
    assert.equal(view.terminal, true, String(exitCode));
  }
  const ok = describeTask({ status: 'accepted', review: { state: 'accepted', acceptance_valid: true } }, 0);
  assert.equal(ok.tone, 'success');
});

test('cancelled 中性显示已取消', () => {
  const view = describeTask({ status: 'cancelled' });
  assert.deepEqual([view.terminal, view.tone], [true, 'neutral']);
  assert.match(view.label, /已取消/);
  assert.equal(describeTask({ status: 'cancelled' }, 0).tone, 'neutral');
});

test('failed 显示错误', () => {
  const view = describeTask({ status: 'failed' });
  assert.deepEqual([view.terminal, view.tone], [true, 'error']);
});

test('未知或缺失状态保持非终态并显示未知', () => {
  for (const task of [undefined, null, {}, { status: 'mystery' }, { status: 'COMPLETED_X' }, { status: 123 }]) {
    const view = describeTask(task);
    assert.equal(view.terminal, false, JSON.stringify(task));
    assert.equal(view.tone, 'neutral', JSON.stringify(task));
    assert.match(view.label, /未知/, JSON.stringify(task));
  }
});

test('大小写与空白不影响状态识别', () => {
  assert.equal(describeTask({ status: '  RUNNING ' }).terminal, false);
  assert.equal(describeTask({ status: 'Completed' }).terminal, true);
});

test('不修改输入对象', () => {
  const task = { status: 'accepted', review: { state: 'accepted', acceptance_valid: true } };
  const snapshot = JSON.stringify(task);
  describeTask(task, 1);
  assert.equal(JSON.stringify(task), snapshot);
});

test('可在浏览器全局访问', () => {
  const code = require('node:fs').readFileSync(require.resolve('./dispatch-state.js'), 'utf8');
  assert.match(code, /window\.DispatchState|global\.DispatchState/);
  assert.doesNotMatch(code, /document\.|fetch\(|require\(/);
});
