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

  let currentTaskId = null;
  let polling = null;
  let inFlight = null;
  let generation = 0;
  let sending = false;
  let inputVersion = 0;
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

  function invalidatePreview() {
    inputVersion++;
    consent.checked = false;
    previewBox.hidden = true;
    previewBox.replaceChildren();
    refreshEnabled();
  }

  function renderPreview(data, modelLabel) {
    const body = data.body || {};
    previewBox.replaceChildren();
    const lines = [
      ['模型', modelLabel || body.model_id || body.modelId || '待确认'],
      ['项目', body.project || '未选择'],
      ['任务', body.prompt || ''],
      ['用量', '服务端按内容估算；实际 Token 和费用以执行记录为准。'],
    ];
    for (const [label, value] of lines) {
      const line = document.createElement('p');
      line.textContent = `${label}：${value}`;
      previewBox.append(line);
    }
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '技术详情';
    const raw = document.createElement('pre');
    raw.textContent = JSON.stringify(data, null, 2);
    details.append(summary, raw);
    previewBox.append(details);
    previewBox.hidden = false;
  }

  function refreshEnabled() {
    // 已有任务在跟踪时不允许再发：否则 currentTaskId 被覆盖，前一个任务就丢了。
    const ready = Boolean(projectPath && selectedModel() && prompt.value.trim() && consent.checked && !currentTaskId && !sending);
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
      invalidatePreview();
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
    const value = { prompt: prompt.value, modelId: selectedModel(), kind: 'chat' };
    // 每次提交前重新取一次真实项目路径，避免界面上的文件夹名被当成绝对路径。
    await syncProject();
    return { ...value, project: projectPath };
  }

  modelsButton.addEventListener('click', loadModels);
  consent.addEventListener('change', () => { refreshEnabled(); });
  prompt.addEventListener('input', invalidatePreview);
  modelSelect.addEventListener('change', invalidatePreview);

  preview.addEventListener('click', async () => {
    const version = generation;
    const revision = inputVersion;
    const modelLabel = modelSelect.selectedOptions?.[0]?.textContent;
    preview.disabled = true;
    say('正在生成预览…');
    try {
      const payload = await input();
      if (version !== generation || revision !== inputVersion) return;
      const reply = await window.workbench.dispatchPreview(payload);
      if (version !== generation || revision !== inputVersion) return;
      if (!reply.ok) throw new Error(reply.error);
      renderPreview(reply.data, modelLabel);
      say('预览已生成：还没有发送，也没有调用模型。');
    } catch (error) {
      if (version === generation && revision === inputVersion) say(`预览失败：${error.message}`, true);
    } finally {
      refreshEnabled();
    }
  });

  function renderResult(answer, task, outcome) {
    if (!resultBox) return;
    resultBox.hidden = false;
    resultBox.classList.toggle('is-failure', outcome.tone === 'error');
    resultBox.replaceChildren();
    const head = document.createElement('p');
    head.className = 'dispatch-answer-head';
    const usage = task && task.usage ? ` · ${task.usage.total_tokens ?? '?'} tokens` : '';
    head.textContent = `${outcome.label}${usage}`;
    const body = document.createElement('pre');
    body.className = 'dispatch-answer';
    body.textContent = answer || '（日志里没有可读文本，只有事件记录）';
    resultBox.append(head, body);
  }

  function stopPolling() {
    if (polling) { clearTimeout(polling); polling = null; }
  }

  function schedulePoll() {
    stopPolling();
    if (currentTaskId && !document.hidden) {
      polling = setTimeout(() => { polling = null; pollOnce(); }, 2000);
    }
  }

  async function pollOnce() {
    if (!currentTaskId || document.hidden || inFlight) return;
    const ticket = { id: currentTaskId, version: generation };
    inFlight = ticket;
    try {
      const reply = await window.workbench.dispatchStatus(ticket.id);
      if (ticket.version !== generation || ticket.id !== currentTaskId || document.hidden) return;
      if (!reply.ok) throw new Error(reply.error);
      const task = reply.data.task;
      if (!task) { say(`任务 ${currentTaskId} 还没出现在项目视图里…`); return; }
      const outcome = window.DispatchState.describeTask(task, reply.data.exitCode);
      const queue = reply.data.queue;
      const where = queue && queue.ahead > 0 ? ` · 排队第 ${queue.position} 位（前面还有 ${queue.ahead} 个）` : '';
      say(`任务 ${currentTaskId} · ${outcome.label}${where}`, outcome.tone === 'error');
      if (outcome.terminal) {
        stopPolling();
        renderResult(reply.data.answer, task, outcome);
        currentTaskId = null;
        if (cancel) cancel.hidden = true;
        if (outcome.tone === 'error' && task.error) say(`${outcome.label}：${task.error}`, true);
      }
    } catch (error) {
      if (ticket.version === generation && ticket.id === currentTaskId && !document.hidden) {
        say(`状态暂时无法读取，将继续查询原任务，不会重新派发。${error.message}`, true);
      }
    } finally {
      if (inFlight === ticket) inFlight = null;
      if (ticket.version === generation) { schedulePoll(); refreshEnabled(); }
    }
  }

  send.addEventListener('click', async () => {
    if (sending || currentTaskId) return;
    if (!consent.checked) { say('请先勾选确认这会真的调用模型。', true); return; }
    const version = generation;
    const revision = inputVersion;
    sending = true;
    send.disabled = true;
    say('正在派发…');
    try {
      const payload = await input();
      if (version !== generation) return;
      if (revision !== inputVersion || !consent.checked) throw new Error('内容或模型已变化，请重新确认后派发。');
      const reply = await window.workbench.dispatchSend(payload);
      if (version !== generation) return;
      if (!reply.ok) throw new Error(reply.error);
      currentTaskId = reply.data.id;
      say(`已派发：${currentTaskId}（${reply.data.status || 'queued'}）`);
      if (cancel) cancel.hidden = false;
      resultBox.hidden = true;
      stopPolling();
      pollOnce();
    } catch (error) {
      if (version === generation) { say(`派发失败：${error.message}`, true); currentTaskId = null; }
    } finally {
      sending = false;
      refreshEnabled();
    }
  });

  cancel.addEventListener('click', async () => {
    if (!currentTaskId) return;
    const id = currentTaskId, version = generation;
    cancel.disabled = true;
    try {
      const reply = await window.workbench.dispatchCancel(id);
      if (version !== generation || id !== currentTaskId) return;
      if (!reply.ok) throw new Error(reply.error);
      say(`已请求取消 ${id}；服务端是否真的停止取决于它本身。`);
    } catch (error) {
      if (version === generation) say(`取消失败：${error.message}`, true);
    } finally {
      cancel.disabled = false;
    }
  });

  // 项目切换或页面隐藏时不做无意义轮询。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else if (currentTaskId) { say('正在恢复原任务的状态查询，没有重新派发。'); pollOnce(); }
  });
  window.addEventListener('workbench-project-changed', () => {
    generation++;
    stopPolling();
    currentTaskId = null;
    inFlight = null;
    projectPath = '';
    consent.checked = false;
    resultBox.replaceChildren();
    resultBox.hidden = true;
    previewBox.textContent = '';
    previewBox.hidden = true;
    say('项目已切换；原任务保留在原项目，可在任务动态中查看。');
    refreshEnabled();
    syncProject().then(refreshEnabled);
  });
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
