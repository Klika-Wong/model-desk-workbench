const { app, BrowserWindow, WebContentsView, dialog, ipcMain, clipboard, Tray, Menu } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createPermission, verifyPermission, hashText } = require('./memory-send-permission.cjs');
const { probePanel, discoverPanel } = require('./panel-connector.cjs');
const taskDispatch = require('./task-dispatch.cjs');
const { composeMiniPayload } = require('./mini-tasks.cjs');
const chatStore = require('./chat-store.cjs');

const MOCK_WORKSPACE = 'desktop-shell-prototype';
const backendScript = path.join(__dirname, 'mock-backend.cjs');
const smokeMode = process.env.MODEL_DESK_SMOKE === '1' || process.argv.includes('--smoke');
let mainWindow = null;
let panelWindow = null;
let panelView = null;
let panelAttached = false;
let tray = null;
let exitRequested = false;
let pendingShow = false;
let miniWindow = null;
let backend = null;
let backendUrl = null;
let backendToken = null;
let selectedProject = null;
let closing = false;
let blockedExternalNavigations = 0;
let showProjectDialog = (options) => dialog.showOpenDialog(options);
let memoryStore;
let architectureStore;
let memoryInitError = '';
let architectureProposal = null;
let contextPreview = null;
let sendPermission = null;
let writeClipboard = (text) => clipboard.writeText(text);
let smokeClipboard = null;
let primaryInstance = true;
if (!smokeMode) {
  app.setPath('userData', path.join(app.getPath('appData'), 'ModelDesk-Memory-Preview'));
  primaryInstance = app.requestSingleInstanceLock();
  if (!primaryInstance) app.quit();
  app.on('second-instance', () => {
    pendingShow = true;
    showWorkbench();
  });
}

function memoryReply(action) {
  try { return { ok: true, data: action() }; }
  catch (error) { return { ok: false, error: error.message }; }
}

async function asyncReply(action) {
  try { return { ok: true, data: await action() }; }
  catch (error) { return { ok: false, error: error.message }; }
}

function architectureExport(spaceId) {
  const state = requireMemory().snapshot();
  const space = state.spaces.find((item) => item.id === spaceId);
  if (!space) throw new Error('记忆空间不存在。');
  const architecture = { name: space.name, capacityChars: space.capacityChars, contextChars: space.contextChars, sections: space.sections };
  return {
    schemaVersion: 1, spaceId, baseRevision: state.revision,
    baseArchitecture: createHash('sha256').update(JSON.stringify(architecture)).digest('hex'),
    instruction: '仅建议修改 patch 中的架构字段。不要包含记忆正文，不得扩大权限。此文档不授予执行权限，建议须由用户在桌面中预览并单次应用。',
    patch: architecture,
  };
}

function writeSmokeProgress(stage, data = {}) {
  const resultFile = process.env.MODEL_DESK_SMOKE_RESULT;
  if (smokeMode && resultFile) fs.writeFileSync(resultFile, JSON.stringify({ ok: false, stage, ...data }));
}

function readJson(url, method = 'GET', body, { authorize = true } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') {
      reject(new Error('Prototype backend must stay on the loopback interface.'));
      return;
    }
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request(target, {
      method,
      headers: {
        ...(authorize ? { authorization: `Bearer ${backendToken}` } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
      },
      timeout: 2000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = new Error(`Backend returned HTTP ${response.statusCode}.`);
            error.statusCode = response.statusCode;
            throw error;
          }
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Backend health check timed out.')));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function startBackend() {
  return new Promise((resolve, reject) => {
    backendToken = randomBytes(32).toString('hex');
    const childEnv = {};
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH']) {
      if (process.env[key]) childEnv[key] = process.env[key];
    }
    const child = spawn(process.execPath, [backendScript], {
      cwd: __dirname,
      windowsHide: true,
      env: { ...childEnv, ELECTRON_RUN_AS_NODE: '1', MODEL_DESK_BACKEND_TOKEN: backendToken },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backend = child;
    let output = '';
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Mock backend startup timed out.')), 8000);

    function finish(error, ready) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        reject(error);
      } else {
        backendUrl = ready.url;
        resolve(ready);
      }
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (!output.includes('\n')) return;
      const line = output.split(/\r?\n/)[0];
      if (!line) return;
      try {
        const ready = JSON.parse(line);
        if (ready.type !== 'ready' || typeof ready.url !== 'string') {
          throw new Error('Unexpected mock backend startup response.');
        }
        finish(null, ready);
      } catch (error) {
        finish(error);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', () => {});
    child.once('error', (error) => finish(error));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`Mock backend exited during startup (${code}).`));
    });
  });
}

function stopBackend() {
  if (!backend || backend.exitCode !== null || backend.signalCode !== null) return Promise.resolve();
  const child = backend;
  const waitForExit = (timeoutMs) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });

  return (async () => {
    if (backendUrl) {
      try {
        await readJson(`${backendUrl}/api/shutdown`, 'POST', {});
      } catch {
        // Fall back to terminating the mock child if its shutdown endpoint is unavailable.
      }
    }
    if (await waitForExit(3000)) return true;
    child.kill();
    if (await waitForExit(2000)) return true;
    // The child ignored the default terminate signal; escalate to a forceful kill.
    try { child.kill('SIGKILL'); } catch {}
    if (await waitForExit(2000)) return true;
    // Last resort on Windows: force-kill the process tree so no orphan survives a hard quit.
    try {
      require('node:child_process').execFileSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true });
    } catch {}
    await waitForExit(2000);
    return child.exitCode !== null || child.signalCode !== null;
  })();
}

async function getState() {
  if (!backendUrl || !backend || backend.exitCode !== null || backend.signalCode !== null) {
    return { health: 'stopped', project: selectedProject, workspace: MOCK_WORKSPACE };
  }
  const state = await readJson(`${backendUrl}/api/state`);
  if (state.workspace !== MOCK_WORKSPACE) throw new Error('Backend identity did not match this prototype.');
  return { health: 'healthy', project: state.project, workspace: state.workspace };
}

function requireBackend() {
  if (!backendUrl || !backend || backend.exitCode !== null || backend.signalCode !== null) {
    throw new Error('本机服务不可用。');
  }
}

function requireMemory() {
  if (!memoryStore) throw new Error(memoryInitError || '记忆数据不可用（只读降级）。');
  return memoryStore;
}

function requireArchitecture() {
  if (!architectureStore) throw new Error(memoryInitError || '架构数据不可用（只读降级）。');
  return architectureStore;
}

