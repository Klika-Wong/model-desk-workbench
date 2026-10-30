let busy = false;
const LABEL = { running: '运行中', completed: '已完成', cancelled: '已取消', failed: '失败', queued: '排队中' };

function row(task) {
  const item = document.createElement('div');
  item.className = 'task';
  const name = document.createElement('span');
  name.textContent = task.label || task.title || task.id || '未命名任务';
  const state = document.createElement('span');
  state.className = 'task-state';
  state.dataset.status = String(task.status || '');
  state.textContent = task.state || LABEL[task.status] || '未知';
  item.append(name, state);
  return item;
}

async function refresh() {
  // 窗口不可见时不轮询，避免无意义的 IPC。
  if (busy || document.hidden) return;
  busy = true;
  const list = document.getElementById('tasks');
  const source = document.getElementById('source');
  try {
    const result = await window.observer.tasks();
    const tasks = Array.isArray(result.tasks) ? result.tasks : [];
    const real = result.source === 'real';
    if (source) source.textContent = result.note || (real ? '本机工作台真实任务' : '演示任务 · 未调用模型');
    list.replaceChildren();
    if (!tasks.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = real ? '当前项目还没有任务记录。' : '还没有演示任务：在主窗口选择模式并运行。';
      list.append(empty);
      return;
    }
    for (const task of tasks.slice(0, 30)) list.append(row(task));
  } catch {
    list.replaceChildren();
    const failed = document.createElement('p');
    failed.className = 'empty';
    failed.textContent = '读不到任务状态（与主窗口的连接中断）。';
    list.append(failed);
  } finally {
    busy = false;
  }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
refresh();
setInterval(refresh, 2000);
