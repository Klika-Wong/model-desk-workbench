/* 本地对话页（CHAT-01）：
   - 消息真的发给工作台模型（走 dispatch 那条已验证的路径）
   - 可选把「当前空间的已发布记忆」一起发过去，并如实显示注入了哪几条
   - 会话只存在内存里，不落盘；没有"自动记住"这种悄悄发生的事 */
(() => {
  const $ = (id) => document.getElementById(id);
  // 面板给的是英文状态码，界面上不该直接甩给用户。
  const STATUS_TEXT = {
    queued: '排队中', pending: '等待中', dispatching: '准备中', running: '运行中', in_progress: '运行中',
    executing: '运行中', completed: '已完成', accepted: '已验收', cancelled: '已取消', failed: '失败', blocked: '需处理',
  };
  const statusText = (value) => STATUS_TEXT[String(value || '').toLowerCase()] || String(value || '未知');

  const log = $('chat-log');
  const input = $('chat-input');
  const sendButton = $('chat-send');
  const statusLine = $('chat-status');
  const modelSelect = $('chat-model');
  const consent = $('chat-consent');
  const useMemory = $('chat-use-memory');
  const useHistory = $('chat-use-history');
  const memoryHint = $('chat-memory-hint');
  if (!log || !input) return;

  const messages = []; // {role:'user'|'assistant', text, meta?}
  let pendingTask = null;
  let timer = null;
  let logTimer = null;
  // 输出节奏：有新增内容时快，连续几次没变化就退避，避免空转抢 CPU。
  const LIVE_FAST_MS = 400;
  const LIVE_SLOW_MS = 1200;
  const LIVE_IDLE_AFTER = 3;
  // A07：长时间没有正文必须明说“状态未明”，不能干等。
  const NO_OUTPUT_HINT_MS = 8000;
  let liveDelay = LIVE_FAST_MS;
  let idleStreak = 0;
  let taskStartedAt = 0;
  let saveTimer = null;
  // 对话变更后 500ms 落盘；不存失败的回答，也不在保存失败时打断对话。
  function persist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try { window.workbench.chatSave(messages); } catch {}
    }, 500);
  }

  const say = (text, isError = false) => {
    if (!statusLine) return;
    statusLine.textContent = text;
    statusLine.classList.toggle('is-error', Boolean(isError));
  };
  // #project 只显示文件夹名，绝对路径在 #project-path；以主进程 selectedProject 为准。
  let projectPath = '';
  async function syncProject() {
    try {
      const state = await window.workbench.getState();
      projectPath = (state && state.project) || '';
    } catch {
      projectPath = '';
    }
    const name = $('chat-project-name');
    if (name) name.textContent = projectPath ? (projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath) : '未选择';
    return projectPath;
  }
  const spaceId = () => {
    try { return window.__memoryUi?.currentSpaceId?.() || null; } catch { return null; }
  };

  function refresh() {
    const canSend = Boolean(consent.checked && modelSelect.value && input.value.trim() && projectPath && !pendingTask);
    sendButton.disabled = !canSend;
    if (useMemory) {
      useMemory.disabled = !spaceId();
      if (!spaceId()) memoryHint.textContent = '（还没有加载记忆空间）';
      else if (useMemory.checked) memoryHint.textContent = '将发送该空间的已发布条目（不含候选与撤回）';
      else memoryHint.textContent = '';
    }
  }

  function bubble(role, text, meta) {
    const empty = log.querySelector('.chat-empty');
    if (empty) empty.remove();
    const wrap = document.createElement('div');
    wrap.className = `chat-msg ${role}`;
    const who = document.createElement('span');
    who.className = 'chat-who';
    who.textContent = role === 'user' ? '你' : '模型';
    const body = document.createElement('div');
    body.className = 'chat-text';
    body.textContent = text;
    wrap.append(who, body);
    if (meta) {
      const note = document.createElement('div');
      note.className = 'chat-meta';
      note.textContent = meta;
      wrap.append(note);
    }
    log.append(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  function renderEmpty() {
    if (!log || messages.length) return;
    log.replaceChildren();
    const hint = document.createElement('p');
    hint.className = 'chat-empty';
    hint.textContent = '还没有消息。先读取模型并勾选确认，然后输入第一句；勾上「带上当前空间已发布记忆」时会先显示注入了哪几条。';
    log.append(hint);
  }

  function renderAll() {
    log.replaceChildren();
    for (const message of messages) bubble(message.role, message.text, message.meta);
  }

  async function loadModels() {
    $('chat-models').disabled = true;
    say('正在读取工作台模型…');
    try {
      const reply = await window.workbench.dispatchModels();
      if (!reply.ok) throw new Error(reply.error);
      const { models, defaultModel } = reply.data;
      modelSelect.replaceChildren();
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = `${model.name}${model.local ? ' · 本地' : ' · 云端'}`;
        modelSelect.append(option);
      }
      if (defaultModel && models.some((m) => m.id === defaultModel)) modelSelect.value = defaultModel;
      consent.disabled = models.length === 0;
      say(`已读取 ${models.length} 个模型`);
    } catch (error) {
      say(`读取模型失败：${error.message}`, true);
      consent.disabled = true;
    } finally {
      $('chat-models').disabled = false;
      refresh();
    }
  }

  async function composePrompt(text, history) {
    let memoryText = '';
    let injected = null;
    if (useMemory.checked) {
      const id = spaceId();
      if (!id) throw new Error('还没有加载记忆空间，无法带上记忆。');
      const reply = await window.workbench.memoryPacket({ spaceId: id, query: text, budgetChars: 2000 });
      if (!reply.ok) throw new Error(reply.error);
      const packet = reply.data;
      if (packet.items.length) {
        memoryText = packet.text;
        injected = {
          count: packet.items.length,
          matched: packet.matched,
          items: packet.items.map((item) => ({
            id: String(item.id),
            title: String(item.title || '未命名记忆'),
            version: item.version,
            source: String(item.source || ''),
          })),
        };
      } else {
        injected = { count: 0 };
      }
    }
    const built = window.__chatPrompt.buildChatPrompt({ history: history.text, memory: memoryText, question: text });
    return { prompt: built.text, injected };
  }

  function buildInjectionNote(injected) {
    const box = document.createElement('div');
    box.className = 'chat-injection';
    const head = document.createElement('span');
    head.className = 'chat-meta';
    head.textContent = `本次注入 ${injected.count} 条记忆（命中 ${injected.matched ?? injected.count} 条）：`;
    box.append(head);
    for (const item of injected.items || []) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chat-chip';
      chip.dataset.entryId = item.id;
      chip.title = `${item.title}（v${item.version}）\n${item.source || '未填来源'} · 点击查看原文`;
      chip.textContent = item.title.length > 14 ? `${item.title.slice(0, 14)}…` : item.title;
      chip.addEventListener('click', () => openSource(item.id));
      box.append(chip);
    }
    return box;
  }

  // 打开注入条目的原文：从本机快照里查，不联网；查不到就直说，不拿摘要顶替。
  async function openSource(entryId) {
    const dialog = $('chat-source-dialog');
    if (!dialog) return;
    let entry = null;
    try {
      const reply = await window.workbench.memorySnapshot();
      if (reply && reply.ok && reply.data) {
        for (const space of reply.data.spaces || []) {
          const hit = (space.entries || []).find((item) => item.id === entryId);
          if (hit) { entry = { ...hit, spaceName: space.name }; break; }
        }
      }
    } catch {}
    if (!entry) { say('这条记忆已不在本机库里（可能被撤回或删除）。', true); return; }
    $('chat-source-title').textContent = entry.title || '记忆原文';
    const parts = [
      `空间：${entry.spaceName || '未知'}`,
      `状态：${entry.status === 'published' ? '已发布' : entry.status === 'candidate' ? '待确认' : '已撤回'}`,
      `版本：v${entry.version}`,
      `来源：${entry.source || '未填'}`,
      entry.section ? `栏目：${entry.section}` : '',
    ].filter(Boolean);
    $('chat-source-meta').textContent = parts.join(' · ');
    $('chat-source-body').textContent = entry.body || '（这条记忆没有正文）';
    dialog.showModal();
  }

  // 400ms 只拉日志：面板每次返回最新 50KB，worker 逐行 flush，所以这是真实增量。
  async function pullLog(taskId, node) {
    if (!pendingTask || pendingTask !== taskId || document.hidden) return;
    try {
      const reply = await window.workbench.dispatchLog(taskId);
      if (!reply.ok) return;
      const text = String(reply.data.answer || '').trim();
      if (!text) {
        // 一个字都没有：不在这里写状态行（由 poll 统一负责），只放慢轮询。
        idleStreak += 1;
        liveDelay = idleStreak >= LIVE_IDLE_AFTER ? LIVE_SLOW_MS : LIVE_FAST_MS;
        return;
      }
      const live = node.querySelector('.chat-text');
      if (live.textContent !== text) {
        live.textContent = text;
        log.scrollTop = log.scrollHeight;
        idleStreak = 0;
        liveDelay = LIVE_FAST_MS;
      } else {
        idleStreak += 1;
        if (idleStreak >= LIVE_IDLE_AFTER) liveDelay = LIVE_SLOW_MS;
      }
      live.classList.add('is-streaming');
    } catch {}
  }

  // 用链式 setTimeout 而不是 setInterval：间隔要能随内容变化调整。
  function scheduleLogPoll(taskId, node) {
    if (logTimer) clearTimeout(logTimer);
    logTimer = setTimeout(async () => {
      await pullLog(taskId, node);
      if (pendingTask === taskId) scheduleLogPoll(taskId, node);
      else logTimer = null;
    }, liveDelay);
  }

  function stopPolling() {
    if (timer) { clearInterval(timer); timer = null; }
    if (logTimer) { clearTimeout(logTimer); logTimer = null; }
  }

  async function poll(taskId, node) {
    try {
      const reply = await window.workbench.dispatchStatus(taskId);
      if (!reply.ok) throw new Error(reply.error);
      const task = reply.data.task;
      if (!task) { say(`任务 ${taskId} 还没出现在项目视图里…`); return; }
      const state = String(task.status || task.phase || '');
      const queue = reply.data.queue;
      const partialNow = String(reply.data.answer || '').trim();
      const runningFor = taskStartedAt ? Date.now() - taskStartedAt : 0;
      const noOutput = !partialNow && runningFor > NO_OUTPUT_HINT_MS
        ? ` · 已运行 ${Math.round(runningFor / 1000)} 秒仍无正文（状态未明，可继续等待或取消）`
        : '';
      say(`任务 ${taskId} · ${statusText(state)}${queue && queue.ahead > 0 ? ` · 排队第 ${queue.position} 位` : ''}${noOutput}`);
      if (!['completed', 'failed', 'cancelled', 'accepted'].includes(state)) {
        // 还在跑：把日志里已经产出的正文先显示出来，末尾带光标；
        // 这只是"目前拿到的部分"，不等于最终回答。
        const partial = String(reply.data.answer || '').trim();
        if (partial) {
          const live = node.querySelector('.chat-text');
          if (live.textContent !== partial) live.textContent = partial;
          live.classList.add('is-streaming');
          log.scrollTop = log.scrollHeight;
        }
        return;
      }
      stopPolling();
      pendingTask = null;
      const body = node.querySelector('.chat-text');
      body.classList.remove('is-streaming');
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      const tokens = task.usage ? ` · ${task.usage.total_tokens} tokens` : '';
      if (reply.data.exitCode) {
        body.textContent = reply.data.answer || '（本次没有有效回答）';
        meta.textContent = `执行器异常退出（exit code ${reply.data.exitCode}），结果无效${tokens}`;
        meta.classList.add('is-error');
      } else if (state !== 'completed') {
        body.textContent = reply.data.answer || '（没有内容）';
        meta.textContent = `任务${state === 'cancelled' ? '已取消' : '失败'}：${task.error || '没有更多信息'}${tokens}`;
        meta.classList.add('is-error');
      } else {
        body.textContent = reply.data.answer || '（日志里没有可读文本）';
        meta.textContent = `已完成 · ${task.model_name || task.model_id || ''}${tokens}`;
        // 只有成功且非空才进历史，失败的回答不能污染下一轮。
        if (reply.data.answer && reply.data.answer.trim()) {
          messages.push({ role: 'assistant', text: reply.data.answer.trim() });
          persist();
        }
      }
      node.append(meta);
      log.scrollTop = log.scrollHeight;
    } catch (error) {
      stopPolling();
      pendingTask = null;
      say(`查询失败：${error.message}`, true);
    } finally {
      refresh();
    }
  }

  async function send() {
    const text = input.value.trim();
    if (!text || !consent.checked || !modelSelect.value || pendingTask) return;
    await syncProject();
    if (!projectPath) { say('还没有选择项目：请先点「选择项目」绑定文件夹，消息不会发到别的项目。', true); refresh(); return; }
    // 历史必须在把当前这句塞进 messages 之前算，否则会把自己也算成“此前对话”。
    const history = (useHistory && useHistory.checked)
      ? window.__chatPrompt.buildHistory(messages, window.__chatPrompt.DEFAULT_HISTORY_CHARS)
      : { text: '', included: 0, omitted: 0 };
    input.value = '';
    refresh();
    messages.push({ role: 'user', text });
    persist();
    bubble('user', text);

    const node = bubble('assistant', '正在派发…', '');
    say('正在派发…');
    try {
      const { prompt, injected } = await composePrompt(text, history);
      if (history.included > 0) {
        const historyNote = document.createElement('div');
        historyNote.className = 'chat-meta';
        historyNote.textContent = `含前 ${history.included} 条对话${history.omitted ? `（更早 ${history.omitted} 条已省略）` : ''}`;
        node.insertBefore(historyNote, node.querySelector('.chat-text'));
      }
      if (injected && injected.count > 0) {
        node.insertBefore(buildInjectionNote(injected), node.querySelector('.chat-text'));
      }
      if (injected && injected.count === 0) say('记忆里没有相关条目，本次只发你的问题。');
      const reply = await window.workbench.dispatchSend({ prompt, modelId: modelSelect.value, kind: 'chat', project: projectPath });
      if (!reply.ok) throw new Error(reply.error);
      pendingTask = reply.data.id;
      say(`已派发：${pendingTask}（${reply.data.status || 'queued'}）`);
      timer = setInterval(() => poll(pendingTask, node), 2000);
      liveDelay = LIVE_FAST_MS;
      idleStreak = 0;
      taskStartedAt = Date.now();
      scheduleLogPoll(pendingTask, node);
      pullLog(pendingTask, node);
      poll(pendingTask, node);
    } catch (error) {
      node.querySelector('.chat-text').textContent = '没有发出去。';
      const meta = document.createElement('div');
      meta.className = 'chat-meta is-error';
      meta.textContent = error.message;
      node.append(meta);
      say(`发送失败：${error.message}`, true);
      pendingTask = null;
      refresh();
    }
  }

  // 导航：切到对话时隐藏其他页，切走时隐藏自己。
  const PAGES = ['memory-page', 'tasks-page', 'designer-page', 'chat-page'];
  function showChat() {
    for (const id of PAGES) { const el = $(id); if (el) el.hidden = id !== 'chat-page'; }
    for (const b of document.querySelectorAll('.nav-button')) b.classList.toggle('active', b.id === 'nav-chat');
    refresh();
  }
  function hideChat() { const el = $('chat-page'); if (el) el.hidden = true; $('nav-chat')?.classList.remove('active'); }
  $('nav-chat').addEventListener('click', () => { hideChat(); showChat(); });
  for (const id of ['nav-memory', 'nav-tasks', 'nav-designer', 'nav-panel']) {
    const button = $(id);
    if (button) button.addEventListener('click', hideChat);
  }

  $('chat-models').addEventListener('click', loadModels);
  // 复用任务页那套原生目录选择：不另写一份选择逻辑，避免两处行为不一致。
  $('chat-project').addEventListener('click', () => {
    const choose = $('choose');
    if (choose) choose.click();
    setTimeout(async () => { await syncProject(); refresh(); }, 800);
  });
  consent.addEventListener('change', refresh);
  useMemory.addEventListener('change', refresh);
  if (useHistory) useHistory.addEventListener('change', refresh);
  modelSelect.addEventListener('change', refresh);
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); }
  });
  sendButton.addEventListener('click', send);
  $('chat-clear').addEventListener('click', () => {
    messages.length = 0;
    log.replaceChildren();
    stopPolling();
    pendingTask = null;
    say('对话已清空（本机记录也已删除；任务记录不受影响）。');
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try { window.workbench.chatClear(); } catch {}
    renderEmpty();
    refresh();
  });

  (async () => {
    try {
      const reply = await window.workbench.chatLoad();
      if (reply && reply.ok && reply.data) {
        for (const message of reply.data.messages || []) messages.push(message);
        if (reply.data.corrupted) say('上次的对话记录损坏，已按空对话打开。', true);
        else if (reply.data.dropped) say(`上次有 ${reply.data.dropped} 条过早的对话没有保留。`);
        if (messages.length) renderAll();
      }
    } catch {}
    renderEmpty();
    refresh();
  })();
  syncProject().then(refresh);
  window.__chatUi = { send, hidePage: hideChat, state: () => ({ messages: messages.length, pendingTask }) };
})();
