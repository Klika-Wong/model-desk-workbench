'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pickModels, createBranch, applyStatus, summarize, MAX_BRANCHES } = require('./chat-multi.js');

const models = [
  { id: 'a', name: '模型 A', local: false },
  { id: 'b', name: '模型 B', local: true },
  { id: 'c', name: '模型 C', local: false },
  { id: 'd', name: '模型 D', local: false },
];

test('选择分支：按用户勾选顺序、去重、最多三个', () => {
  assert.deepEqual(pickModels(models, ['c', 'a']).map((m) => m.id), ['c', 'a']);
  assert.deepEqual(pickModels(models, ['c', 'c', 'a']).map((m) => m.id), ['c', 'a'], '重复选择只算一次');
  assert.equal(pickModels(models, ['a', 'b', 'c', 'd']).length, MAX_BRANCHES, '最多三个');
  assert.deepEqual(pickModels(models, ['a', '不存在']).map((m) => m.id), ['a'], '未知 id 忽略');
  assert.deepEqual(pickModels(models, []), []);
  assert.deepEqual(pickModels(null, ['a']), [], '模型列表缺失时返回空，不抛错');
});

test('分支初始状态带模型身份，便于并列显示', () => {
  const branch = createBranch(models[1], 1);
  assert.equal(branch.key, '2');
  assert.equal(branch.modelName, '模型 B');
  assert.equal(branch.local, true);
  assert.equal(branch.status, 'queued');
  assert.equal(branch.taskId, null);
});

test('状态映射：非零退出码一律失败，不冒充完成', () => {
  const branch = createBranch(models[0], 0);
  applyStatus(branch, { state: 'completed', answer: '好的', exitCode: 1 });
  assert.equal(branch.status, 'failed');
  assert.match(branch.error, /exit code 1/);
  assert.equal(branch.answer, '好的', '回答仍保留，但要标为无效');
});

test('状态映射：完成 / 失败 / 取消 / 运行中', () => {
  const done = applyStatus(createBranch(models[0], 0), { state: 'completed', answer: 'x', tokens: 12 });
  assert.equal(done.status, 'done');
  assert.equal(done.tokens, 12);

  const accepted = applyStatus(createBranch(models[0], 0), { state: 'accepted', answer: 'y' });
  assert.equal(accepted.status, 'done', 'accepted 也是成功');

  const cancelled = applyStatus(createBranch(models[0], 0), { state: 'cancelled' });
  assert.equal(cancelled.status, 'failed');
  assert.match(cancelled.error, /取消/);

  const running = applyStatus(createBranch(models[0], 0), { state: 'running', answer: '半截' });
  assert.equal(running.status, 'running');
  assert.equal(running.answer, '半截', '运行中也要能显示部分正文');
});

test('汇总：只有拿到非空回答的分支可采纳', () => {
  const a = applyStatus(createBranch(models[0], 0), { state: 'completed', answer: '答案 A' });
  const b = applyStatus(createBranch(models[1], 1), { state: 'completed', answer: '   ' });
  const c = applyStatus(createBranch(models[2], 2), { state: 'failed' });
  const summary = summarize([a, b, c]);
  assert.equal(summary.total, 3);
  assert.equal(summary.done, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.allSettled, true);
  assert.deepEqual(summary.adoptable, ['1'], '空回答不可采纳');
});

test('汇总：未全部结束时不宣称完成', () => {
  const a = applyStatus(createBranch(models[0], 0), { state: 'completed', answer: 'ok' });
  const b = createBranch(models[1], 1);
  const summary = summarize([a, b]);
  assert.equal(summary.allSettled, false);
  assert.equal(summary.settled, 1);
  assert.deepEqual(summarize([]), { total: 0, done: 0, failed: 0, settled: 0, allSettled: false, adoptable: [], tokenTotal: 0 });
});

test('讨论 prompt：带问题与历史发言，空发言跳过', () => {
  const { buildDiscussionPrompt } = require('./chat-multi.js');
  const prompt = buildDiscussionPrompt({
    question: '这个方案有什么风险？',
    spoken: [
      { modelName: 'A', text: '风险是显存不足。' },
      { modelName: 'B', text: '' },
      { modelName: 'C', text: '还有并发写冲突。' },
    ],
  });
  assert.ok(prompt.includes('这个方案有什么风险'));
  assert.ok(prompt.includes('【A】风险是显存不足'));
  assert.ok(prompt.includes('【C】还有并发写冲突'));
  assert.ok(!prompt.includes('【B】'), '空发言不应出现在历史里');
  assert.ok(prompt.includes('你的发言'));
});

test('讨论 prompt：无历史时不含"此前发言"', () => {
  const { buildDiscussionPrompt } = require('./chat-multi.js');
  const prompt = buildDiscussionPrompt({ question: 'Q', spoken: [] });
  assert.ok(prompt.includes('问题：Q'));
  assert.ok(!prompt.includes('此前发言'));
});

test('讨论 prompt：空问题抛错', () => {
  const { buildDiscussionPrompt } = require('./chat-multi.js');
  assert.throws(() => buildDiscussionPrompt({ question: '  ', spoken: [] }), /明确的问题/);
  assert.throws(() => buildDiscussionPrompt({ question: '', spoken: null }), /明确的问题/);
});
