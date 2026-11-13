'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTaskRequest, dispatchTask, parsePort, projectHeader } = require('./task-dispatch.cjs');

const BT = String.fromCharCode(92);
const PROJECT = `E:${BT}fixture-workspace`;

test('请求体按面板约定生成，默认走手动路由与模型默认执行器', () => {
  const body = buildTaskRequest({ prompt: '回答 2+2', modelId: '5b0f8b9318c0', title: '连通性', project: PROJECT });
  assert.equal(body.model_id, '5b0f8b9318c0');
  assert.equal(body.route_mode, 'manual');
  assert.equal(body.kind, 'chat');
  assert.equal(body.prompt, '回答 2+2');
  assert.equal(body.project, PROJECT);
  assert.deepEqual(body.files, []);
  assert.equal(body.request_output_tokens, null, '原生模型不能塞假的输出上限');
  assert.equal('engine' in body, false, '不指定执行器，交给模型默认');
  assert.equal(body.routing.category, 'other');
  assert.equal(body.routing.complexity, 'simple');
  for (const field of ['input_tokens', 'output_tokens', 'expected_calls']) {
    assert.equal(Object.hasOwn(body.routing, field), false, '不能用占位覆盖服务端估计');
  }
});

test('类别与复杂度必须是面板认可的枚举值', () => {
  const ok = buildTaskRequest({ prompt: 'ok', modelId: 'm', category: 'analysis', complexity: 'complex' });
  assert.equal(ok.routing.category, 'analysis');
  assert.equal(ok.routing.complexity, 'complex');
  assert.throws(() => buildTaskRequest({ prompt: 'ok', modelId: 'm', category: 'chat' }), /类别无效/);
  assert.throws(() => buildTaskRequest({ prompt: 'ok', modelId: 'm', complexity: 'low' }), /复杂度无效/);
});

test('非法输入一律拒绝，不做“尽量发出去”', () => {
  assert.throws(() => buildTaskRequest({ prompt: '   ', modelId: 'm' }), /不能为空/);
  assert.throws(() => buildTaskRequest({ prompt: 'x'.repeat(50001), modelId: 'm' }), /最多/);
  assert.throws(() => buildTaskRequest({ prompt: 'ok', modelId: '' }), /model_id/);
  assert.throws(() => buildTaskRequest({ prompt: 'ok', modelId: 'm', kind: 'shell' }), /chat 或 edit/);
  assert.throws(() => buildTaskRequest({ prompt: 'ok', modelId: 'm', project: 'relative/path' }), /绝对目录/);
});

test('总任务时限默认不限（0），只有显式正数才启用', () => {
  const mk = (timeout) => buildTaskRequest({ prompt: 'ok', modelId: 'm', ...(timeout === undefined ? {} : { timeout }) });
  assert.equal(mk(undefined).timeout, 0, '省略时不能偷偷变成 180');
  assert.equal(mk(0).timeout, 0, '显式 0 必须保持 0');
  assert.equal(mk('0').timeout, 0);
  assert.equal(mk(180).timeout, 180);
  assert.equal(mk(0.5).timeout, 0.5);
  assert.equal(mk('180').timeout, 180);
  assert.equal(mk(' 42 ').timeout, 42);
  assert.equal(mk('007').timeout, 7);
});

test('总任务时限的非法值一律抛错，不静默回退也不改预算', () => {
  const bad = [-1, -0.5, NaN, Infinity, -Infinity, '', '   ', 'abc', '-5', '1e3', null, true, false, [], {}, [180], { value: 180 }];
  for (const value of bad) {
    assert.throws(
      () => buildTaskRequest({ prompt: 'ok', modelId: 'm', timeout: value }),
      /任务时限/,
      `timeout=${JSON.stringify(value)} 应被拒绝`,
    );
  }
});

test('dry-run 不联网、不打印令牌', async () => {
  const body = buildTaskRequest({ prompt: '回答 2+2', modelId: '5b0f8b9318c0', project: PROJECT });
  const preview = await dispatchTask({ payload: body, dryRun: true });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.method, 'POST');
  assert.match(preview.url, /\/api\/tasks$/);
  assert.match(preview.headers['X-Panel-Token'], /不打印/);
  assert.equal(JSON.stringify(preview).includes('test-only'), false);
  assert.deepEqual(preview.body, body);
});

test('只接受本机回环地址，项目头是可解码的 base64url 且保留填充', () => {
  assert.equal(parsePort('http://127.0.0.1:18765'), 18765);
  assert.throws(() => parsePort('http://10.0.0.5:18765'), /本机/);
  assert.throws(() => parsePort('https://127.0.0.1:18765'), /本机/);

  const decode = (value) => {
    assert.equal(/^[A-Za-z0-9_-]+=*$/.test(value), true, '不允许出现 + / 字符');
    assert.equal(value.length % 4, 0, '面板要求长度补齐到 4 的倍数，否则报 Incorrect padding');
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  };
  assert.deepEqual(decode(projectHeader(PROJECT)), { mode: 'project', project: PROJECT });
  assert.deepEqual(decode(projectHeader('')), { mode: 'unbound', project: null });
});

