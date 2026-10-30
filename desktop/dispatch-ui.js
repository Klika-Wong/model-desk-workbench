/* 派发真实任务：预览（不发送）→ 勾选确认 → 派发 → 轮询状态 → 取回答 / 取消。
   任何一步失败都如实显示，不把失败当成功。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const status = $('dispatch-status');
  const resultBox = $('dispatch-result');
  const previewBox = $('dispatch-preview-body');
  const modelSelect = $('dispatch-model');
  const prompt = $('dispatch-prompt');
  const consent = $('dispatch-consent');
  const preview = $('dispatch-preview');
  const send = $('dispatch-send');
  const cancel = $('dispatch-cancel');
  const modelsButton = $('dispatch-models');

  // 面板给的是英文状态码，界面上不该直接甩给用户。
  const STATUS_TEXT = {
    queued: '排队中', pending: '等待中', dispatching: '准备中', running: '运行中', in_progress: '运行中',
    executing: '运行中', completed: '已完成', accepted: '已验收', cancelled: '已取消', failed: '失败', blocked: '需处理',
  };
  const statusText = (value) => STATUS_TEXT[String(value || '').toLowerCase()] || String(value || '未知');

  let currentTaskId = null;
  let polling = null;
  // #project 现在只显示文件夹名，绝对路径在 #project-path；真正可信的是主进程的 selectedProject。
  let projectPath = '';

  function say(text, isError = false) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('is-error', Boolean(isError));
  }
  async function syncProject() {
    try {
      const state = await window.workbench.getState();
      projectPath = (state && state.project) || '';
    } catch {
      projectPath = '';
    }
    return projectPath;
  }
  function selectedModel() { return modelSelect ? modelSelect.value : ''; }

  function refreshEnabled() {
    // 已有任务在跟踪时不允许再发：否则 currentTaskId 被覆盖，前一个任务就丢了。
    const ready = Boolean(projectPath && selectedModel() && prompt.value.trim() && consent.checked && !currentTaskId);
    if (send) send.disabled = !ready;
    if (preview) preview.disabled = !(projectPath && selectedModel() && prompt.value.trim());
    if (cancel) cancel.hidden = !currentTaskId;
    if (send && !projectPath) send.title = '请先在「运行与连接」页选择项目文件夹';
    else if (send && currentTaskId) send.title = '已有任务在跟踪中：等它结束或先取消';
  }

  async function loadModels() {
    modelsButton.disabled = true;
    say('正在读取工作台模型…');
    try {
      const reply = await window.workbench.dispatchModels();
      if (!reply.ok) throw new Error(reply.error);
      const { models, defaultModel, baseUrl } = reply.data;
      modelSelect.replaceChildren();
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = `${model.name}${model.local ? ' · 本地' : ' · 云端'}`;
        option.dataset.local = String(model.local);
        modelSelect.append(option);
      }
      if (defaultModel && models.some((m) => m.id === defaultModel)) modelSelect.value = defaultModel;
      consent.disabled = models.length === 0;
      const localCount = models.filter((m) => m.local).length;
      say(`已读取 ${models.length} 个模型（本地 ${localCount} 个）· ${baseUrl}`);
    } catch (error) {
      say(`读取模型失败：${error.message}`, true);
      modelSelect.replaceChildren();
      consent.disabled = true;
    } finally {
      modelsButton.disabled = false;
      refreshEnabled();
    }
  }

  async function input() {
    // 每次提交前重新取一次真实项目路径，避免界面上的文件夹名被当成绝对路径。
    await syncProject();
    return { prompt: prompt.value, modelId: selectedModel(), kind: 'chat', project: projectPath };
  }

  modelsButton.addEventListener('click', loadModels);
  consent.addEventListener('change', () => { refreshEnabled(); });
  prompt.addEventListener('input', () => { refreshEnabled(); });
  modelSelect.addEventListener('change', refreshEnabled);

  preview.addEventListener('click', async () => {
    preview.disabled = true;
    say('正在生成预览…');
    try {
      const reply = await window.workbench.dispatchPreview(await input());
      if (!reply.ok) throw new Error(reply.error);
      previewBox.hidden = false;
      previewBox.textContent = JSON.stringify(reply.data, null, 2);
      say('预览已生成：还没有发送，也没有调用模型。');
    } catch (error) {
      say(`预览失败：${error.message}`, true);
    } finally {
      refreshEnabled();
    }
  });

  function renderResult(answer, task, exitCode) {
    if (!resultBox) return;
    resultBox.hidden = false;
    resultBox.classList.toggle('is-failure', exitCode !== null && exitCode !== undefined);
    resultBox.replaceChildren();
    const head = document.createElement('p');
    head.className = 'dispatch-answer-head';
    const usage = task && task.usage ? ` · ${task.usage.total_tokens ?? '?'} tokens` : '';
    // 面板会把执行器非零退出记成 completed；这里必须说清楚，不能当成功。
    head.textContent = (exitCode !== null && exitCode !== undefined)
      ? `执行器异常退出（exit code ${exitCode}）· 本次没有有效回答${usage}`
      : `回答${usage}`;
    const body = document.createElement('pre');
    body.className = 'dispatch-answer';
    body.textContent = answer || '（日志里没有可读文本，只有事件记录）';
    resultBox.append(head, body);
  }

  function stopPolling() {
    if (polling) { clearInterval(polling); polling = null; }
  }

  async function pollOnce() {
    if (!currentTaskId) return;
    try {
      const reply = await window.workbench.dispatchStatus(currentTaskId);
      if (!reply.ok) throw new Error(reply.error);
      const task = reply.data.task;
      if (!task) { say(`任务 ${currentTaskId} 还没出现在项目视图里…`); return; }
      const state = String(task.status || task.phase || 'unknown');
      const queue = reply.data.queue;
      const where = queue && queue.ahead > 0 ? ` · 排队第 ${queue.position} 位（前面还有 ${queue.ahead} 个）` : '';
      say(`任务 ${currentTaskId} · ${statusText(state)}${where}`);
      if (['completed', 'failed', 'cancelled', 'accepted'].includes(state)) {
        stopPolling();
        renderResult(reply.data.answer, task, reply.data.exitCode);
        currentTaskId = null;
        if (cancel) cancel.hidden = true;
        if (state !== 'completed') say(`任务${state === 'cancelled' ? '已取消' : '失败'}：${task.error || '没有更多信息'}`, true);
        else if (reply.data.exitCode) say(`任务状态虽为完成，但执行器退出码 ${reply.data.exitCode}，结果无效。`, true);
      }
    } catch (error) {
      say(`查询任务失败：${error.message}`, true);
      stopPolling();
    }
  }

  send.addEventListener('click', async () => {
    if (!consent.checked) { say('请先勾选确认这会真的调用模型。', true); return; }
    send.disabled = true;
    say('正在派发…');
    try {
      const reply = await window.workbench.dispatchSend(await input());
      if (!reply.ok) throw new Error(reply.error);
      currentTaskId = reply.data.id;
      say(`已派发：${currentTaskId}（${reply.data.status || 'queued'}）`);
      if (cancel) cancel.hidden = false;
      resultBox.hidden = true;
      stopPolling();
      polling = setInterval(pollOnce, 2000);
      pollOnce();
    } catch (error) {
      say(`派发失败：${error.message}`, true);
      currentTaskId = null;
    } finally {
      refreshEnabled();
    }
  });

  cancel.addEventListener('click', async () => {
    if (!currentTaskId) return;
    cancel.disabled = true;
    try {
      const reply = await window.workbench.dispatchCancel(currentTaskId);
      if (!reply.ok) throw new Error(reply.error);
      say(`已请求取消 ${currentTaskId}；服务端是否真的停止取决于它本身。`);
    } catch (error) {
      say(`取消失败：${error.message}`, true);
    } finally {
      cancel.disabled = false;
    }
  });

  // 项目切换或页面隐藏时不做无意义轮询。
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPolling(); });
  const chooseButton = $('choose');
  if (chooseButton) chooseButton.addEventListener('click', () => setTimeout(async () => {
    const before = projectPath;
    await syncProject();
    if (projectPath && projectPath !== before) say(`项目已切换为：${projectPath}`);
    if (!projectPath) say('还没有选择项目：派发需要先绑定项目文件夹。', true);
    refreshEnabled();
  }, 800));

  syncProject().then(refreshEnabled);
  window.__dispatchUi = { refreshEnabled, loadModels, state: () => ({ taskId: currentTaskId, polling: Boolean(polling) }) };
})();
