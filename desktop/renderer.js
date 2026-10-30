const status = document.querySelector('#status');
const project = document.querySelector('#project');
const refresh = document.querySelector('#refresh');
const choose = document.querySelector('#choose');
const runDemo = document.querySelector('#run-demo');
const demoMessage = document.querySelector('#demo-message');
const taskList = document.querySelector('#task-list');
const taskChart = document.querySelector('#task-chart');
let shownProject;

function showState(state) {
  status.textContent = state.health === 'healthy' ? '本机服务正常' : '本机服务不可用';
  status.dataset.health = state.health;
  const projectPath = document.querySelector('#project-path');
  project.textContent = state.project ? state.project.split(/[\\/]/).filter(Boolean).pop() : '尚未选择项目';
  project.title = state.project || '';
  if (projectPath) projectPath.textContent = state.project || '选择一个项目后查看它的任务记录。';
  if (shownProject !== (state.project || null)) {
    shownProject = state.project || null;
    window.dispatchEvent(new CustomEvent('workbench-project-changed'));
  }
}

async function updateState() {
  // 窗口隐藏（收进托盘）时不必每 3 秒唤醒主进程。
  if (document.hidden) return;
  try {
    showState(await window.workbench.getState());
  } catch {
    status.textContent = '状态读取失败';
    status.dataset.health = 'error';
  }
}

refresh.addEventListener('click', updateState);
choose.addEventListener('click', async () => {
  try {
    showState(await window.workbench.chooseProject());
  } catch {
    status.textContent = '项目选择失败';
    status.dataset.health = 'error';
  }
});

updateState();
window.setInterval(updateState, 3000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateState(); });

const taskStatusText = {
  running: '运行中',
  completed: '已完成',
  cancelled: '已取消',
};
let lastTaskSignature = '';
let taskTimer = null;

function showTasks(result) {
  const tasks = result.tasks || [];
  const running = tasks.filter((task) => task.status === 'running').length;
  clearTimeout(taskTimer);
  taskTimer = running ? window.setTimeout(updateTasks, 650) : null;
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const cancelled = tasks.filter((task) => task.status === 'cancelled').length;
  runDemo.disabled = running > 0;
  document.querySelector('#collaboration-mode').disabled = running > 0;
  const message = tasks.length
    ? `运行中 ${running} · 已完成 ${completed} · 已取消 ${cancelled}。每个任务独立计时。`
    : '尚无演示任务。';
  if (demoMessage.textContent !== message) demoMessage.textContent = message;
  const signature = tasks.map((task) => `${task.id}:${task.status}`).join('|');
  if (signature !== lastTaskSignature) {
    taskList.replaceChildren();
    for (const task of tasks) {
      const item = document.createElement('div');
      item.className = 'task-item';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = task.label;
      const metrics = document.createElement('p');
      metrics.textContent = `编号 ${task.id} · Token/CPU/GPU：未知`;
      copy.append(title, metrics);
      const actions = document.createElement('div');
      actions.className = 'task-actions';
      const state = document.createElement('span');
      state.className = 'task-state';
      state.dataset.status = task.status;
      state.textContent = taskStatusText[task.status] || '状态未知';
      actions.append(state);
      if (task.status === 'running') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = '取消此任务';
        cancel.addEventListener('click', async () => {
          cancel.disabled = true;
          try {
            showTasks(await window.workbench.cancelDemoTask(task.id));
          } catch {
            demoMessage.textContent = '取消失败，请刷新任务状态。';
            await updateTasks();
          }
        });
        actions.append(cancel);
      }
      item.append(copy, actions);
      taskList.append(item);
    }
    lastTaskSignature = signature;
  }
  taskChart.replaceChildren();
  if (!tasks.length) {
    taskChart.textContent = '任务完成后会在这里显示耗时图。';
    return;
  }

  const now = Date.now();
  const elapsed = (task) => task.durationMs ?? Math.max(0, now - task.startedAt);
  const maxDuration = Math.max(...tasks.map(elapsed), 1);
  for (const task of tasks) {
    const row = document.createElement('div');
    row.className = 'chart-row';
    const label = document.createElement('span');
    label.textContent = task.label;
    const track = document.createElement('div');
    track.className = 'chart-track';
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.dataset.status = task.status;
    bar.style.width = `${Math.max(2, elapsed(task) / maxDuration * 100)}%`;
    track.append(bar);
    const value = document.createElement('span');
    value.className = 'chart-value';
    value.textContent = `${(elapsed(task) / 1000).toFixed(1)} 秒`;
    row.append(label, track, value);
    taskChart.append(row);
  }
}

async function updateTasks() {
  try {
    showTasks(await window.workbench.getTasks());
  } catch {
    runDemo.disabled = true;
    demoMessage.textContent = '本机服务不可用，无法读取任务。';
  }
}

runDemo.addEventListener('click', async () => {
  runDemo.disabled = true;
  try {
    showTasks(await window.workbench.startDemoTasks(document.querySelector('#collaboration-mode').value));
  } catch {
    demoMessage.textContent = '演示任务启动失败，请检查本机服务。';
    await updateTasks();
  }
});

updateTasks();


const modeSelect = document.querySelector('#collaboration-mode');
const modeDescriptions = {
 single: '一个 AI 执行任务，用户检查结果。演示显示一个任务。',
 lead: 'Codex 主导 → 分派给执行模型 → 汇总结果 → 独立验收。',
 discussion: 'Codex 与 DeepSeek 等主导模型讨论 → 形成方案 → 执行模型实现 → 复核。',
 groups: 'Claude 带领一组、Codex 带领一组 → 分组执行 → 互相指出不足 → 整改验收。',
 handoff: '在工作台选项目与主体 → 跳转对应软件执行；工作台负责运输、状态与讨论观察。'
};
function describeMode() { document.querySelector('#mode-description').textContent = modeDescriptions[modeSelect.value]; }
modeSelect.addEventListener('change', describeMode);
describeMode();

document.querySelector('#open-mini').addEventListener('click', async () => { try { await window.workbench.openMini(); } catch { demoMessage.textContent='任务观察窗口打开失败。'; } });
