const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

const SCOPES = ['private', 'project', 'shared'];
const NODE_MIN_BUDGET = 100;
const NODE_MAX_BUDGET = 200000;
const DEFAULT_SPACE = 'default';

function validateNode(n) {
  if (!n || typeof n !== 'object' || Array.isArray(n)) throw Error('节点必须是对象。');
  if (Object.keys(n).some((k) => !['id', 'name', 'scope', 'budget', 'x', 'y'].includes(k))) throw Error('节点包含不支持的字段。');
  if (typeof n.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(n.id)) throw Error('节点编号无效。');
  if (typeof n.name !== 'string' || !n.name.trim() || [...n.name].length > 40) throw Error('节点名称需要 1–40 字符。');
  if (!SCOPES.includes(n.scope)) throw Error('节点可见范围无效。');
  if (!Number.isInteger(n.budget) || n.budget < NODE_MIN_BUDGET || n.budget > NODE_MAX_BUDGET) throw Error('节点预算需要 100–200000 字符。');
  if (typeof n.x !== 'number' || !Number.isFinite(n.x) || typeof n.y !== 'number' || !Number.isFinite(n.y)) throw Error('节点坐标无效。');
}

function validateEdges(edges, ids) {
  if (edges === undefined) return [];
  if (!Array.isArray(edges)) throw Error('连线必须是数组。');
  const seen = new Set();
  for (const e of edges) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw Error('连线必须是对象。');
    if (Object.keys(e).some((k) => !['from', 'to'].includes(k))) throw Error('连线包含不支持的字段。');
    if (!ids.has(e.from) || !ids.has(e.to)) throw Error('连线指向不存在的节点。');
    if (e.from === e.to) throw Error('节点不能连向自身。');
    const key = [e.from, e.to].sort().join('\u0000');
    if (seen.has(key)) throw Error('重复的连线。');
    seen.add(key);
  }
  return edges.map((e) => ({ from: e.from, to: e.to }));
}

// A free graph: nodes carry their own 2D position; edges are an independent
// undirected connection list. There is no parent/child tree constraint.
function validate(graph) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw Error('结构必须是对象。');
  if (Object.keys(graph).some((k) => !['nodes', 'edges'].includes(k))) throw Error('结构包含不支持的字段。');
  const nodes = graph.nodes;
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > 80) throw Error('结构需要 1–80 个节点。');
  const ids = new Set();
  for (const n of nodes) {
    validateNode(n);
    if (ids.has(n.id)) throw Error('节点编号重复。');
    ids.add(n.id);
  }
  const edges = validateEdges(graph.edges, ids);
  return structuredClone({ nodes, edges });
}

function trial(graph) {
  const clean = validate(graph);
  const { nodes, edges } = clean;
  const warnings = [];
  for (const n of nodes) {
    const degree = edges.filter((e) => e.from === n.id || e.to === n.id).length;
    if (degree === 0 && nodes.length > 1) warnings.push({ id: n.id, text: `「${n.name}」没有连线，处于孤立状态。` });
  }
  return { warnings, nodeCount: nodes.length, edgeCount: edges.length, mode: 'local-graph-check', note: '自由画布结构检查：不读正文、不调用模型、不授予实际权限。预算是设计值，不代表已占用容量。' };
}

// The user's original tree, laid out spatially as an example free graph.
function initial() {
  return {
    nodes: [
      { id: 'human', name: '人类专属 · 规则与备忘', scope: 'private', budget: 12000, x: 60, y: 60 },
      { id: 'rules', name: '硬边界与单次授权', scope: 'private', budget: 4000, x: 60, y: 180 },
      { id: 'notes', name: '架构说明与备忘', scope: 'private', budget: 4000, x: 60, y: 300 },
      { id: 'projects', name: '项目记忆', scope: 'project', budget: 24000, x: 340, y: 60 },
      { id: 'goals', name: '目标 · 当前进度', scope: 'project', budget: 8000, x: 340, y: 180 },
      { id: 'decisions', name: '决定 · 依据 · 下一步', scope: 'project', budget: 8000, x: 340, y: 300 },
      { id: 'tools', name: '本地模型 · 调用配置', scope: 'private', budget: 4000, x: 340, y: 420 },
      { id: 'agents', name: 'AI 分区', scope: 'private', budget: 16000, x: 620, y: 60 },
      { id: 'lead', name: '主体 AI · 项目经验', scope: 'private', budget: 8000, x: 620, y: 180 },
      { id: 'worker', name: '执行 AI · 验证日志', scope: 'private', budget: 8000, x: 620, y: 300 },
      { id: 'pool', name: '公共池 · 待脱敏与批准', scope: 'shared', budget: 12000, x: 620, y: 420 },
    ],
    edges: [
      { from: 'human', to: 'rules' }, { from: 'human', to: 'notes' },
      { from: 'projects', to: 'goals' }, { from: 'projects', to: 'decisions' },
      { from: 'projects', to: 'tools' }, { from: 'agents', to: 'lead' },
      { from: 'agents', to: 'worker' }, { from: 'agents', to: 'tools' },
      { from: 'agents', to: 'pool' },
    ],
  };
}

