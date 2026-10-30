// 仅用于本地验证：桩掉 workbench 接口，不连任何面板、不读任何任务。
const { contextBridge } = require('electron');
const calls = [];
let sendOk = false;
let statusCalls = 0;
let logCalls = 0;
let selectedProject = 'E:\\model-desk-fixture';
let panelFixture = false;
let holdNextPanel = false;
let heldPanelReply = null;
function panelStatus() {
  if (!panelFixture) return Promise.resolve({ ok: false, error: '验证模式：未连接面板' });
  const reply = { ok: true, data: { state: 'connected', project: selectedProject, tasks: 1, executors: [], taskList: [{ id: selectedProject, title: selectedProject, project: selectedProject, status: 'running' }],
    overview: {models: [
      {id: 'm-local', name: '本地示例模型', local: true, providerLabel: '本地模型', executorLabel: 'DeepSeek Harness', enabled: true, executorReady: true, checkLabel: '上次调用成功', capability: '短文本分类；能力边界待实测'},
      {id: 'm-cloud', name: '云端示例模型', local: false, providerLabel: 'WorkBuddy', executorLabel: 'WorkBuddy', enabled: true, executorReady: false, checkLabel: '尚无调用验证'},
    ], accounts: [
      {id: 'codex', label: 'Codex / ChatGPT', stateLabel: '上次数据 · 待更新', detail: '账户额度跨项目共享', windows: [{label: '5 小时', remaining: 0}, {label: '每周', remaining: null}]},
      {id: 'workbuddy', label: 'WorkBuddy', stateLabel: '额度未接入', detail: '连接状态不代表剩余额度', windows: []},
      {id: 'local', label: '本地模型', stateLabel: '不适用云端额度', detail: '仍会使用 CPU、GPU 和内存', windows: []},
    ]},
  } };
  if (!holdNextPanel) return Promise.resolve(reply);
  holdNextPanel = false;
  return new Promise(resolve => { heldPanelReply = () => { resolve(reply); heldPanelReply = null; }; });
}

const snapshot = {
  revision: 1,
  spaces: [{
    id: 'space-demo',
    name: '示例项目空间',
    kind: 'project',
    capacityChars: 12000,
    contextChars: 2000,
    sections: ['当前进度'],
    entries: [{
      id: 'e-1', title: '示例记忆标题', body: '这是记忆原文正文，用于验证点击查看。',
      source: '手写录入', section: '当前进度', status: 'published', version: 3,
      createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z',
    }],
  }],
};

contextBridge.exposeInMainWorld('workbench', {
  getState: async () => ({ health: 'healthy', project: selectedProject, workspace: 'desktop-shell-prototype' }),
  chooseProject: async () => ({ health: 'healthy', project: selectedProject, workspace: 'desktop-shell-prototype' }),
  getTasks: async () => ({ tasks: [] }),
  startDemoTasks: async () => ({ tasks: [] }),
  cancelDemoTask: async () => ({ tasks: [] }),
  memorySnapshot: async () => ({ ok: true, data: snapshot }),
  memoryExecute: async () => ({ ok: true, data: snapshot }),
  memoryExport: async () => ({ ok: true, data: { text: '{}' } }),
  memoryPrepare: async () => ({ ok: true, data: { packet: {} } }),
  memoryApplyProposal: async () => ({ ok: true, data: snapshot }),
  memoryPacket: async () => ({ ok: true, data: { text: '【记忆】示例', matched: 1, usedChars: 40, budgetChars: 2000,
    items: [{ id: 'e-1', title: '示例记忆标题', version: 3, source: '手写录入', excerpt: '这是记忆原文正文……' }] } }),
  memoryGrantSend: async () => ({ ok: true, data: { token: 'stub' } }),
  memoryCopyPacket: async () => ({ ok: true, data: {} }),
  architectureRead: async () => ({ ok: true, data: { nodes: [], edges: [], revision: 1, history: [] } }),
  architectureTrial: async () => ({ ok: true, data: { issues: [], summary: '结构检查通过' } }),
  architectureSave: async () => ({ ok: true, data: {} }),
  architectureCopy: async () => ({ ok: true, data: {} }),
  performanceSample: async () => ({ ok: true, data: {} }),
  appearanceApply: async () => ({ ok: true, data: {} }),
  openMini: async () => ({ ok: true }),
  panelStatus,
  panelStatusAll: async () => ({ ok: false, error: '验证模式：未连接面板' }),
  panelOpen: async () => ({ ok: false, error: '验证模式：未连接面板' }),
  panelEmbed: async () => ({ ok: false, error: '验证模式：不嵌入面板' }),
  panelEmbedHide: async () => ({ ok: true }),
  panelEmbedBounds: async () => ({ ok: true }),
  panelTheme: async () => ({ ok: true }),
  chatLoad: async () => ({ ok: true, data: { messages: [{ role: 'user', text: '上次的第一句' }], dropped: 0, corrupted: false } }),
  chatSave: async (messages) => { calls.push({ api: 'chatSave', input: messages }); return { ok: true, data: { saved: (messages || []).length } }; },
  chatClear: async () => { calls.push({ api: 'chatClear' }); return { ok: true, data: { cleared: true } }; },
  dispatchModels: async () => ({ ok: true, data: { baseUrl: 'http://127.0.0.1:18765', defaultModel: 'm-local', models: [{ id: 'm-local', name: '本地示例模型', provider: 'local', local: true }] } }),
  dispatchPreview: async (input) => { calls.push({ api: 'dispatchPreview', input }); return { ok: true, data: { dryRun: true, url: 'http://127.0.0.1:18765/api/tasks', body: input } }; },
  dispatchSend: async (input) => {
    calls.push({ api: 'dispatchSend', input });
    if (!sendOk) return { ok: false, error: '验证模式：不真的发送' };
    statusCalls = 0;
    return { ok: true, data: { id: 'task-1', status: 'queued' } };
  },
  dispatchStatus: async () => {
    if (!sendOk) return { ok: false, error: '验证模式：没有任务' };
    statusCalls += 1;
    if (statusCalls === 1) {
      return { ok: true, data: { task: { id: 'task-1', status: 'running', usage: null }, answer: '正在输出第一段', queue: null, exitCode: null } };
    }
    return { ok: true, data: { task: { id: 'task-1', status: 'completed', model_name: '本地示例模型', usage: { total_tokens: 42 } }, answer: '正在输出第一段，最终回答', queue: null, exitCode: null } };
  },
  dispatchLog: async () => {
    if (!sendOk) return { ok: false, error: '验证模式：没有任务' };
    logCalls += 1;
    return { ok: true, data: { answer: '正在输出' + '。'.repeat(Math.min(logCalls, 3)), exitCode: null } };
  },
  dispatchCancel: async () => ({ ok: false, error: '验证模式：没有任务' }),
});

contextBridge.exposeInMainWorld('__stubCalls', { all: () => calls.slice(), setSendOk: (value) => { sendOk = value === true; logCalls = 0; },
  logCalls: () => logCalls,
  setProject: value => { selectedProject = value; },
  enablePanelFixture: () => { panelFixture = true; },
  disablePanelFixture: () => { panelFixture = false; },
  holdNextPanel: () => { holdNextPanel = true; },
  hasHeldPanel: () => Boolean(heldPanelReply),
  releasePanel: () => { if (heldPanelReply) heldPanelReply(); },
});
