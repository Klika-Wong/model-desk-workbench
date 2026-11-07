'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { workbenchCandidates, portFromRuntime, pickWorkbenchRoot, DEFAULT_PORT } = require('./panel-service.cjs');

test('工作台根目录候选：环境变量优先，且去重', () => {
  const appDir = 'E:\\A\\desktop-shell-prototype';
  const list = workbenchCandidates(appDir, { MODEL_DESK_WORKBENCH_ROOT: 'D:\\custom\\wb' });
  assert.equal(list[0], 'D:\\custom\\wb');
  assert.ok(list.includes(path.resolve(appDir, '..', '..', 'multi-agent-collaboration-main')));
  assert.equal(new Set(list).size, list.length, '不应有重复项');
});

test('端口只认本机回环，其他一律回落到默认值', () => {
  assert.equal(portFromRuntime('{"url":"http://127.0.0.1:18765"}'), 18765);
  assert.equal(portFromRuntime('{"url":"http://127.0.0.1:9000"}'), 9000);
  assert.equal(portFromRuntime('{"url":"http://example.com:18765"}'), DEFAULT_PORT, '外部主机不采信');
  assert.equal(portFromRuntime('{"url":"http://127.0.0.1"}'), DEFAULT_PORT, '没有端口用默认');
  assert.equal(portFromRuntime('not json'), DEFAULT_PORT);
  assert.equal(portFromRuntime('{"url":"http://127.0.0.1:99999"}'), DEFAULT_PORT, '越界端口不采信');
});

test('只有 python 与 start_panel.py 都在才算可用根目录', () => {
  const path2 = require('node:path');
  const present = new Set([
    path2.join('E:\\wb', '.local-worker', 'start_panel.py'),
    path2.join('E:\\wb', '.local-worker', 'venv', 'Scripts', 'python.exe'),
  ]);
  const exists = (p) => present.has(p);
  assert.equal(pickWorkbenchRoot(['E:\\nope', 'E:\\wb'], exists), 'E:\\wb');
  assert.equal(pickWorkbenchRoot(['E:\\nope'], exists), null);
  assert.equal(pickWorkbenchRoot([], exists), null);
});

test('缺少 python 的目录不会被选中（避免启动到一半失败）', () => {
  const path2 = require('node:path');
  const exists = (p) => p.endsWith('start_panel.py');
  assert.equal(pickWorkbenchRoot(['E:\\wb'], exists), null);
});

// ---- createPanelStarter：四条路径全部跑真实分支 ----
const { createPanelStarter } = require('./panel-service.cjs');

function starter(overrides = {}) {
  const calls = { spawn: [], kill: 0, discover: 0 };
  const deps = {
    discover: async () => ({ state: 'unreachable' }),
    portListening: async () => false,
    findRoot: () => 'E://wb',
    spawnProcess: (root, port) => {
      calls.spawn.push({ root, port });
      return { exitCode: null, kill: () => { calls.kill += 1; } };
    },
    readRuntime: () => '{"url":"http://127.0.0.1:18765"}',
    sleep: async () => {},
    pollMs: 1,
    timeoutMs: 10,
    now: () => Date.now(),
    ...overrides,
  };
  return { api: createPanelStarter(deps), calls, deps };
}

test('面板已在运行：不启动任何进程', async () => {
  const { api, calls } = starter({ discover: async () => ({ state: 'connected', baseUrl: 'http://127.0.0.1:18765' }) });
  const result = await api.ensure();
  assert.equal(result.reason, 'already-running');
  assert.equal(calls.spawn.length, 0);
  assert.equal(calls.kill, 0);
});

test('端口已在监听：不重复启动第二个实例', async () => {
  const { api, calls } = starter({ portListening: async () => true });
  const result = await api.ensure();
  assert.equal(result.reason, 'port-busy');
  assert.equal(calls.spawn.length, 0);
});

test('找不到工作台目录：不猜路径，什么都不做', async () => {
  const { api, calls } = starter({ findRoot: () => null });
  assert.equal((await api.ensure()).reason, 'workbench-not-found');
  assert.equal(calls.spawn.length, 0);
});

test('启动成功：按 runtime 记录的端口拉起，最后报告 started', async () => {
  let connected = false;
  const { api, calls } = starter({
    discover: async () => (connected ? { state: 'connected', baseUrl: 'http://127.0.0.1:18765' } : { state: 'unreachable' }),
    spawnProcess: (root, port) => { calls.spawn.push({ root, port }); connected = true; return { exitCode: null, kill: () => { calls.kill += 1; } }; },
    sleep: async () => {},
  });
  const result = await api.ensure();
  assert.equal(result.started, true);
  assert.equal(result.port, 18765);
  assert.deepEqual(calls.spawn, [{ root: 'E://wb', port: 18765 }]);
  assert.equal(calls.kill, 0);
});

test('启动超时：收回子进程并如实报 timeout', async () => {
  const { api, calls } = starter({ timeoutMs: 0 });
  const result = await api.ensure();
  assert.equal(result.started, false);
  assert.equal(result.reason, 'timeout');
  assert.equal(calls.spawn.length, 1);
  assert.equal(calls.kill, 1, '超时必须 kill，否则每次重试都堆一个进程');
  assert.equal(api.child(), null);
});

test('spawn 抛错：报告 spawn-failed，不留下空引用', async () => {
  const { api, calls } = starter({ spawnProcess: () => { throw new Error('python 缺失'); } });
  const result = await api.ensure();
  assert.equal(result.reason, 'spawn-failed');
  assert.match(result.error, /python/);
  assert.equal(api.child(), null);
});

test('冷却期内不重复尝试；stop() 只结束自己拉起的进程', async () => {
  let connected = false;
  const { api, calls } = starter({
    discover: async () => (connected ? { state: 'connected' } : { state: 'unreachable' }),
    spawnProcess: (root, port) => { calls.spawn.push({ root, port }); connected = true; return { exitCode: null, kill: () => { calls.kill += 1; } }; },
    sleep: async () => {},
  });
  await api.ensure();
  const second = await api.ensure();
  assert.equal(second.reason, 'cooldown');
  assert.equal(calls.spawn.length, 1, '冷却期不得再启动');
  assert.equal(api.stop(), true);
  assert.equal(calls.kill, 1);
  assert.equal(api.stop(), false, '没有子进程时 stop 返回 false');
});
