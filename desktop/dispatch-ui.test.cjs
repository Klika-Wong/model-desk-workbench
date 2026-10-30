'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'dispatch-ui.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function harness() {
  const elements = new Map(), timers = new Map(), documentEvents = {}, windowEvents = {};
  let timerId = 0, project = 'E:/fixture-A', queries = 0, sends = 0;
  let answer = async () => ({ ok: true, data: { task: { status: 'running' } } });
  function element() {
    const events = {}, classes = new Set();
    return { events, value: '', checked: false, hidden: false, disabled: false, textContent: '', children: [], dataset: {},
      classList: { toggle: (name, force) => force ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) },
      addEventListener: (name, fn) => { events[name] = fn; },
      replaceChildren(...children) { this.children = children; this.textContent = ''; },
      append(...children) { this.children.push(...children); },
    };
  }
  const document = { hidden: false, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element, addEventListener(name, fn) { documentEvents[name] = fn; } };
  const workbench = {
    getState: async () => ({ project }),
    dispatchModels: async () => ({ ok: true, data: { models: [{ id: 'fixture-model', name: 'Fixture', local: true }], defaultModel: 'fixture-model' } }),
    dispatchSend: async () => { sends++; return { ok: true, data: { id: 'fixture-task', status: 'queued' } }; },
    dispatchStatus: async () => { queries++; return answer(); },
    dispatchCancel: async () => ({ ok: true }),
    dispatchPreview: async input => ({ ok: true, data: { dryRun: true, body: input } }),
  };
  const window = { workbench, addEventListener(name, fn) { windowEvents[name] = fn; } };
  // Browser UMD: load the same module used by the page, once it exists.
  const stateFile = path.join(__dirname, 'dispatch-state.js');
  if (fs.existsSync(stateFile)) window.DispatchState = require(stateFile);
  const schedule = (fn, _ms) => { const id = ++timerId; timers.set(id, fn); return id; };
  vm.runInNewContext(source, { window, document, setTimeout: schedule, clearTimeout: id => timers.delete(id), setInterval: schedule, clearInterval: id => timers.delete(id) });
  const get = id => document.getElementById(id);
  return { window, get, timers, counts: () => ({ queries, sends }), setAnswer(fn) { answer = fn; },
    async send() { await flush(); get('dispatch-model').value = 'fixture-model'; get('dispatch-prompt').value = 'fixture prompt'; get('dispatch-consent').checked = true; await get('dispatch-send').events.click(); await flush(); },
    async tick() { const next = timers.entries().next().value; assert.ok(next, '应安排下一次查询'); timers.delete(next[0]); next[1](); await flush(); },
    async visibility(hidden) { document.hidden = hidden; documentEvents.visibilitychange(); await flush(); },
    async project(value) { project = value; if (windowEvents['workbench-project-changed']) windowEvents['workbench-project-changed'](); await flush(); },
  };
}

test('查询失败保留原任务并恢复查询，不重复派发', async () => {
  const h = harness(); let n = 0;
  h.setAnswer(async () => { if (++n === 1) throw Error('temporary disconnect'); return { ok: true, data: { task: { status: 'completed' }, answer: 'done', exitCode: null } }; });
  await h.send();
  assert.equal(h.window.__dispatchUi.state().taskId, 'fixture-task');
  await h.tick();
  assert.equal(h.window.__dispatchUi.state().taskId, null);
  assert.deepEqual(h.counts(), { queries: 2, sends: 1 });
  assert.equal(h.get('dispatch-send').disabled, false);
});

test('隐藏停止读取，重新显示只恢复查询原任务', async () => {
  const h = harness(); await h.send(); await h.visibility(true);
  assert.equal(h.timers.size, 0);
  const before = h.counts().queries;
  await h.visibility(false);
  assert.equal(h.counts().queries, before + 1);
  assert.equal(h.counts().sends, 1);
});

test('慢查询不会叠加，新项目不显示旧项目的迟到结果', async () => {
  const h = harness(); let resolve;
  h.setAnswer(() => new Promise(r => { resolve = r; }));
  await h.send();
  for (const callback of [...h.timers.values()]) callback();
  await flush();
  assert.equal(h.counts().queries, 1, '只允许一个在途查询');
  await h.project('E:/fixture-B');
  resolve({ ok: true, data: { task: { status: 'completed' }, answer: 'OLD PRIVATE RESULT' } });
  await flush();
  assert.equal(h.window.__dispatchUi.state().taskId, null);
  assert.equal(h.get('dispatch-result').hidden, true);
  assert.equal(h.get('dispatch-result').children.length, 0);
  assert.equal(h.get('dispatch-consent').checked, false);
});

test('已验收和取消终态不会被显示为失败', async () => {
  for (const status of ['accepted', 'cancelled']) {
    const h = harness();
    h.setAnswer(async () => ({ ok: true, data: { task: { status, review: { state: 'accepted', acceptance_valid: true } }, answer: 'result', exitCode: null } }));
    await h.send();
    assert.equal(h.get('dispatch-status').classList.contains('is-error'), false);
    assert.doesNotMatch(h.get('dispatch-status').textContent, /失败/);
    assert.equal(h.get('dispatch-send').disabled, false);
  }
});

test('预览先显示模型项目任务，技术详情默认折叠，输入变化撤销旧确认', async () => {
  const h = harness(); await flush();
  h.get('dispatch-model').value = 'fixture-model';
  h.get('dispatch-prompt').value = '测试内容';
  await h.get('dispatch-preview').events.click();
  const lines = h.get('dispatch-preview-body').children;
  assert.match(lines[0].textContent, /模型：fixture-model/);
  assert.match(lines[1].textContent, /fixture-A/);
  assert.match(lines[2].textContent, /测试内容/);
  assert.equal(lines[4].open, undefined, '未设置open，详情默认折叠');
  assert.equal(h.counts().sends, 0);
  h.get('dispatch-consent').checked = true;
  h.get('dispatch-prompt').events.input();
  assert.equal(h.get('dispatch-consent').checked, false);
  assert.equal(h.get('dispatch-preview-body').hidden, true);
  assert.equal(h.get('dispatch-send').disabled, true);
});

test('旧预览响应不得覆盖已修改的输入，也不能在确认失效后发送', async () => {
  const h = harness(); await flush();
  let resolvePreview;
  h.window.workbench.dispatchPreview = input => new Promise(resolve => { resolvePreview = () => resolve({ ok: true, data: { body: input } }); });
  h.get('dispatch-model').value = 'fixture-model';
  h.get('dispatch-prompt').value = 'old prompt';
  const preview = h.get('dispatch-preview').events.click();
  await flush();
  h.get('dispatch-prompt').value = 'new prompt';
  h.get('dispatch-prompt').events.input();
  resolvePreview(); await preview;
  assert.equal(h.get('dispatch-preview-body').hidden, true);
  let resolveState;
  h.window.workbench.getState = () => new Promise(resolve => { resolveState = resolve; });
  h.get('dispatch-consent').checked = true;
  const sending = h.get('dispatch-send').events.click();
  h.get('dispatch-prompt').events.input();
  resolveState({ project: 'E:/fixture-A' });
  await sending;
  assert.equal(h.counts().sends, 0);
});
