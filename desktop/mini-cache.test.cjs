'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { composeMiniPayload } = require('./mini-tasks.cjs');

// Run the actual Electron handler body with isolated providers; never load the app or real records.
const source = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');

// 按大括号配对截出整个函数体。之前用 "\n// ----" 当结束标记，
// 主进程那边注释一改格式测试就断——定位方式本身不该依赖注释写法。
function sliceFunction(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`找不到函数：${marker}`);
  const bodyStart = text.indexOf('{', start);
  if (bodyStart < 0) throw new Error(`函数后面没有代码块：${marker}`);
  let depth = 0;
  let quote = '';
  for (let i = bodyStart; i < text.length; i += 1) {
    const ch = text[i];
    const prev = text[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`函数体没有闭合：${marker}`);
}

const body = sliceFunction(source, 'async function miniTasksPayload()');
assert.ok(body.includes('miniCache'), '截出来的应当是小窗缓存函数');
function controller(probePanel) {
  const context = vm.createContext({
    selectedProject: 'E:/A', miniCache: { at: 0, payload: null }, MINI_CACHE_MS: 2500,
    discoverPanel: async () => ({ state: 'connected', baseUrl: 'http://127.0.0.1' }),
    probePanel, getTasks: async () => ({ tasks: [] }), composeMiniPayload,
  });
  vm.runInContext(body, context);
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