test('从任务日志事件流里取出真正的回答，不把 JSON 事件当内容', () => {
  const { extractAnswer } = require('./task-dispatch.cjs');
  const log = [
    '{"type": "session", "session_key": "desk-1"}',
    '',
    '2+2等于4。',
    '4',
    '{"type": "status", "text": "usage updated"}',
    '{"type": "result", "result": {"status": "completed"}}',
  ].join('\n');
  assert.equal(extractAnswer(log), '2+2等于4。\n4');
  assert.equal(extractAnswer(''), '');
  assert.equal(extractAnswer('{"type":"x"}\n{"type":"y"}'), '', '全是事件时不能编造内容');
});

test('识别执行器非零退出码，不把失败当成功', () => {
  const { exitCodeFailure } = require('./task-dispatch.cjs');
  assert.equal(exitCodeFailure('*exit code: 1*'), 1);
  assert.equal(exitCodeFailure('前置说明\n*exit code: 137*\n'), 137);
  assert.equal(exitCodeFailure('*exit code: 0*'), null, '0 不算失败');
  assert.equal(exitCodeFailure('2+2等于4。'), null);
  assert.equal(exitCodeFailure(''), null);
  assert.equal(exitCodeFailure('结果是 *exit code: 1* 吗'), null, '正文里引用退出码不算失败');
});

test('排队位次按创建时间算，不被同一秒的随机 id 后缀带偏', () => {
  const { queuePosition } = require('./task-dispatch.cjs');
  // 三个任务在同一秒创建，id 字典序是 z < a < m，与真实入队顺序相反。
  const tasks = [
    { id: '20261027-222022-zzz', status: 'queued', created_at: '2026-10-27T22:20:22.900Z' },
    { id: '20261027-222022-aaa', status: 'queued', created_at: '2026-10-27T22:20:22.100Z' },
    { id: '20261027-222022-mmm', status: 'queued', created_at: '2026-10-27T22:20:22.500Z' },
  ];
  assert.deepEqual(queuePosition(tasks, '20261027-222022-aaa'), { position: 1, ahead: 0, order: 'created_at' });
  assert.deepEqual(queuePosition(tasks, '20261027-222022-mmm'), { position: 2, ahead: 1, order: 'created_at' });
  assert.deepEqual(queuePosition(tasks, '20261027-222022-zzz'), { position: 3, ahead: 2, order: 'created_at' });
});

test('创建时间相同时按面板列表原顺序，不按 id 字典序', () => {
  const { queuePosition } = require('./task-dispatch.cjs');
  const at = '2026-10-27T22:20:22.000Z';
  const tasks = [
    { id: 'b', status: 'queued', created_at: at },
    { id: 'a', status: 'queued', created_at: at },
  ];
  assert.deepEqual(queuePosition(tasks, 'b'), { position: 1, ahead: 0, order: 'created_at' });
  assert.deepEqual(queuePosition(tasks, 'a'), { position: 2, ahead: 1, order: 'created_at' });
});

test('没有可解析创建时间时按列表原顺序，并标记为推断', () => {
  const { queuePosition } = require('./task-dispatch.cjs');
  const tasks = [
    { id: 'z', status: 'queued' },
    { id: 'a', status: 'dispatching' },
    { id: 'm', status: 'pending' },
  ];
  assert.deepEqual(queuePosition(tasks, 'z'), { position: 1, ahead: 0, order: 'list' });
  assert.deepEqual(queuePosition(tasks, 'm'), { position: 3, ahead: 2, order: 'list' });
  // 只要有一个排队任务缺时间，就不冒充精确位次。
  const mixed = [
    { id: 'z', status: 'queued', created_at: '2026-10-27T22:20:22.900Z' },
    { id: 'a', status: 'queued' },
  ];
  assert.equal(queuePosition(mixed, 'a').order, 'list');
  assert.equal(queuePosition(mixed, 'z').order, 'list');
  assert.equal(queuePosition([{ id: 'x', status: 'queued', created_at: 'not-a-date' }], 'x').order, 'list');
});

test('已开跑、不存在或非数组时不报排队位次', () => {
  const { queuePosition } = require('./task-dispatch.cjs');
  const tasks = [
    { id: 'run', status: 'running', created_at: '2026-10-27T22:20:22.000Z' },
    { id: 'wait', status: 'queued', created_at: '2026-10-27T22:20:23.000Z' },
  ];
  assert.equal(queuePosition(tasks, 'run'), null, '已在执行就不报位次');
  assert.deepEqual(queuePosition(tasks, 'wait'), { position: 1, ahead: 0, order: 'created_at' });
  assert.equal(queuePosition(tasks, 'not-exist'), null);
  assert.equal(queuePosition(null, 'x'), null);
  assert.equal(queuePosition([], 'x'), null);
});