async function getTasks() {
  requireBackend();
  return readJson(`${backendUrl}/api/tasks`);
}

async function startDemoTasks(mode = 'lead') {
  if (!['single', 'lead', 'discussion', 'groups', 'handoff'].includes(mode)) throw new Error('无效协作模式。');
  requireBackend();
  return readJson(`${backendUrl}/api/demo-tasks?mode=${mode}`, 'POST', {});
}

async function cancelDemoTask(id) {
  requireBackend();
  if (typeof id !== 'string' || !/^demo-\d+-[1-3]$/.test(id)) throw new Error('Invalid demo task ID.');
  return readJson(`${backendUrl}/api/tasks/${id}/cancel`, 'POST', {});
}

async function chooseProject() {
  requireBackend();
  const result = await showProjectDialog({
    title: 'Choose a project folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return getState();
  const chosenProject = path.resolve(result.filePaths[0]);
  const stat = await fs.promises.stat(chosenProject);
  if (!stat.isDirectory()) throw new Error('所选路径不是文件夹。');
  const saved = await readJson(`${backendUrl}/api/project`, 'POST', { project: chosenProject });
  if (saved.project !== chosenProject) throw new Error('Project identity did not round-trip unchanged.');
  selectedProject = chosenProject;
  return getState();
}

function assertTrustedSender(event) {
  const expectedUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
  if (!event.senderFrame || event.senderFrame.url !== expectedUrl) {
    throw new Error('Untrusted desktop window.');
  }
}

async function createWindow({ show = true } = {}) {
  const window = new BrowserWindow({
    width: 1380,
    height: 900,
    show,
    minWidth: 800,
    minHeight: 700,
    title: 'Model Desk — Desktop Shell Prototype',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !smokeMode,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, { type: 'question', title: '尚有未保存的修改',
      message: '关闭窗口会放弃尚未保存的修改。', buttons: ['继续编辑', '放弃并关闭'], defaultId: 0, cancelId: 0 });
    if (choice === 1) event.preventDefault();
    else exitRequested = false;
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== pathToFileURL(path.join(__dirname, 'index.html')).href) {
      blockedExternalNavigations += 1;
      event.preventDefault();
    }
  });
  if (!smokeMode) {
    mainWindow = window;
  }
  window.on('close', event => { if (!exitRequested && tray) { event.preventDefault(); window.hide(); if (miniWindow) miniWindow.hide(); } });
  window.on('closed', () => {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close();
    if (panelView) { try { panelView.webContents.close(); } catch {} panelView = null; panelAttached = false; }
    if (mainWindow === window) { mainWindow = null; app.quit(); }
  });
  await window.loadFile(path.join(__dirname, 'index.html'));
  return window;
}