// Convert a legacy tree (nodes with `parent`) into a free graph: keep every
// node, add coordinates by depth, and turn each parent link into an edge.
function treeToGraph(oldNodes) {
  const byId = new Map(oldNodes.map((n) => [n.id, n]));
  const depthCache = new Map();
  function depthOf(n) {
    if (depthCache.has(n.id)) return depthCache.get(n.id);
    let d = 0; let cur = n; const seen = new Set([n.id]);
    while (cur && cur.parent && byId.has(cur.parent) && !seen.has(cur.parent)) { seen.add(cur.parent); cur = byId.get(cur.parent); d += 1; }
    depthCache.set(n.id, d);
    return d;
  }
  const counters = new Map();
  const nodes = oldNodes.map((n) => {
    const d = depthOf(n);
    const i = counters.get(d) || 0; counters.set(d, i + 1);
    return { id: n.id, name: n.name, scope: n.scope, budget: n.budget, x: 60 + d * 260, y: 60 + i * 110 };
  });
  const edges = oldNodes.filter((n) => n.parent && byId.has(n.parent)).map((n) => ({ from: n.parent, to: n.id }));
  return { nodes, edges };
}

class ArchitectureStore {
  constructor(file, options = {}) {
    this.file = file;
    this.legacySpaceId = typeof options.legacySpaceId === 'string' && options.legacySpaceId.trim() ? options.legacySpaceId : DEFAULT_SPACE;
    this.data = { version: 3, spaces: {} };
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed.nodes)) {
        // v1: one global tree.
        const g = treeToGraph(parsed.nodes);
        this.data = { version: 3, spaces: { [this.legacySpaceId]: { revision: parsed.revision, nodes: g.nodes, edges: g.edges, history: [] } } };
        this.#persist(this.data);
      } else if (parsed.spaces && typeof parsed.spaces === 'object') {
        if (parsed.version === 3) {
          for (const s of Object.values(parsed.spaces)) this.#assertSpace(s);
          this.data = parsed;
        } else {
          // v2: per-space trees -> per-space graphs.
          const spaces = {};
          for (const [sid, s] of Object.entries(parsed.spaces)) {
            const g = treeToGraph(s.nodes);
            spaces[sid] = { revision: s.revision, nodes: g.nodes, edges: g.edges, history: [] };
          }
          this.data = { version: 3, spaces };
          this.#persist(this.data);
        }
      } else {
        throw Error('架构文件损坏，未重置。');
      }
    }
  }

  #assertSpace(s) {
    if (!s || !Number.isInteger(s.revision) || !Array.isArray(s.history)) throw Error('架构文件损坏，未重置。');
    validate({ nodes: s.nodes, edges: s.edges });
    for (const h of s.history) validate({ nodes: h.nodes, edges: h.edges });
  }

  #empty() {
    const g = initial();
    return { revision: 0, nodes: g.nodes, edges: g.edges, history: [] };
  }

  #ensure(spaceId) {
    if (typeof spaceId !== 'string' || spaceId.trim() === '') throw Error('需要有效的记忆空间 id。');
  }

  snapshot(spaceId = DEFAULT_SPACE) {
    this.#ensure(spaceId);
    return structuredClone(this.data.spaces[spaceId] || this.#empty());
  }

  save(spaceId, graph, revision) {
    this.#ensure(spaceId);
    const clean = validate(graph);
    const current = this.data.spaces[spaceId] || this.#empty();
    if (revision !== current.revision) throw Error('架构已变化，请重新载入后再编辑。');
    const nextSpace = {
      revision: current.revision + 1,
      nodes: clean.nodes,
      edges: clean.edges,
      history: [...current.history, { revision: current.revision, nodes: current.nodes, edges: current.edges }].slice(-10),
    };
    const next = { version: 3, spaces: { ...this.data.spaces, [spaceId]: nextSpace } };
    this.#persist(next);
    this.data = next;
    return this.snapshot(spaceId);
  }

  #persist(data) {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temp, this.file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
}

module.exports = { ArchitectureStore, validate, trial, initial };
