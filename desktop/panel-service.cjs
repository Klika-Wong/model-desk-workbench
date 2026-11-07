'use strict';

// 桌面壳自己拉起面板服务的定位逻辑（纯函数，便于测试；spawn 由 main.cjs 负责）。
// 出现背景：桌面上有两个入口时，用户只开"体验版"会因为没有服务而整个不可用。

const DEFAULT_PORT = 18765;

// 候选工作台根目录：环境变量优先，其次按常见相对位置猜。
function workbenchCandidates(appDir, env = {}) {
  const list = [];
  if (env.MODEL_DESK_WORKBENCH_ROOT) list.push(env.MODEL_DESK_WORKBENCH_ROOT);
  const path = require('node:path');
  list.push(path.resolve(appDir, '..', '..', 'multi-agent-collaboration-main'));
  list.push(path.resolve(appDir, '..', 'multi-agent-collaboration-main'));
  return [...new Set(list)];
}

// 从 panel-runtime.json 里取出实际端口；不是本机回环就一律不信。
function portFromRuntime(jsonText, fallback = DEFAULT_PORT) {
  try {
    const record = JSON.parse(jsonText);
    if (!record || typeof record.url !== 'string') return fallback;
    const url = new URL(record.url);
    if (url.hostname !== '127.0.0.1') return fallback;
    const port = Number(url.port);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
  } catch {
    return fallback;
  }
}

// 找第一个真正存在 python 与 start_panel.py 的根目录。
function pickWorkbenchRoot(candidates, exists = () => false, path = require('node:path')) {
  for (const root of candidates) {
    try {
      if (exists(path.join(root, '.local-worker', 'start_panel.py')) &&
          exists(path.join(root, '.local-worker', 'venv', 'Scripts', 'python.exe'))) return root;
    } catch {}
  }
  return null;
}

// 启动决策与生命周期：依赖全部注入，方便在测试里跑真实的成功/失败/超时路径。
// 返回 { started, reason, ... }；reason 取值固定，便于界面与测试断言。
function createPanelStarter({
  discover,
  portListening,
  spawnProcess,
  readRuntime = () => null,
  findRoot,
  defaultPort = DEFAULT_PORT,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollMs = 50,
  timeoutMs = 20000,
  defaultGapMs = 60000,
} = {}) {
  let attemptAt = 0;
  let inFlight = null;
  let child = null;
  let lastError = '';

  async function ensure({ minGapMs = defaultGapMs } = {}) {
    if (inFlight) return inFlight;
    if (now() - attemptAt < minGapMs) return { started: false, reason: 'cooldown' };
    attemptAt = now();
    inFlight = (async () => {
      const running = await Promise.resolve().then(() => discover()).catch(() => ({ state: 'unreachable' }));
      if (running && running.state === 'connected') return { started: false, reason: 'already-running', baseUrl: running.baseUrl };
      const root = findRoot ? findRoot() : null;
      if (!root) return { started: false, reason: 'workbench-not-found' };
      let port = defaultPort;
      try {
        const text = readRuntime();
        if (text) port = portFromRuntime(text, port);
      } catch {}
      // start_panel.py 不查重复，端口在监听就不能再启一个。
      if (await portListening(port)) return { started: false, reason: 'port-busy', port, root };
      let spawned;
      try {
        spawned = spawnProcess(root, port);
      } catch (error) {
        lastError = error.message;
        return { started: false, reason: 'spawn-failed', error: error.message };
      }
      child = spawned;
      const deadline = now() + timeoutMs;
      while (now() < deadline) {
        await sleep(pollMs);
        const probe = await Promise.resolve().then(() => discover()).catch(() => null);
        if (probe && probe.state === 'connected') return { started: true, baseUrl: probe.baseUrl, port, root };
      }
      // 超时要收回子进程，否则每次冷却后重试都会多堆一个。
      try { if (spawned && typeof spawned.kill === 'function') spawned.kill(); } catch {}
      if (child === spawned) child = null;
      return { started: false, reason: 'timeout', port, root, error: lastError };
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  function stop() {
    const current = child;
    child = null;
    if (!current) return false;
    try { if (current.exitCode === null) current.kill(); } catch {}
    return true;
  }

  return { ensure, stop, child: () => child };
}

module.exports = { workbenchCandidates, portFromRuntime, pickWorkbenchRoot, createPanelStarter, DEFAULT_PORT };
