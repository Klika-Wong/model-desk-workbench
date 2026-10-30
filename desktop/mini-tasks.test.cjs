'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { composeMiniPayload, labelOf } = require('./mini-tasks.cjs');

const project = 'E:\\model-desk-fixture';
const connected = {
  state: 'connected',
  tasks: 3,
  truncated: false,
  taskList: [
    { id: 't1', title: '写方案', status: 'running' },
    { id: 't2', title: '跑测试', status: 'completed' },
    { id: 't3', title: '', status: 'failed' },
  ],
};

test('连上工作台时只显示真实任务，不混入演示任务', () => {
  const payload = composeMiniPayload({ panel: connected, project, demo: [{ id: 'd1', label: '演示 A', status: 'running' }] });
  assert.equal(payload.source, 'real');
  assert.deepEqual(payload.tasks.map((t) => t.id), ['t1', 't2', 't3']);
  assert.equal(payload.tasks[0].state, '运行中');
  assert.equal(payload.tasks[1].state, '执行结束 · 待验收');
  assert.equal(payload.tasks[2].label, 't3', '没有标题时退化为 id，不编造');
  assert.match(payload.note, /3 条任务/);
});

test('连上但未绑定项目时不泄露任何任务', () => {
  const payload = composeMiniPayload({ panel: connected, project: '', demo: [] });
  assert.equal(payload.source, 'real');
  assert.deepEqual(payload.tasks, []);
  assert.match(payload.note, /未绑定项目/);
});

test('连不上时退回演示任务，并说明原因', () => {
  const demo = [{ id: 'd1', label: '演示 A', status: 'running' }];
  const payload = composeMiniPayload({ panel: { state: 'unreachable' }, project, demo });
  assert.equal(payload.source, 'demo');
  assert.equal(payload.tasks.length, 1);
  assert.match(payload.note, /未发现运行中的工作台/);
});

test('状态文案未知时不假装知道', () => {
  assert.equal(labelOf('weird_state'), '未知');
  assert.equal(labelOf(''), '未知');
  assert.equal(labelOf('in_progress'), '执行中');
});

test('真实任务的独立验收与执行状态分开显示', () => {
  const taskList = [
    { id: 'returned', status: 'completed', reviewState: 'returned' },
    { id: 'blocked', status: 'failed', reviewState: 'blocked' },
    { id: 'accepted', status: 'completed', reviewState: 'accepted', acceptanceValid: true },
    { id: 'stale', status: 'completed', reviewState: 'accepted', acceptanceValid: false },
    { id: 'takeover', status: 'failed', reviewState: 'final_accepted', acceptanceValid: true },
    { id: 'unverified', status: 'completed', reviewState: 'accepted' },
  ];
  const payload = composeMiniPayload({ panel: { ...connected, taskList }, project });
  assert.deepEqual(payload.tasks.map(t => t.state), ['已退回整改', '需要主脑处理', '已验收', '验收失效 · 待复核', '主脑接管 · 已验收', '验收待核实']);
  assert.equal(payload.tasks[4].status, 'failed', '主脑接管不能改写执行端失败记录');
});
