'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { composeMiniPayload } = require('./mini-tasks.cjs');

// Run the actual Electron handler body with isolated providers; never load the app or real records.
const source = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
const start = source.indexOf('async function miniTasksPayload()');
const end = source.indexOf('\n// ----', start);
assert.ok(start >= 0 && end > start);
function controller(probePanel) {
  const context = vm.createContext({
    selectedProject: 'E:/A', miniCache: { at: 0, payload: null }, MINI_CACHE_MS: 2500,
    discoverPanel: async () => ({ state: 'connected', baseUrl: 'http://127.0.0.1' }),
    probePanel, getTasks: async () => ({ tasks: [] }), composeMiniPayload,
  });
  vm.runInContext(source.slice(start, end), context);
  return context;
}
const snapshot = project => ({ state: 'connected', tasks: 1, taskList: [{ id: project, title: project, status: 'running' }] });

test('小窗缓存按项目隔离，切项目不复用上个项目任务', async () => {
  const ctx = controller(async (_base, project) => snapshot(project));
  assert.equal((await ctx.miniTasksPayload()).tasks[0].id, 'E:/A');
  ctx.selectedProject = 'E:/B';
  assert.equal((await ctx.miniTasksPayload()).tasks[0].id, 'E:/B');
});

test('小窗旧项目慢响应不展示也不污染新项目缓存', async () => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const ctx = controller(async (_base, project) => {
    if (project === 'E:/A') { started(); return new Promise(resolve => { release = () => resolve(snapshot(project)); }); }
    return snapshot(project);
  });
  const old = ctx.miniTasksPayload();
  await ready;
  ctx.selectedProject = 'E:/B';
  assert.equal((await ctx.miniTasksPayload()).tasks[0].id, 'E:/B');
  release();
  assert.equal((await old).tasks.length, 0);
  assert.equal((await ctx.miniTasksPayload()).tasks[0].id, 'E:/B');
});
