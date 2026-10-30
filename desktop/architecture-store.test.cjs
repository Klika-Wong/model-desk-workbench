'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ArchitectureStore, validate, trial, initial } = require('./architecture-store.cjs');

function graph() { return { nodes: structuredClone(initial().nodes), edges: structuredClone(initial().edges) }; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'desk-architecture-')); }

test('自由图校验：未知字段、重复编号、越界预算、坏坐标、悬空连线、自环、重复连线', () => {
  assert.throws(() => validate({ nodes: initial().nodes.map((n) => ({ ...n, command: 'run' })) }), /不支持的字段/);
  const dup = initial().nodes;
  assert.throws(() => validate({ nodes: [...dup, dup[0]] }), /重复/);
  assert.throws(() => validate({ nodes: initial().nodes.map((n, i) => (i === 0 ? { ...n, budget: 50 } : n)) }), /预算/);
  assert.throws(() => validate({ nodes: initial().nodes.map((n, i) => (i === 0 ? { ...n, x: 'left' } : n)) }), /坐标/);
  assert.throws(() => validate({ nodes: initial().nodes, edges: [{ from: 'human', to: 'missing' }] }), /不存在/);
  assert.throws(() => validate({ nodes: initial().nodes, edges: [{ from: 'human', to: 'human' }] }), /自身/);
  assert.throws(() => validate({ nodes: initial().nodes, edges: [{ from: 'human', to: 'rules' }, { from: 'rules', to: 'human' }] }), /重复/);
});

test('试运行给出孤立节点警告且不修改输入', () => {
  const g = { nodes: initial().nodes, edges: [] };
  const before = JSON.stringify(g);
  const r = trial(g);
  assert.equal(r.warnings.length, initial().nodes.length);
  assert.equal(r.edgeCount, 0);
  assert.equal(JSON.stringify(g), before);
});

test('保存坐标与连线、重启恢复、历史恢复与过期版本拒绝', () => {
  const dir = tmp(); const file = path.join(dir, 'tree.json');
  try {
    const store = new ArchitectureStore(file);
    const g = graph();
    g.nodes.find((n) => n.id === 'tools').x = 1024;
    g.nodes.find((n) => n.id === 'tools').y = 768;
    g.edges.push({ from: 'human', to: 'projects' });
    const saved = store.save('project-a', g, 0);
    const reopened = new ArchitectureStore(file).snapshot('project-a');
    assert.equal(reopened.nodes.find((n) => n.id === 'tools').x, 1024);
    assert.ok(reopened.edges.some((e) => e.from === 'human' && e.to === 'projects'));
    assert.throws(() => store.save('project-a', graph(), 0), /变化/);
    store.save('project-a', { nodes: saved.history[0].nodes, edges: saved.history[0].edges }, 1);
    assert.equal(store.snapshot('project-a').nodes.find((n) => n.id === 'tools').x, 340);
    assert.equal(store.snapshot('project-a').revision, 2);
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(dir); }
});

test('节点上限 80 受控', () => {
  const many = Array.from({ length: 81 }, (_, i) => ({ id: 'n' + i, name: 'N', scope: 'private', budget: 100, x: i * 10, y: 0 }));
  assert.throws(() => validate({ nodes: many, edges: [] }), /80/);
});

test('多项目架构按空间隔离，互不影响且同时持久化', () => {
  const dir = tmp(); const file = path.join(dir, 'tree.json');
  try {
    const store = new ArchitectureStore(file);
    const g = graph(); g.nodes.find((n) => n.id === 'tools').x = 999;
    store.save('project-a', g, 0);
    assert.equal(store.snapshot('project-b').revision, 0);
    assert.equal(store.snapshot('project-b').nodes.find((n) => n.id === 'tools').x, 340);
    store.save('project-b', graph(), 0);
    assert.equal(store.snapshot('project-a').revision, 1);
    assert.equal(store.snapshot('project-a').nodes.find((n) => n.id === 'tools').x, 999);
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(disk.version, 3);
    assert.equal(disk.spaces['project-a'].nodes.find((n) => n.id === 'tools').x, 999);
    assert.equal(disk.spaces['project-b'].nodes.find((n) => n.id === 'tools').x, 340);
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(dir); }
});

test('v2 树结构迁移为自由图：parent 转连线、补坐标、版本升到 3', () => {
  const dir = tmp(); const file = path.join(dir, 'tree.json');
  try {
    const legacyNodes = initial().nodes.map((n) => ({ id: n.id, name: n.name, scope: n.scope, budget: n.budget, parent: n.id === 'rules' ? 'human' : null }));
    const v2 = { version: 2, spaces: { 'project-a': { revision: 1, nodes: legacyNodes, history: [] } } };
    fs.writeFileSync(file, JSON.stringify(v2), 'utf8');
    const store = new ArchitectureStore(file, { legacySpaceId: 'project-a' });
    const snapshot = store.snapshot('project-a');
    assert.ok(snapshot.nodes.every((n) => typeof n.x === 'number' && typeof n.y === 'number'));
    assert.ok(snapshot.edges.some((e) => e.from === 'human' && e.to === 'rules'));
    assert.equal(snapshot.revision, 1);
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(disk.version, 3);
    assert.ok(Array.isArray(disk.spaces['project-a'].edges));
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(dir); }
});
