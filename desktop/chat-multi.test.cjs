'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pickModels, createBranch, applyStatus, summarize, isSettled, MAX_BRANCHES, WAITING,
  WAIT_TIMEOUT_MS, markWaitTimeout, groupCancelMessage,
} = require('./chat-multi.js');

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

test('等待超时：未到终态的分支收敛为失败，且不抹掉已拿到的正文', () => {
  const branch = createBranch(models[0], 0);
  applyStatus(branch, { state: 'running', answer: '已经输出了一半' });
  const out = markWaitTimeout(branch);
  assert.equal(out.status, 'failed');
  assert.equal(out.answer, '已经输出了一半');
  assert.match(out.error, /等待超过 3 分钟仍未拿到终态/);
  assert.match(out.error, /任务可能还在执行/);
  assert.ok(!/执行失败|模型报错|超时失败/.test(out.error), '不能编造任务失败原因');
  assert.equal(isSettled(out), true, '超时后必须让 Promise.all 收敛');
});

test('等待超时：已经结束的分支不被改写，空输入不抛错', () => {
  const done = createBranch(models[0], 0);
  applyStatus(done, { state: 'completed', answer: '完整回答' });
  markWaitTimeout(done);
  assert.equal(done.status, 'done');
  assert.equal(done.error, '');
  const failed = createBranch(models[1], 1);
  applyStatus(failed, { state: 'failed', error: '原来的失败原因' });
  markWaitTimeout(failed);
  assert.equal(failed.error, '原来的失败原因');
  assert.equal(markWaitTimeout(null), null);
});

test('等待上限与协作视图的兜底一致，是本地等待而非模型时限', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  assert.equal(WAIT_TIMEOUT_MS, 180000);
  const stage = fs.readFileSync(path.join(__dirname, 'stage-ui.js'), 'utf8');
  assert.match(stage, /setTimeout\(\(\) => \{ onState\('failed'\); finish\(null\); \}, 180000\)/,
    '协作视图的 3 分钟兜底应与聊天页共用同一个量级');
  assert.equal(markWaitTimeout(createBranch(models[0], 0), 60000).error.includes('1 分钟'), true);
});

test('停止一组任务：确认数与未确认数照实报，没有任务时说明没派发', () => {
  const all = groupCancelMessage({ ok: 2, failed: 0, total: 2 });
  assert.match(all, /2 个任务发出停止请求/);
  assert.match(all, /全部确认/);
  const some = groupCancelMessage({ ok: 1, failed: 1, total: 2 });
  assert.match(some, /1 个确认、1 个未确认/);
  assert.match(some, /本地等待已停止/);
  const none = groupCancelMessage({ total: 0 });
  assert.match(none, /还没有派发出去的任务/);
  assert.ok(!/已停止全部|成功取消/.test(all + some + none), '不能把发出请求说成任务已停止');
});

test('排队状态映射成分支 queued，不再一律画成生成中', () => {
  for (const state of WAITING) {
    const branch = applyStatus(createBranch(models[0], 0), { state });
    assert.equal(branch.status, 'queued', `${state} 应显示为排队中`);
    assert.equal(isSettled(branch), false);
  }
  const running = applyStatus(createBranch(models[0], 0), { state: 'running' });
  assert.equal(running.status, 'running', '真正开跑仍显示生成中');
  assert.equal(WAITING.size, 3);
});

test('排队位次每次跟随最新快照，终态与超时都要清掉', () => {
  const branch = createBranch(models[0], 0);
  assert.equal(branch.queue, null, '初始不带任何位次');
  const queue = { position: 2, ahead: 1, order: 'created_at' };
  applyStatus(branch, { state: 'queued', queue });
  assert.deepEqual(branch.queue, queue);
  applyStatus(branch, { state: 'running', queue: null });
  assert.equal(branch.queue, null, '过期位次不能留着');
  applyStatus(branch, { state: 'queued', queue });
  applyStatus(branch, { state: 'completed', answer: 'ok' });
  assert.equal(branch.queue, null, '完成后不能还写排队');
  const timedOut = createBranch(models[1], 1);
  applyStatus(timedOut, { state: 'queued', queue });
  markWaitTimeout(timedOut);
  assert.equal(timedOut.queue, null, '超时后不能还写排队');
});