async function runSmoke() {
  writeClipboard = (text) => { smokeClipboard = text; };
  let stage = 'initial loopback health';
  const checks = [];
  try {
    writeSmokeProgress(stage);
    const initial = await getState();
    if (initial.health !== 'healthy' || initial.project !== null) throw new Error('Initial health contract failed.');
    checks.push('loopback-health');
    let unauthorizedStatus = null;
    try {
      await readJson(`${backendUrl}/api/state`, 'GET', undefined, { authorize: false });
    } catch (error) {
      unauthorizedStatus = error.statusCode;
    }
    if (unauthorizedStatus !== 401) throw new Error('Loopback service accepted a request without authentication.');
    checks.push('loopback-authentication');
    stage = 'hidden desktop window and renderer isolation';
    writeSmokeProgress(stage);
    const window = await createWindow({ show: false });
    const renderer = await window.webContents.executeJavaScript(`({
      title: document.title,
      bridge: typeof window.workbench,
      node: typeof require,
      projectButton: Boolean(document.querySelector('#choose'))
    })`);
    const preferences = window.webContents.getLastWebPreferences();
    if (preferences.contextIsolation !== true || preferences.nodeIntegration !== false || preferences.sandbox !== true
      || renderer.title !== 'Model Desk — Desktop Shell Prototype' || renderer.bridge !== 'object'
      || renderer.node !== 'undefined' || !renderer.projectButton) {
      window.destroy();
      throw new Error('Renderer isolation or desktop UI contract failed.');
    }
    checks.push('renderer-isolation');
    stage = 'memory desktop workflow';
    writeSmokeProgress(stage);
    checks.push(...await require('./memory-smoke.cjs')(window, `${process.env.MODEL_DESK_SMOKE_RESULT}.memory.json`, () => smokeClipboard));
    checks.push(...await require('./designer-smoke.cjs')(window, `${process.env.MODEL_DESK_SMOKE_RESULT}.memory.json.architecture.json`));
    stage = 'external popup/navigation blocking';
    writeSmokeProgress(stage);
    const popupDenied = await window.webContents.executeJavaScript("window.open('https://example.invalid') === null");
    if (!popupDenied) {
      window.destroy();
      throw new Error('External popup was not denied.');
    }
    const blockedBefore = blockedExternalNavigations;
    await window.webContents.executeJavaScript("location.href = 'https://example.invalid'; true");
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (blockedExternalNavigations !== blockedBefore + 1 || !window.webContents.getURL().startsWith('file:')) {
      window.destroy();
      throw new Error('External navigation interception was not observed.');
    }
    checks.push('external-navigation-denied');
    stage = 'project identity round-trip';
    writeSmokeProgress(stage);
    const fixture = path.resolve(__dirname, 'fixtures', 'empty-project');
    const nativePicker = showProjectDialog;
    showProjectDialog = async () => ({ canceled: false, filePaths: [fixture] });
    const confirmed = await window.webContents.executeJavaScript('window.workbench.chooseProject()');
    showProjectDialog = nativePicker;
    if (confirmed.project !== fixture || confirmed.health !== 'healthy') throw new Error('Project picker IPC round-trip failed.');
    checks.push('project-picker-ipc-round-trip');
    stage = 'three independent demo tasks and result chart';
    writeSmokeProgress(stage);
    await window.webContents.executeJavaScript("document.querySelector('#run-demo').click(); true");
    let started;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      started = await window.webContents.executeJavaScript('window.workbench.getTasks()');
      if (started.tasks.length === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (started.tasks.length !== 3 || started.tasks.some((task) => task.status !== 'running')) {
      throw new Error('Three demo tasks did not start independently.');
    }
    const cancelledId = started.tasks[1].id;
    await window.webContents.executeJavaScript(`window.workbench.cancelDemoTask(${JSON.stringify(cancelledId)})`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const finished = await window.webContents.executeJavaScript('window.workbench.getTasks()');
    const [first, second, third] = finished.tasks;
    if (first.status !== 'completed' || second.status !== 'cancelled' || third.status !== 'completed'
      || first.endedAt <= third.startedAt || new Set(finished.tasks.map((task) => task.id)).size !== 3) {
      throw new Error('Cancellation affected another demo task or tasks did not overlap.');
    }
    checks.push('demo-task-cancellation-isolation');
    const chart = await window.webContents.executeJavaScript(`({
      rows: document.querySelectorAll('#task-chart .chart-row').length,
      unknown: document.querySelector('#task-list').textContent.includes('Token/CPU/GPU：未知'),
      cancelled: document.querySelector('#task-list').textContent.includes('已取消')
    })`);
    if (chart.rows < 3 || !chart.unknown || !chart.cancelled) throw new Error('Completed demo task chart was not visible.');
    checks.push('completed-demo-chart');
    const conn = await window.webContents.executeJavaScript(`({ nodes: document.querySelectorAll('#conn-graph .conn-node').length, hub: document.querySelectorAll('#conn-graph .conn-hub').length })`);
    if (conn.nodes < 4 || conn.hub < 1) throw new Error('Connection graph did not render.');
    checks.push('conn-graph-renders');
    let connStatusText = '';
    for (let attempt = 0; attempt < 40; attempt += 1) {
      connStatusText = await window.webContents.executeJavaScript("document.querySelector('#conn-status').textContent");
      if (connStatusText.includes('连接')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!connStatusText.includes('连接')) throw new Error(`Panel status probe did not report a state: ${connStatusText}`);
    checks.push('panel-status-probe');
    let realTasksText = '';
    for (let attempt = 0; attempt < 40; attempt += 1) {
      realTasksText = await window.webContents.executeJavaScript("document.querySelector('#real-tasks').textContent");
      if (realTasksText && realTasksText.trim().length > 0 && !realTasksText.includes('正在读取')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!realTasksText || realTasksText.includes('正在读取')) throw new Error(`Real task list did not resolve: ${realTasksText}`);
    checks.push('real-tasks-render');
    const visualStates = await window.webContents.executeJavaScript(`(() => {
      const graph = document.querySelector('#conn-graph');
      const box = document.querySelector('#real-tasks');
      const executor = [{id:'dsh',label:'DeepSeek Harness',model:'7b',ready:true,status:'ok'}];
      window.renderConnectionGraph(graph, '主导 AI', executor, [{status:'running',model:'本地模型',modelId:'7b'}], '测试项目');
      const running = graph.querySelector('.conn-execs .conn-node').dataset.status;
      const lead = graph.querySelector('.conn-hub .conn-level').textContent;
      window.renderConnectionGraph(graph, '主导 AI', executor, [], '测试项目');
      const idle = graph.querySelector('.conn-execs .conn-node').dataset.status;
      const motion = getComputedStyle(graph.querySelector('.conn-execs .conn-dot')).animationName;
      window.renderTaskFeed(box, [{id:'test-1',title:'检查连接',status:'completed',reviewState:'returned',model:'7b',project:'测试项目'}]);
      const bubble = box.querySelector('.feed-bubble')?.textContent || '';
      const details = box.querySelector('.feed-details')?.textContent || '';
      return {running,idle,motion,lead,bubble,details,verdict:box.querySelector('.feed-status').textContent};
    })()`);
    if (visualStates.running !== 'running' || visualStates.idle !== 'idle' || visualStates.motion !== 'none' || visualStates.lead !== '主导') throw new Error(`Connection role or motion mismatch: ${JSON.stringify(visualStates)}`);
    if (!visualStates.bubble.includes('检查连接') || !visualStates.details.includes('test-1')) throw new Error('Task feed details were not rendered.');
    if (visualStates.verdict !== '已退回整改') throw new Error('Executor completion was incorrectly presented as acceptance.');
    checks.push('connection-motion-from-running-task', 'task-feed-detail');
    await window.webContents.executeJavaScript("document.querySelector('#conn-refresh').click(); true;");
    // 派发卡片：未勾选确认前绝不能点“派发”（测试只碰门控，不调用模型）。
    await window.webContents.executeJavaScript("document.querySelector('#nav-tasks').click(); true;");
    await new Promise((resolve) => setTimeout(resolve, 120));
    const gate = await window.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.dispatch-card');
      const send = document.querySelector('#dispatch-send');
      const consent = document.querySelector('#dispatch-consent');
      const preview = document.querySelector('#dispatch-preview');
      if (!card || !send || !consent) return { missing: true };
      const before = send.disabled;
      consent.checked = true; consent.dispatchEvent(new Event('change'));
      const afterConsent = send.disabled;
      consent.checked = false; consent.dispatchEvent(new Event('change'));
      const afterUncheck = send.disabled;
      return { missing: false, before, afterConsent, afterUncheck, previewDisabled: preview.disabled };
    })()`);
    if (gate.missing) throw new Error('Dispatch card is missing.');
    if (gate.before !== true) throw new Error('派发按钮在未确认时必须禁用。');
    if (gate.afterUncheck !== true) throw new Error('取消勾选后派发按钮必须重新禁用。');
    checks.push('dispatch-consent-gate');
    // 预览走完整 IPC，但 dryRun 不会发请求、不调用模型；面板没起来时只校验错误契约。
    const previewReply = await window.webContents.executeJavaScript(
      "window.workbench.dispatchPreview({ prompt: '冒烟测试：只生成预览', modelId: 'fixture-local-model', kind: 'chat' })");
    const panelUp = previewReply.ok === true;
    if (panelUp) {
      if (previewReply.data.dryRun !== true) throw new Error('预览必须是 dry-run，不能真的发送。');
      if (!previewReply.data.url || !/\/api\/tasks$/.test(previewReply.data.url)) throw new Error('预览应指向 /api/tasks。');
    } else if (!/工作台|项目/.test(String(previewReply.error || ''))) {
      throw new Error(`预览失败原因不明确：${previewReply.error}`);
    }
    checks.push('dispatch-preview-ipc');
    const modelsReply = await window.webContents.executeJavaScript('window.workbench.dispatchModels()');
    if (modelsReply.ok === true) {
      if (!Array.isArray(modelsReply.data.models)) throw new Error('模型清单必须是数组。');
      if (modelsReply.data.models.length === 0) throw new Error('面板已连接却没有可用模型，下拉会空白。');
      if (!modelsReply.data.models.every((m) => typeof m.id === 'string' && typeof m.local === 'boolean')) {
        throw new Error('模型项必须带 id 与 local 标记。');
      }
    } else if (!/工作台|项目/.test(String(modelsReply.error || ''))) {
      throw new Error(`模型清单失败原因不明确：${modelsReply.error}`);
    }
    checks.push('dispatch-models-ipc');
    // 对话页：只验证门控与页面切换，不发消息、不调用模型。
    const chat = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('#nav-chat').click();
      const page = document.querySelector('#chat-page');
      const send = document.querySelector('#chat-send');
      const consent = document.querySelector('#chat-consent');
      const input = document.querySelector('#chat-input');
      const others = ['memory-page', 'tasks-page', 'designer-page'].every((id) => document.querySelector('#' + id).hidden);
      const before = send.disabled;
      consent.checked = true; consent.dispatchEvent(new Event('change'));
      input.value = '冒烟测试'; input.dispatchEvent(new Event('input'));
      const noModel = send.disabled;
      input.value = ''; input.dispatchEvent(new Event('input'));
      consent.checked = false; consent.dispatchEvent(new Event('change'));
      return { visible: !page.hidden, others, before, noModel, afterUncheck: send.disabled,
        emptyHint: Boolean(document.querySelector('#chat-log .chat-empty')) };
    })()`);
    if (!chat.visible) throw new Error('对话页没有显示。');
    if (!chat.others) throw new Error('切到对话页时其他页面应隐藏。');
    if (chat.before !== true || chat.afterUncheck !== true) throw new Error('未勾选确认时发送按钮必须禁用。');
    if (chat.noModel !== true) throw new Error('未读取模型时发送按钮必须禁用。');
    if (!chat.emptyHint) throw new Error('空对话应给出提示，而不是一片空白。');
    checks.push('chat-page-gating');
    await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await new Promise((resolve) => setTimeout(resolve, 260));
    fs.writeFileSync(path.join(__dirname, 'chat-page-preview.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("document.querySelector('.dispatch-card').scrollIntoView({block:'center'}); true;");
    await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await new Promise((resolve) => setTimeout(resolve, 260));
    fs.writeFileSync(path.join(__dirname, 'dispatch-card-preview.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("document.querySelector('#nav-tasks').click(); true");
    await new Promise((resolve) => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(__dirname, 'conn-preview.png'), (await window.webContents.capturePage()).toPNG());
    const single = await window.webContents.executeJavaScript("window.workbench.startDemoTasks('single')");
    if (single.tasks.length !== 1) throw new Error('Single mode must create exactly one task.');
    await window.webContents.executeJavaScript(`window.workbench.cancelDemoTask(${JSON.stringify(single.tasks[0].id)})`);
    checks.push('single-mode-one-task');
    const layout = await window.webContents.executeJavaScript(`(() => {
      const grip = document.querySelector('#sidebar-resizer');
      const before = Number(grip.getAttribute('aria-valuenow'));
      grip.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true}));
      const resized = Number(grip.getAttribute('aria-valuenow'));
      document.querySelector('#dock-sidebar').click();
      const right = document.body.classList.contains('sidebar-right');
      document.querySelector('#toggle-sidebar').click();
      const hidden = document.body.classList.contains('sidebar-hidden');
      document.querySelector('#toggle-sidebar').click(); document.querySelector('#dock-sidebar').click();
      return {before,resized,right,hidden};
    })()`);
    if (layout.resized !== layout.before+10 || !layout.right || !layout.hidden) throw new Error('Sidebar layout controls failed.');
    checks.push('sidebar-resize-dock-hide');
    const compact = await window.webContents.executeJavaScript(`(() => {
      const toggle=document.querySelector('#toggle-sidebar').getBoundingClientRect();
      const grip=document.querySelector('#sidebar-resizer');
      const menu=document.querySelector('#layout-menu');
      const expectedMax=Math.min(380,Math.floor(innerWidth*.35));
      return {width:toggle.width,height:toggle.height,menuClosed:!menu.open,dockInMenu:menu.contains(document.querySelector('#dock-sidebar')),edge:grip.getBoundingClientRect().width,max:Number(grip.getAttribute('aria-valuemax')),expectedMax};
    })()`);
    if(compact.width>28 || compact.height>28 || compact.edge>6 || !compact.menuClosed || !compact.dockInMenu || compact.max!==compact.expectedMax) throw new Error('Compact sidebar dimensions or semantics failed: '+JSON.stringify(compact));
    checks.push('compact-sidebar-measured-dimensions');
    stage = 'narrow viewport no horizontal scroll';
    writeSmokeProgress(stage);
    window.setSize(840, 700);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const narrow = await window.webContents.executeJavaScript(`(() => {
      const doc = document.documentElement;
      const main = document.querySelector('main.workspace');
      const sidebar = document.querySelector('.sidebar');
      return {
        innerWidth: innerWidth,
        scrollWidth: doc.scrollWidth,
        mainWidth: main ? main.getBoundingClientRect().width : 0,
        sidebarWidth: sidebar ? sidebar.getBoundingClientRect().width : 0
      };
    })()`);
    if (narrow.innerWidth >= 960) throw new Error('Narrow test window did not shrink below 960px: ' + JSON.stringify(narrow));
    if (narrow.scrollWidth > narrow.innerWidth + 1 || narrow.mainWidth < 250) throw new Error('Narrow viewport caused horizontal scroll or unusable content: ' + JSON.stringify(narrow));
    checks.push('narrow-viewport-no-horizontal-scroll');
    window.setSize(1380, 900);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await window.webContents.executeJavaScript('window.workbench.openMini()');
    // 小窗现在会优先显示真实任务，条数取决于面板状态；这里只校验只读与结构，不锁死条数。
    const mini = await miniWindow.webContents.executeJavaScript(`(async () => { const r = await window.observer.tasks(); return {count:Array.isArray(r.tasks)?r.tasks.length:-1, source:r.source, note:r.note, writable:typeof window.workbench, node:typeof require}; })()`);
    if (mini.count < 0 || !['real', 'demo'].includes(mini.source) || mini.writable !== 'undefined' || mini.node !== 'undefined') {
      throw new Error(`Read-only floating task observer failed: ${JSON.stringify(mini)} top=${miniWindow.isAlwaysOnTop()}`);
    }
    miniWindow.close();
    checks.push('floating-observer-read-only');
    const settings = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('#new-space').click();
      const normal = document.querySelector('#space-form-kind option[value=shared]').disabled;
      document.querySelector('#space-dialog').close();
      document.querySelector('#open-settings').click();
      document.querySelector('#new-shared-space').click();
      const shared = document.querySelector('#space-form-kind').value === 'shared';
      document.querySelector('#space-dialog').close();
      document.querySelector('#refresh-memory-map').click();
      return {normal,shared,map:document.querySelector('#memory-map').textContent};
    })()`);
    if (!settings.normal || !settings.shared || !settings.map.includes('已发布')) throw new Error('Shared pool settings or memory map failed.');
    checks.push('shared-pool-settings-and-scoped-map');

    stage = 'tray close and restore';
    let trayFailed = false;
    try { await createTray(async () => { throw new Error('injected icon failure'); }); } catch { trayFailed = true; }
    if (!trayFailed || tray || backend.exitCode !== null) throw new Error('Tray failure left partial state or stopped service.');
    checks.push('tray-failure-keeps-service-and-no-partial-tray');
    await createTray();
    window.close();
    if (window.isDestroyed() || window.isVisible() || tray.isDestroyed()) throw new Error('Closing must preserve hidden window with live tray.');
    if (backend.exitCode !== null) throw new Error('Close-to-tray stopped the backend.');
    checks.push('tray-close-retains-window-and-service');
    tray.destroy(); tray=null;
    stage = 'wallpaper and unified appearance';
    const wallpaper = await window.webContents.executeJavaScript(`(async()=>{
      document.querySelector('#wallpaper-enabled').checked=true;
      document.querySelector('#wallpaper-enabled').dispatchEvent(new Event('change'));
      document.querySelector('#wallpaper-opacity').value='80';
      document.querySelector('#wallpaper-opacity').dispatchEvent(new Event('input'));
      await new Promise(r=>setTimeout(r,200));
      return {enabled:document.documentElement.classList.contains('wallpaper-on'),alpha:getComputedStyle(document.documentElement).getPropertyValue('--glass-alpha').trim(),saved:JSON.parse(localStorage.getItem('workbench.appearance')).opacity};
    })()`);
    if(!wallpaper.enabled || wallpaper.alpha!=='0.8' || wallpaper.saved!==.8)throw Error('Wallpaper controls failed.');
    checks.push('wallpaper-controls-local-persistence');
    const importedWallpaper = await window.webContents.executeJavaScript(`(async()=>{
      const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
      const files=new DataTransfer();files.items.add(new File([blob],'synthetic-test.png',{type:'image/png'}));
      const input=document.querySelector('#wallpaper-file');input.files=files.files;input.dispatchEvent(new Event('change'));
      for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,50));const p=JSON.parse(localStorage.getItem('workbench.appearance'));if(p.image)return p.image.startsWith('data:image/jpeg;base64,');}
      return false;
    })()`);
    if(!importedWallpaper)throw Error('Local wallpaper import/compression failed.');
    checks.push('local-wallpaper-import-compression');
    await window.webContents.executeJavaScript("document.querySelector('#wallpaper-remove').click();new Promise(r=>setTimeout(r,200))");
    panelView = new WebContentsView({webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
    await panelView.webContents.loadURL('data:text/html,<html><body><section class="card">Panel<button>Button</button></section></body></html>');
    await applyPanelAppearance();
    const unified = await panelView.webContents.executeJavaScript(`({font:getComputedStyle(document.body).fontSize,accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),radius:getComputedStyle(document.querySelector('button')).borderRadius})`);
    if(unified.font!=='13px'||unified.radius!=='7px')throw Error('Embedded appearance bridge failed.');
    panelView.webContents.close();panelView=null;panelAppearanceKey=null;
    checks.push('embedded-panel-unified-appearance');
    await window.webContents.executeJavaScript("document.querySelector('#nav-memory').click();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    fs.writeFileSync(path.join(__dirname,'wallpaper-preview.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("document.querySelector('#wallpaper-enabled').checked=false;document.querySelector('#wallpaper-enabled').dispatchEvent(new Event('change'));true");
    const childPid = backend.pid;
    stage = 'child service shutdown';
    writeSmokeProgress(stage);
    await stopBackend();
    if (backend.exitCode === null && backend.signalCode === null) throw new Error('Mock backend did not stop on app shutdown.');
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const stoppedHealth = await window.webContents.executeJavaScript("document.querySelector('#status').dataset.health");
    if (stoppedHealth !== 'stopped') throw new Error('Renderer did not show the backend failure state.');
    checks.push('backend-failure-visible');
    window.destroy();
    checks.push('child-service-shutdown');
    const result = { ok: true, checks, childPid };
    writeSmokeProgress('completed', result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    throw new Error(`${stage}: ${error.stack || error.message}`);
  }
}

ipcMain.handle('workbench:get-state', (event) => {
  assertTrustedSender(event);
  return getState();
});
ipcMain.handle('workbench:choose-project', (event) => {
  assertTrustedSender(event);
  return chooseProject();
});
ipcMain.handle('workbench:get-tasks', (event) => {
  assertTrustedSender(event);
  return getTasks();
});
ipcMain.handle('workbench:start-demo-tasks', (event, mode) => {
  assertTrustedSender(event);
  return startDemoTasks(mode);
});
ipcMain.handle('workbench:cancel-demo-task', (event, id) => {
  assertTrustedSender(event);
  return cancelDemoTask(id);
});

ipcMain.handle('memory:snapshot', (event) => {
  assertTrustedSender(event);
  return memoryReply(() => requireMemory().snapshot());
});
ipcMain.handle('memory:execute', (event, command) => {
  assertTrustedSender(event);
  return memoryReply(() => requireMemory().execute(command));
});
ipcMain.handle('memory:export', (event, spaceId, copy) => {
  assertTrustedSender(event);
  return memoryReply(() => {
    const text = JSON.stringify(architectureExport(spaceId), null, 2);
    if (copy === true) writeClipboard(text);
    return text;
  });
});
ipcMain.handle('memory:prepare', (event, raw) => {
  assertTrustedSender(event);
  return memoryReply(() => {
    architectureProposal = null;
    if (typeof raw !== 'string' || raw.length > 16000) throw new Error('建议必须是 16000 字符以内的 JSON。');
    let input;
    try { input = JSON.parse(raw); } catch { throw new Error('请粘贴有效的 JSON 架构建议，不要包含代码围栏或说明段落。'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !['schemaVersion', 'spaceId', 'baseRevision', 'baseArchitecture', 'instruction', 'patch'].includes(key))
      || input.schemaVersion !== 1 || !Number.isInteger(input.baseRevision)) throw new Error('架构建议格式不正确。');
    const before = architectureExport(input.spaceId);
    if (typeof input.baseArchitecture !== 'string' || input.baseArchitecture !== before.baseArchitecture) {
      throw new Error('该空间架构已改变，或建议缺少架构版本，请重新导出。其他空间的修改不会使建议失效。');
    }
    if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)
      || Object.keys(input.patch).length === 0
      || Object.keys(input.patch).some((key) => !['name', 'capacityChars', 'contextChars', 'sections'].includes(key))) {
      throw new Error('建议只能修改名称、容量、上下文预算和栏目，不能修改权限或正文。');
    }
    requireMemory().preview({ type: 'updateSpace', spaceId: input.spaceId,
      expectedRevision: before.baseRevision, patch: input.patch });
    architectureProposal = { id: randomBytes(16).toString('hex'), expires: Date.now() + 600000,
      spaceId: input.spaceId, baseArchitecture: input.baseArchitecture, patch: input.patch };
    return { id: architectureProposal.id, spaceId: input.spaceId, before: before.patch,
      after: { ...before.patch, ...input.patch }, expires: architectureProposal.expires };
  });
});
ipcMain.handle('memory:apply-proposal', (event, id) => {
  assertTrustedSender(event);
  return memoryReply(() => {
    const proposal = architectureProposal;
    if (!proposal || proposal.id !== id || proposal.expires < Date.now()) throw new Error('本次建议已失效，请重新预览。');
    architectureProposal = null;
    const currentArchitecture = architectureExport(proposal.spaceId);
    if (currentArchitecture.baseArchitecture !== proposal.baseArchitecture) throw new Error('该空间架构已改变，请重新导出与预览。');
    return requireMemory().execute({ type: 'updateSpace', spaceId: proposal.spaceId,
      expectedRevision: currentArchitecture.baseRevision, patch: proposal.patch });
  });
});
ipcMain.handle('memory:packet', (event, options) => {
  assertTrustedSender(event);
  return memoryReply(() => {
    contextPreview = null;
    sendPermission = null;
    const { buildPacket } = require('./memory-retrieval.cjs');
    const packet = buildPacket(requireMemory().snapshot(), options);
    contextPreview = { id: randomBytes(16).toString('hex'), options: structuredClone(options), text: packet.text };
    return { ...packet, previewId: contextPreview.id, contentHash: hashText(packet.text) };
  });
});
ipcMain.handle('memory:grant-send', (event, previewId) => {
  assertTrustedSender(event);
  return memoryReply(() => {
    if (!contextPreview || contextPreview.id !== previewId) throw new Error('上下文预览已失效，请重新检索。');
    const { buildPacket } = require('./memory-retrieval.cjs');
    const fresh = buildPacket(requireMemory().snapshot(), contextPreview.options);
    if (fresh.text !== contextPreview.text) throw new Error('记忆已更新，请重新检索后再授权外发。');
    sendPermission = createPermission(fresh.text);
    return { token: sendPermission.token, expires: sendPermission.expires };
  });
});
ipcMain.handle('memory:copy-packet', (event, token) => {
  assertTrustedSender(event);
  return memoryReply(() => {
    if (!contextPreview) throw new Error('上下文预览已失效，请重新检索。');
    const { buildPacket } = require('./memory-retrieval.cjs');
    const fresh = buildPacket(requireMemory().snapshot(), contextPreview.options);
    verifyPermission(sendPermission, token, fresh.text);
    sendPermission = null; // one-time: consume the grant on success
    writeClipboard(fresh.text);
    return { copiedChars: [...fresh.text].length };
  });
});

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  try {
    writeSmokeProgress('electron-ready');
    const { openMemoryStores } = require('./memory-bootstrap.cjs');
    const memoryPath = smokeMode
      ? `${process.env.MODEL_DESK_SMOKE_RESULT}.memory.json`
      : path.join(app.getPath('userData'), 'memory.json');
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    ({ memoryStore, architectureStore, error: memoryInitError } = openMemoryStores(memoryPath));
    await startBackend();
    if (smokeMode) {
      await runSmoke();
      app.quit();
      return;
    }
    await createWindow();
    if (pendingShow) showWorkbench();
    if (memoryInitError) dialog.showMessageBox(mainWindow, {type:'warning',title:'记忆数据降级',message:`${memoryInitError}\n\n应用仍可使用，记忆与架构页面为只读降级状态。`});
    try { await createTray(); } catch {
      dialog.showMessageBox(mainWindow, {type:'warning',message:'托盘暂不可用，工作台仍可使用。关闭窗口将退出程序。'});
    }
  } catch (error) {
    await stopBackend();
    if (smokeMode) {
      const resultFile = process.env.MODEL_DESK_SMOKE_RESULT;
      if (resultFile) fs.writeFileSync(resultFile, JSON.stringify({ ok: false, error: error.stack || error.message }));
      app.exit(1);
      return;
    }
    dialog.showErrorBox('记忆体验版启动失败', error.message);
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (mainWindow && !mainWindow.isDestroyed()) { event.preventDefault(); requestExit(); return; }
  if (closing || !backend || backend.exitCode !== null) return;
  event.preventDefault();
  closing = true;
  stopBackend().finally(() => app.quit());
});

if (!smokeMode) app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('will-quit', () => { if (tray) { tray.destroy(); tray = null; } });

ipcMain.handle('performance:sample', (event) => { assertTrustedSender(event); return require('./performance.cjs').sample(); });
ipcMain.handle('panel:status', async (event, baseUrl) => { assertTrustedSender(event); return asyncReply(() => probePanel(baseUrl, selectedProject)); });
ipcMain.handle('panel:status-all', async (event, baseUrl) => { assertTrustedSender(event); return asyncReply(() => probePanel(baseUrl, null, 'all')); });
async function openPanelWindow(url) {
  if (panelWindow && !panelWindow.isDestroyed()) { await panelWindow.loadURL(url); panelWindow.show(); panelWindow.focus(); return panelWindow; }
  panelWindow = new BrowserWindow({ width: 1400, height: 900, title: '完整工作台 · 本机（原有功能）', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  panelWindow.on('closed', () => { panelWindow = null; });
  await panelWindow.loadURL(url);
  return panelWindow;
}

ipcMain.handle('panel:open', async (event) => {
  assertTrustedSender(event);
  return asyncReply(async () => {
    const found = await discoverPanel();
    if (found.state !== 'connected') throw new Error('未发现运行中的工作台；请先运行 启动模型面板.ps1。');
    await openPanelWindow(found.baseUrl);
    return { url: found.baseUrl };
  });
});

function safeBounds(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const x = Math.max(0, Math.round(Number(rect.x) || 0));
  const y = Math.max(0, Math.round(Number(rect.y) || 0));
  const width = Math.max(0, Math.round(Number(rect.width) || 0));
  const height = Math.max(0, Math.round(Number(rect.height) || 0));
  if (!width || !height) return null;
  return { x, y, width, height };
}
async function embedPanel(rect) {
  const found = await discoverPanel();
  if (found.state !== 'connected') throw new Error('未发现运行中的工作台；请先运行 启动模型面板.ps1。');
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用。');
  if (!panelView) {
    panelView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    panelView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    panelView.webContents.on('did-finish-load',()=>{panelAppearanceKey=null;applyPanelAppearance().catch(()=>{});});
    // 面板自己崩了或加载失败时，别让界面继续显示"已嵌入"——那是在假装正常。
    const reportPanelGone = (reason) => {
      if (panelAttached && mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.contentView.removeChildView(panelView); } catch {}
      }
      panelAttached = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(
          `window.__workbenchShell && window.__workbenchShell.onPanelGone && window.__workbenchShell.onPanelGone(${JSON.stringify(String(reason))})`
        ).catch(() => {});
      }
    };
    panelView.webContents.on('render-process-gone', (_event, details) => reportPanelGone(`渲染进程已退出：${details.reason}`));
    panelView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (isMainFrame) reportPanelGone(`加载失败：${errorDescription}（${errorCode}）`);
    });
    await panelView.webContents.loadURL(found.baseUrl);
    await applyPanelAppearance();
  }
  const bounds = safeBounds(rect);
  if (!panelAttached) { mainWindow.contentView.addChildView(panelView); panelAttached = true; }
  if (bounds) panelView.setBounds(bounds);
  panelView.webContents.focus();
  return { url: found.baseUrl };
}
function hideEmbeddedPanel() {
  if (panelAttached && mainWindow && !mainWindow.isDestroyed()) { try { mainWindow.contentView.removeChildView(panelView); } catch {} }
  panelAttached = false;
}
function updatePanelBounds(rect) {
  const bounds = safeBounds(rect);
  if (panelAttached && panelView && bounds) panelView.setBounds(bounds);
}
// ---- 真实任务派发（会调用模型；预览不发送） ----
function requireSelectedProject(explicit) {
  if (!selectedProject) throw new Error('请先在「运行与连接」页选择项目文件夹；未绑定项目不会派发。');
  if (explicit && path.resolve(explicit) !== path.resolve(selectedProject)) {
    throw new Error('任务项目必须与当前选中的项目一致，不能替别的项目发任务。');
  }
  return selectedProject;
}
async function requirePanelBase() {
  const found = await discoverPanel();
  if (found.state !== 'connected') throw new Error('未发现运行中的工作台；请先运行「启动模型面板.ps1」。');
  return found.baseUrl;
}
ipcMain.handle('dispatch:models', (event) => {
  assertTrustedSender(event);
  return asyncReply(async () => {
    const baseUrl = await requirePanelBase();
    const list = await taskDispatch.listModels({ baseUrl });
    return { ...list, baseUrl };
  });
});
ipcMain.handle('dispatch:preview', (event, input) => {
  assertTrustedSender(event);
  return asyncReply(async () => {
    const payload = taskDispatch.buildTaskRequest({ ...input, project: requireSelectedProject(input && input.project) });
    const baseUrl = await requirePanelBase();
    return taskDispatch.dispatchTask({ baseUrl, payload, dryRun: true });
  });
});
ipcMain.handle('dispatch:send', (event, input) => {
  assertTrustedSender(event);
  return asyncReply(async () => {
    const payload = taskDispatch.buildTaskRequest({ ...input, project: requireSelectedProject(input && input.project) });
    const baseUrl = await requirePanelBase();
    return taskDispatch.dispatchTask({ baseUrl, payload, dryRun: false });
  });
});
// 只取日志：流式显示时每 400ms 调一次，避开全量状态读取。
ipcMain.handle('dispatch:log', (event, taskId) => {
  assertTrustedSender(event);
  return asyncReply(async () => {
    const project = requireSelectedProject(null);
    const baseUrl = await requirePanelBase();
    const log = await taskDispatch.fetchTaskLog({ baseUrl, taskId, project });
    return { answer: log.answer, exitCode: taskDispatch.exitCodeFailure(log.answer) };
  });
});

ipcMain.handle('dispatch:status', (event, taskId) => {
  assertTrustedSender(event);
  return asyncReply(async () => {
    const project = requireSelectedProject(null);
    const baseUrl = await requirePanelBase();
    // 只取一次快照：不要在这里阻塞等待，否则界面每 2 秒的轮询会被拖住。
    const tasks = await taskDispatch.listTasks({ baseUrl, project });
    const task = tasks.find((t) => t && t.id === taskId) || null;
    const log = task ? await taskDispatch.fetchTaskLog({ baseUrl, taskId, project }) : { answer: '' };
    return {
      task,
      answer: log.answer,
      exitCode: taskDispatch.exitCodeFailure(log.answer),
      queue: taskDispatch.queuePosition(tasks, taskId),
    };
  });
});
ipcMain.handle('dispatch:cancel', (event, taskId) => {
  assertTrustedSender(event);
  return asyncReply(async () => {
    const project = requireSelectedProject(null);
    const baseUrl = await requirePanelBase();
    return taskDispatch.cancelTask({ baseUrl, taskId, project });
  });
});

ipcMain.handle('panel:embed', async (event, rect) => { assertTrustedSender(event); return asyncReply(() => embedPanel(rect)); });ipcMain.handle('panel:embed-hide', (event) => { assertTrustedSender(event); hideEmbeddedPanel(); return { ok: true }; });
ipcMain.handle('panel:embed-bounds', (event, rect) => { assertTrustedSender(event); updatePanelBounds(rect); return { ok: true }; });
// Keep the embedded original workbench in the same light/dark mode as the shell.
// The panel stores its own choice in localStorage('model-desk.theme') and reflects it on <html data-theme>.
ipcMain.handle('panel:theme', async (event, theme) => {
  assertTrustedSender(event);
  return asyncReply(async () => {
    const target = theme === 'dark' ? 'dark' : 'light';
    if (!panelView || panelView.webContents.isDestroyed()) return { applied: false, reason: 'not-embedded', theme: target };
    await panelView.webContents.executeJavaScript(
      `(()=>{try{localStorage.setItem('model-desk.theme','${target}');}catch(e){}document.documentElement.dataset.theme='${target}';const sel=document.querySelector('#theme-mode');if(sel){sel.value='${target}';}return document.documentElement.dataset.theme;})()`
    );
    return { applied: true, theme: target };
  });
});

ipcMain.handle('workbench:open-mini', async event => {
  assertTrustedSender(event);
  if (miniWindow && !miniWindow.isDestroyed()) { miniWindow.show(); return; }
  miniWindow = new BrowserWindow({width:420,height:330,minWidth:300,minHeight:200,alwaysOnTop:true,show:!smokeMode,title:'任务观察 · 演示',webPreferences:{preload:path.join(__dirname,'mini-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  miniWindow.setMenu(null);
  miniWindow.on('show', () => { if (miniWindow) miniWindow.setAlwaysOnTop(true); });
  miniWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  miniWindow.webContents.on('will-navigate', event=>event.preventDefault());
  miniWindow.on('closed',()=>{miniWindow=null;});
  await miniWindow.loadFile(path.join(__dirname,'mini.html'));
});
// 小窗每 2 秒问一次；缓存 2.5 秒，避免每次轮询都去打面板。
let miniCache = { at: 0, payload: null };
const MINI_CACHE_MS = 2500;

async function miniTasksPayload() {
  const now = Date.now();
  const projectAtStart = selectedProject;
  if (miniCache.payload && miniCache.project === projectAtStart && now - miniCache.at < MINI_CACHE_MS) return miniCache.payload;
  // 未绑定项目就没有可看的任务范围，直接说清楚，连探测都省掉。
  if (!selectedProject) {
    const payload = { tasks: [], source: 'real', note: '未绑定项目：请在主窗口选择项目' };
    miniCache = { at: now, payload, project: projectAtStart };
    return payload;
  }
  let panel = null;
  try {
    const found = await discoverPanel();
    panel = (found && found.state === 'connected') ? await probePanel(found.baseUrl, projectAtStart) : found;
  } catch (error) {
    panel = { state: 'error', message: error.message };
  }
  let demo = [];
  try { demo = (await getTasks()).tasks || []; } catch {}
  if (selectedProject !== projectAtStart) return { tasks: [], source: 'real', note: '项目已切换，正在更新任务' };
  const payload = composeMiniPayload({ panel, project: projectAtStart, demo });
  miniCache = { at: now, payload, project: projectAtStart };
  return payload;
}

// ---- 对话记录持久化（单会话，本机 JSON） ----
function chatFile() {
  return smokeMode
    ? `${process.env.MODEL_DESK_SMOKE_RESULT}.chat.json`
    : path.join(app.getPath('userData'), 'chat.json');
}
ipcMain.handle('chat:load', event => {
  assertTrustedSender(event);
  return asyncReply(async () => chatStore.load(chatFile()));
});
ipcMain.handle('chat:save', (event, messages) => {
  assertTrustedSender(event);
  return asyncReply(async () => chatStore.save(chatFile(), messages));
});
ipcMain.handle('chat:clear', event => {
  assertTrustedSender(event);
  return asyncReply(async () => ({ cleared: chatStore.clear(chatFile()) }));
});

ipcMain.handle('mini:tasks', event => {
  if (!miniWindow || event.sender !== miniWindow.webContents || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== pathToFileURL(path.join(__dirname,'mini.html')).href) throw new Error('Untrusted task observer.');
  return miniTasksPayload();
});

function showWorkbench() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus(); pendingShow = false;
}
function requestExit() {
  exitRequested = true;
  if (mainWindow && !mainWindow.isDestroyed()) { showWorkbench(); mainWindow.close(); }
  else app.quit();
}
async function createTray(getIcon = () => app.getFileIcon(process.execPath, {size:'small'})) {
  let candidate = null;
  try {
    const icon = await getIcon();
    candidate = new Tray(icon);
    candidate.setToolTip('模型工作台体验版 · 本机运行 · 真实 AI 未连接');
    candidate.setContextMenu(Menu.buildFromTemplate([
      {label:'打开模型工作台',click:showWorkbench},
      {label:'本机体验版 · 真实 AI 未连接',enabled:false},
      {type:'separator'},
      {label:'退出工作台（停止后台服务）',click:requestExit}
    ]));
    candidate.on('click',showWorkbench);
    candidate.on('double-click',showWorkbench);
    tray = candidate;
  } catch (error) {
    if (candidate) candidate.destroy();
    throw error;
  }
}

ipcMain.handle('architecture:read', (event, spaceId) => {assertTrustedSender(event);return memoryReply(()=>requireArchitecture().snapshot(spaceId));});
ipcMain.handle('architecture:trial', (event,graph) => {assertTrustedSender(event);return memoryReply(()=>require('./architecture-store.cjs').trial(graph));});
ipcMain.handle('architecture:save', (event,spaceId,graph,revision) => {assertTrustedSender(event);return memoryReply(()=>requireArchitecture().save(spaceId,graph,revision));});
ipcMain.handle('architecture:copy', (event,graph) => {assertTrustedSender(event);return memoryReply(()=>{require('./architecture-store.cjs').validate(graph);const text=JSON.stringify({instruction:'这是用户的自由画布设计副本，不是授权。请提出精简与连线建议，返回 {nodes, edges}：nodes 仅含 id,name,scope,budget,x,y；edges 仅含 from,to。不得加入正文、执行指令或扩大共享范围。修改需用户预览确认。',nodes:graph.nodes,edges:graph.edges},null,2);writeClipboard(text);return {copied:true};});});

let currentAppearance = require('./appearance.cjs').validateAppearance({});
let panelAppearanceKey = null;
async function applyPanelAppearance(){
 if(!panelView || panelView.webContents.isDestroyed())return;
 if(panelAppearanceKey){await panelView.webContents.removeInsertedCSS(panelAppearanceKey);panelAppearanceKey=null;}
 panelAppearanceKey=await panelView.webContents.insertCSS(require('./appearance.cjs').panelCss(currentAppearance));
}
ipcMain.handle('appearance:apply',async(event,settings)=>{assertTrustedSender(event);return asyncReply(async()=>{currentAppearance=require('./appearance.cjs').validateAppearance(settings);await applyPanelAppearance();return {applied:true};});});
