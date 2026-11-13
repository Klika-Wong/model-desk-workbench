/* 本地对话页（CHAT-01）：
   - 消息真的发给工作台模型（走 dispatch 那条已验证的路径）
   - 可选把「当前空间的已发布记忆」一起发过去，并如实显示注入了哪几条
   - 对话按项目保存在本机；旧的无归属记录不自动载入任何项目 */
(() => {
  const $ = (id) => document.getElementById(id);
  // 面板给的是英文状态码，界面上不该直接甩给用户。
  const STATUS_TEXT = {
    queued: '排队中', pending: '等待中', dispatching: '准备中', running: '运行中', in_progress: '运行中',
    executing: '运行中', completed: '已完成', accepted: '已验收', cancelled: '已取消', failed: '失败', blocked: '需处理',
  };
  const statusText = (value) => STATUS_TEXT[String(value || '').toLowerCase()] || String(value || '未知');
  // 模型显示名统一走 __modelAlias（自定义 ID > 原名），保证各处一致。
  const aliasOf = (model) => (window.__modelAlias ? window.__modelAlias.of(model) : ((model && (model.name || model.id)) || ''));

  const log = $('chat-log');
  const input = $('chat-input');
  const sendButton = $('chat-send');
  const statusLine = $('chat-status');
  const modelSelect = $('chat-model');
  const consent = $('chat-consent');
  const useMemory = $('chat-use-memory');
  const useHistory = $('chat-use-history');
  const multiToggle = $('chat-multi');
  const discussionToggle = $('chat-discussion');
  const petToggle = $('chat-pet');
  const multiSelect = $('chat-multi-models');
  const stage = $('chat-stage');
  let loadedModels = [];
  let multiGroupRunning = false;
  let multiGeneration = 0;
  const multiFinishers = new Set();
  // 本轮已经派发出去的 task id（Set 去重：验证桩会让多个分支复用了同一个 id）。
  // 停止按钮靠它逐个请求取消，不靠界面上的卡片数量猜。
  const multiTaskIds = new Set();
  let multiCancelling = false;
  // 中止所有未完成的多视角分支：清定时器、resolve 挂起的 Promise、复位运行标记。
  // 切页/切项目时调用；否则分支轮询会泄漏，multiGroupRunning 卡 true 会让发送按钮永久禁用。
  function abortMulti() {
    multiGeneration += 1;
    for (const finish of [...multiFinishers]) finish();
    multiFinishers.clear();
    multiGroupRunning = false;
    multiTaskIds.clear();
    multiCancelling = false;
    refresh();
  }
  // 桌宠陪聊（单模型）：activePet 记录当前陪聊的模型，驱动场景里那个单独节点的状态。
  let activePet = null;       // { modelId, modelName }
  let petSpoken = false;      // 是否已经拿到第一段正文
  let petStalledTimer = null; // A07：等了很久无正文 → stalled
  function clearPetStalled() {
    if (petStalledTimer) { clearTimeout(petStalledTimer); petStalledTimer = null; }
  }
  function resetPet() {
    clearPetStalled();
    activePet = null;
    petSpoken = false;
    if (stage) stage.hidden = true;
  }
  const memoryHint = $('chat-memory-hint');
  if (!log || !input) return;

  const messages = []; // {role:'user'|'assistant', text, meta?}
  let pendingTask = null;
  let sending = false;
  let sendRevision = 0;
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
  let conversationRevision = 0;
  let historyReady = false;
  let clearing = false;
  let cancelling = false;
  // 冻结归属和消息，不能在异步写入时改用后来选中的项目。
  function persist() {
    if (!projectPath || !historyReady) return;
    const project = projectPath;
    const revision = conversationRevision;
    const snapshot = messages.map(message => ({ ...message }));
    Promise.resolve().then(() => window.workbench.chatSave(snapshot, project)).then(reply => {
      if (!reply?.ok) throw new Error('save failed');
    }).catch(() => {
      if (revision === conversationRevision) say('本机对话保存失败；当前窗口仍保留内容，请先复制备份。', true);
    });
  }

  const say = (text, isError = false) => {
    if (!statusLine) return;
    statusLine.textContent = text;
    statusLine.classList.toggle('is-error', Boolean(isError));
  };
  // #project 只显示文件夹名，绝对路径在 #project-path；以主进程 selectedProject 为准。
  let projectPath = '';
  let projectReadRevision = 0;
  async function syncProject() {
    const request = ++projectReadRevision;
    let nextProject = '';
    try {
      const state = await window.workbench.getState();
      nextProject = (state && state.project) || '';
    } catch {}
    if (request !== projectReadRevision) return projectPath;
    if (nextProject !== projectPath || (!historyReady && !projectPath)) await switchConversation(nextProject);
    const name = $('chat-project-name');
    if (name) name.textContent = projectPath ? (projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath) : '未选择';
    return projectPath;
  }
  async function switchConversation(project) {
    const hadTask = Boolean(pendingTask || sending);
    const revision = ++conversationRevision;
    ++sendRevision;
    stopPolling();
    abortMulti();
    resetPet();
    pendingTask = null;
    sending = false;
    clearing = false;
    cancelling = false;
    historyReady = false;
    projectPath = project;
    messages.length = 0;
    input.value = '';
    consent.checked = false;
    useMemory.checked = false;
    if (useHistory) useHistory.checked = false;
    renderAll(); renderEmpty(); refresh();
    if (!project) { say('请先选择项目，再打开该项目的对话。'); return; }
    say(hadTask ? '已切换项目；原任务继续执行，可在原项目的运行页查看。' : '正在读取该项目的对话…');
    try {
      const reply = await window.workbench.chatLoad(project);
      if (revision !== conversationRevision) return;
      if (!reply?.ok || !reply.data || reply.data.corrupted) throw new Error('load failed');
      messages.push(...(reply.data.messages || []));
      historyReady = true;
      renderAll(); renderEmpty();
      say(hadTask ? '已切换项目；原任务继续执行，可在原项目的运行页查看。' : `已载入当前项目的 ${messages.length} 条对话。`);
    } catch {
      if (revision === conversationRevision) say('该项目对话读取失败或记录损坏，已暂停发送以免覆盖原记录；请重新进入对话页重试。', true);
    } finally { if (revision === conversationRevision) refresh(); }
  }
  const spaceId = () => {
    try { return window.__memoryUi?.currentSpaceId?.() || null; } catch { return null; }
  };

  // 只刷新模型下拉的显示文字（改形象 ID 后调用），不重建选项、不影响当前选择。
  function refreshModelLabels() {
    for (const sel of [modelSelect, multiSelect]) {
      if (!sel) continue;
      for (const opt of sel.options) {
        const model = loadedModels.find((m) => m.id === opt.value);
        if (model) opt.textContent = `${aliasOf(model)}${model.local ? ' · 本地' : ' · 云端'}`;
      }
    }
  }

  function refresh() {
    const multiOn = Boolean(multiToggle && multiToggle.checked) || Boolean(discussionToggle && discussionToggle.checked);
    if (multiSelect) multiSelect.hidden = !multiOn;
    const pickedCount = multiOn && multiSelect ? multiSelect.selectedOptions.length : 0;
    const modelReady = multiOn ? pickedCount >= 2 : Boolean(modelSelect.value);
    const canSend = Boolean(historyReady && !clearing && consent.checked && !consent.disabled && modelReady && input.value.trim() && projectPath && !pendingTask && !sending && !multiGroupRunning);
    sendButton.disabled = !canSend;
    // 发送选项折叠收起时，摘要要一眼看出当前发送方式。
    const summary = $('chat-options-summary');
    if (summary) {
      if (multiToggle && multiToggle.checked) summary.textContent = '多视角对比';
      else if (discussionToggle && discussionToggle.checked) summary.textContent = '讨论模式';
      else if (petToggle && petToggle.checked) summary.textContent = '桌宠陪聊';
      else summary.textContent = '普通对话';
    }
    // 清空是"自救"入口：记录损坏导致 historyReady=false 时也必须能点，
    // 否则坏文件永远删不掉，用户只能手删磁盘。
    $('chat-clear').disabled = Boolean(clearing || sending || pendingTask || !projectPath);
    // 一组多模型在跑时也要有停止入口；原来只在单聊 pendingTask 时显示，
    // 于是多个任务卡住时用户既不能取消、也不能重新发送。
    const cancelBtn = $('chat-cancel');
    cancelBtn.hidden = !pendingTask && !multiGroupRunning;
    cancelBtn.textContent = multiGroupRunning ? '停止这一组任务' : '停止当前任务';
    cancelBtn.disabled = cancelling || multiCancelling;
    if (useMemory) {
      useMemory.disabled = !spaceId();
      if (!spaceId()) memoryHint.textContent = '（还没有加载记忆空间）';
      else if (useMemory.checked) memoryHint.textContent = '将发送该空间的已发布条目（不含候选与撤回）';
      else memoryHint.textContent = '';
    }
  }

  function bubble(role, text, meta, whoLabel) {
    const empty = log.querySelector('.chat-empty');
    if (empty) empty.remove();
    const wrap = document.createElement('div');
    wrap.className = `chat-msg ${role}`;
    const who = document.createElement('span');
    who.className = 'chat-who';
    who.textContent = whoLabel || (role === 'user' ? '你' : '模型');
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

  let modelRequest = 0;
  async function loadModels() {
    if (pendingTask || sending) return false;
    const request = ++modelRequest;
    consent.checked = false;
    consent.disabled = true;
    refresh();
    $('chat-models').disabled = true;
    say('正在读取工作台模型…');
    try {
      const reply = await window.workbench.dispatchModels();
      if (request !== modelRequest) return false;
      if (!reply.ok) throw new Error(reply.error);
      const { models, defaultModel } = reply.data;
      modelSelect.replaceChildren();
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = `${aliasOf(model)}${model.local ? ' · 本地' : ' · 云端'}`;
        modelSelect.append(option);
      }
      if (defaultModel && models.some((m) => m.id === defaultModel)) modelSelect.value = defaultModel;
      loadedModels = models.slice();
      if (multiSelect) {
        // 重建选项前记住用户已勾选的模型，刷新后保留选择，不静默覆盖。
        const previouslySelected = new Set([...multiSelect.options].filter((o) => o.selected).map((o) => o.value));
        multiSelect.replaceChildren();
        for (const model of models) {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = `${aliasOf(model)}${model.local ? ' · 本地' : ' · 云端'}`;
          multiSelect.append(option);
        }
        const kept = [...multiSelect.options].filter((o) => previouslySelected.has(o.value));
        if (kept.length) kept.forEach((o) => o.selected = true);
        else for (const option of [...multiSelect.options].slice(0, 2)) option.selected = true;
      }
      consent.disabled = models.length === 0;
      say(`已读取 ${models.length} 个模型`);
      return true;
    } catch (error) {
      if (request !== modelRequest) return false;
      modelSelect.replaceChildren();
      say(`读取模型失败：${error.message}`, true);
      consent.disabled = true;
      return false;
    } finally {
      if (request === modelRequest) { $('chat-models').disabled = false; refresh(); }
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
      const packet = reply.data || {};
      const items = Array.isArray(packet.items) ? packet.items : [];
      if (items.length) {
        memoryText = packet.text;
        injected = {
          count: items.length,
          matched: packet.matched,
          items: items.map((item) => ({
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
      if (pendingTask !== taskId || !node.isConnected) return;
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
      // 桌宠陪聊：第一次拿到正文，从"思考中"切到"发言中"。
      if (activePet && !petSpoken) {
        petSpoken = true;
        clearPetStalled();
        setAgentState(activePet.modelId, 'speaking');
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

  let polling = false;
  async function poll(taskId, node) {
    if (polling || pendingTask !== taskId || document.hidden) return;
    polling = true;
    const revision = conversationRevision;
    try {
      const reply = await window.workbench.dispatchStatus(taskId);
      if (revision !== conversationRevision || pendingTask !== taskId) return;
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
      if (!['completed', 'failed', 'cancelled', 'accepted', 'blocked'].includes(state)) {
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
      // 桌宠陪聊：本轮结束，节点定格在"已回复"或"失败"；回答不重复挂（对话气泡已显示）。
      if (activePet) {
        const ok = !reply.data.exitCode && ['completed', 'accepted'].includes(state);
        setAgentState(activePet.modelId, 'done', ok ? reply.data.answer : '', false, ok ? '已回复' : '失败');
        clearPetStalled();
        activePet = null;
        petSpoken = false;
      }
      const body = node.querySelector('.chat-text');
      body.classList.remove('is-streaming');
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      const tokens = task.usage ? ` · ${task.usage.total_tokens} tokens` : '';
      if (reply.data.exitCode) {
        body.textContent = reply.data.answer || '（本次没有有效回答）';
        meta.textContent = `执行器异常退出（exit code ${reply.data.exitCode}），结果无效${tokens}`;
        meta.classList.add('is-error');
      } else if (!['completed', 'accepted'].includes(state)) {
        body.textContent = reply.data.answer || '（没有内容）';
        meta.textContent = `任务${statusText(state)}：${task.error || '没有更多信息'}${tokens}`;
        meta.classList.add('is-error');
      } else {
        body.textContent = reply.data.answer || '（日志里没有可读文本）';
        meta.textContent = `${statusText(state)} · ${task.model_name || task.model_id || ''}${tokens}`;
        // 只有成功且非空才进历史，失败的回答不能污染下一轮。
        if (reply.data.answer && reply.data.answer.trim()) {
          messages.push({ role: 'assistant', text: reply.data.answer.trim() });
          persist();
        }
      }
      node.append(meta);
      log.scrollTop = log.scrollHeight;
    } catch (error) {
      if (revision === conversationRevision && pendingTask === taskId) say('查询暂时失败，保留原任务并继续查询；不会重新派发。', true);
    } finally {
      polling = false;
      refresh();
    }
  }

  async function send() {
    if (multiToggle && multiToggle.checked) return sendMulti();
    if (discussionToggle && discussionToggle.checked) return sendDiscussion();
    const text = input.value.trim();
    if (!historyReady || clearing || !text || !consent.checked || consent.disabled || !modelSelect.value || pendingTask || sending) return;
    sending = true; // Lock before the first await, not after obtaining a task ID.
    const revision = sendRevision;
    const conversation = conversationRevision;
    const modelId = modelSelect.value;
    const project = projectPath;
    const memorySpace = spaceId();
    const memoryEnabled = useMemory.checked;
    const historyEnabled = Boolean(useHistory?.checked);
    const validate = () => {
      if (revision !== sendRevision || !consent.checked || modelSelect.value !== modelId ||
          projectPath !== project || (memoryEnabled && spaceId() !== memorySpace) ||
          useMemory.checked !== memoryEnabled || Boolean(useHistory?.checked) !== historyEnabled) {
        throw new Error('发送范围或确认已改变，请重新确认后发送。');
      }
    };
    let node = null;
    refresh();
    try {
      await syncProject();
      if (!project) throw new Error('请先选择项目文件夹。');
      validate();
      const history = historyEnabled
        ? window.__chatPrompt.buildHistory(messages, window.__chatPrompt.DEFAULT_HISTORY_CHARS)
        : { text: '', included: 0, omitted: 0 };
      const { prompt, injected } = await composePrompt(text, history);
      await syncProject();
      validate();
      input.value = '';
      messages.push({ role: 'user', text });
      persist();
      bubble('user', text);
      node = bubble('assistant', '正在派发…', '', aliasOf(loadedModels.find((m) => m.id === modelId) || { id: modelId }));
      say('正在派发…');
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
      const reply = await window.workbench.dispatchSend({ prompt, modelId, kind: 'chat', project });
      if (conversation !== conversationRevision) return;
      if (!reply.ok) throw new Error(reply.error);
      pendingTask = reply.data.id;
      say(`已派发：${pendingTask}（${reply.data.status || 'queued'}）`);
      // 桌宠陪聊：单个模型也显示一个桌宠节点，状态跟随"思考→说话→已回复"。
      if (petToggle && petToggle.checked && stage) {
        const model = loadedModels.find((m) => m.id === modelId);
        activePet = { modelId, modelName: model ? aliasOf(model) : modelId };
        petSpoken = false;
        renderStage([model || { id: modelId, name: activePet.modelName }]);
        setAgentState(modelId, 'thinking');
        // A07：8 秒日志仍无正文就如实说「等待中：日志暂无正文」。
        clearPetStalled();
        petStalledTimer = setTimeout(() => {
          if (activePet && !petSpoken) setAgentState(activePet.modelId, 'stalled');
        }, 8000);
      }
      timer = setInterval(() => poll(pendingTask, node), 2000);
      liveDelay = LIVE_FAST_MS;
      idleStreak = 0;
      taskStartedAt = Date.now();
      scheduleLogPoll(pendingTask, node);
      pullLog(pendingTask, node);
      poll(pendingTask, node);
    } catch (error) {
      if (conversation !== conversationRevision) return;
      if (node) {
        node.querySelector('.chat-text').textContent = '派发未确认，请先检查任务记录再决定是否重试。';
        const meta = document.createElement('div');
        meta.className = 'chat-meta is-error';
        meta.textContent = error.message;
        node.append(meta);
      }
      say(`发送失败：${error.message}`, true);
      pendingTask = null;
    } finally {
      if (conversation === conversationRevision) { sending = false; refresh(); }
    }
  }


  // ---------- 多视角对比 ----------
  const BRANCH_LABEL = { queued: '排队中', running: '生成中', done: '已完成', failed: '失败' };

  function branchCard(branch) {
    const card = document.createElement('div');
    card.className = 'chat-branch';
    card.dataset.branch = branch.key;
    const head = document.createElement('div');
    head.className = 'chat-branch-head';
    const name = document.createElement('strong');
    name.textContent = branch.modelName;
    const state = document.createElement('span');
    state.textContent = BRANCH_LABEL.queued;
    head.append(name, state);
    const body = document.createElement('div');
    body.className = 'chat-branch-body';
    body.textContent = '等待派发…';
    const foot = document.createElement('div');
    foot.className = 'chat-branch-foot';
    const meta = document.createElement('span');
    meta.textContent = branch.local ? '本机模型' : '云端模型';
    const adopt = document.createElement('button');
    adopt.type = 'button';
    adopt.className = 'ghost';
    adopt.textContent = '用这条继续';
    adopt.disabled = true;
    adopt.addEventListener('click', () => adoptBranch(branch, card));
    foot.append(meta, adopt);
    card.append(head, body, foot);
    return { card, state, body, meta, adopt };
  }

  function paintBranch(branch, ui) {
    ui.state.textContent = BRANCH_LABEL[branch.status] || branch.status;
    if (branch.status === 'failed' && branch.error) ui.body.textContent = branch.error;
    else if (branch.answer) ui.body.textContent = branch.answer;
    ui.card.classList.toggle('is-done', branch.status === 'done');
    ui.card.classList.toggle('is-failed', branch.status === 'failed');
    if (branch.tokens) ui.meta.textContent = `${branch.local ? '本机' : '云端'} · ${branch.tokens} tokens`;
    ui.adopt.disabled = !(branch.status === 'done' && String(branch.answer || '').trim()) || ui.card.dataset.adopted === '1';
  }

  function adoptBranch(branch, card) {
    const answer = String(branch.answer || '').trim();
    if (!answer) return;
    messages.push({ role: 'assistant', text: answer, meta: `来自 ${branch.modelName}` });
    persist();
    for (const other of log.querySelectorAll('.chat-branch')) {
      const button = other.querySelector('.chat-branch-foot button');
      if (button) button.disabled = true;
    }
    card.dataset.adopted = '1';
    say(`已采纳「${branch.modelName}」的回答；其他视角不写进历史。`);
  }

  async function watchBranch(branch, ui, prompt, gen = multiGeneration) {
    const multi = window.__chatMulti;
    if (gen !== multiGeneration) return;
    try {
      const reply = await window.workbench.dispatchSend({ prompt, modelId: branch.modelId, kind: 'chat', project: projectPath });
      // 等 IPC 回包期间可能已经点了停止／切了项目，别再把这一支派出去。
      if (gen !== multiGeneration) return;
      if (!reply || !reply.ok) {
        multi.applyStatus(branch, { state: 'failed', error: (reply && reply.error) || '派发失败' });
        paintBranch(branch, ui);
        return;
      }
      branch.taskId = reply.data.id;
      multiTaskIds.add(branch.taskId);
      multi.applyStatus(branch, { state: reply.data.status || 'queued' });
      paintBranch(branch, ui);
      await new Promise((resolve) => {
        let logTimer = null;
        let statusTimer = null;
        let waitTimer = null;
        const finish = () => {
          multiFinishers.delete(finish);
          if (logTimer) clearInterval(logTimer);
          if (statusTimer) clearInterval(statusTimer);
          if (waitTimer) clearTimeout(waitTimer);
          logTimer = null; statusTimer = null; waitTimer = null;
          resolve();
        };
        multiFinishers.add(finish);
        // 面板掉线、任务一直 running 或状态接口持续报错时，不能让这一支永远挂住：
        // 到点如实标成「没等到终态」，让整组的 Promise.all 收敛。
        waitTimer = setTimeout(() => {
          multi.markWaitTimeout(branch, multi.WAIT_TIMEOUT_MS);
          paintBranch(branch, ui);
          finish();
        }, multi.WAIT_TIMEOUT_MS);
        logTimer = setInterval(async () => {
          if (gen !== multiGeneration) { finish(); return; }
          if (!branch.taskId || document.hidden) return;
          try {
            const live = await window.workbench.dispatchLog(branch.taskId);
            if (live && live.ok) {
              const text = String(live.data.answer || '').trim();
              if (text && text !== branch.answer) { branch.answer = text; paintBranch(branch, ui); }
            }
          } catch {}
        }, 500);
        statusTimer = setInterval(async () => {
          if (gen !== multiGeneration) { finish(); return; }
          try {
            const status = await window.workbench.dispatchStatus(branch.taskId);
            if (!status || !status.ok) return;
            const task = status.data.task;
            multi.applyStatus(branch, {
              state: task ? (task.status || task.phase) : 'running',
              answer: status.data.answer,
              exitCode: status.data.exitCode,
              tokens: task && task.usage ? task.usage.total_tokens : null,
            });
            paintBranch(branch, ui);
            if (multi.isSettled(branch)) finish();
          } catch {}
        }, 2000);
      });
    } catch (error) {
      multi.applyStatus(branch, { state: 'failed', error: error.message });
      paintBranch(branch, ui);
    }
  }

  async function sendMulti() {
    const multi = window.__chatMulti;
    const text = input.value.trim();
    if (!historyReady || clearing || !text || !consent.checked || consent.disabled || pendingTask || sending || multiGroupRunning) return;
    if (!projectPath) { say('请先选择项目文件夹。', true); return; }
    const chosen = multi.pickModels(loadedModels, multiSelect ? [...multiSelect.selectedOptions].map((option) => option.value) : []).map((m) => ({ ...m, name: aliasOf(m) }));
    if (chosen.length < 2) { say('多视角至少需要两个可用模型：先读模型，再勾两个。', true); return; }

    const gen = multiGeneration;
    multiTaskIds.clear();
    multiGroupRunning = true;
    refresh();
    const history = useHistory && useHistory.checked
      ? window.__chatPrompt.buildHistory(messages, window.__chatPrompt.DEFAULT_HISTORY_CHARS)
      : { text: '', included: 0, omitted: 0 };
    messages.push({ role: 'user', text });
    persist();
    input.value = '';
    bubble('user', text);

    const branches = chosen.map(multi.createBranch);
    const wrap = document.createElement('div');
    wrap.className = 'chat-branches';
    const uis = branches.map((branch) => {
      const ui = branchCard(branch);
      wrap.append(ui.card);
      return ui;
    });
    log.append(wrap);
    log.scrollTop = log.scrollHeight;
    say(`${branches.length} 个视角已排队：本机队列串行，会依次执行。`);

    try {
      const { prompt } = await composePrompt(text, history);
      // 停止/切页可能落在 composePrompt 的 await 窗口里，此时不能再派发。
      if (gen !== multiGeneration) return;
      await Promise.all(branches.map((branch, index) => watchBranch(branch, uis[index], prompt, gen)));
      const summary = multi.summarize(branches);
      if (gen === multiGeneration) say(`全部结束：成功 ${summary.done} 个 / 失败 ${summary.failed} 个。选一条「用这条继续」写进历史。`);
    } catch (error) {
      say(`多视角发送失败：${error.message}`, true);
    } finally {
      multiGroupRunning = false;
      multiTaskIds.clear();
      refresh();
    }
  }

  // ---------- 讨论场景：多个 Agent 角色可视化 ----------
  // 形象统一走 __avatars：默认拟人角色，状态切换换成对应动作图；点头像循环换形象。
  const AVATARS = window.__avatars;
  const petModels = new Map();

  function petKey(modelId) { return 'pet-avatar:' + modelId; }

  function currentPet(modelId) {
    const model = petModels.get(modelId) || { id: modelId };
    const fallback = AVATARS ? AVATARS.defaultChoice(model) : 'emoji:🐳';
    try { return localStorage.getItem(petKey(modelId)) || fallback; } catch { return fallback; }
  }

  function renderAvatar(avatar, modelId) {
    const node = avatar.closest('.agent-node');
    const state = node ? node.dataset.state : 'waiting';
    const model = petModels.get(modelId) || { id: modelId };
    if (AVATARS) {
      avatar.dataset.modelId = modelId;
      avatar.dataset.kind = AVATARS.mount(avatar, model, currentPet(modelId), { imgClass: 'avatar-figure agent-pet', state });
      return;
    }
    avatar.textContent = '🐳';
  }

  function cyclePet(modelId, avatar) {
    const model = petModels.get(modelId) || { id: modelId };
    const options = AVATARS ? AVATARS.optionsFor(model) : ['emoji:🐳'];
    const idx = options.indexOf(currentPet(modelId));
    try { localStorage.setItem(petKey(modelId), options[(idx + 1) % options.length]); } catch {}
    renderAvatar(avatar, modelId);
  }

  function renderStage(models) {
    if (!stage) return;
    stage.replaceChildren();
    for (const model of models) {
      petModels.set(model.id, model);
      const node = document.createElement('div');
      node.className = 'agent-node';
      node.dataset.state = 'waiting';
      node.dataset.modelId = model.id;
      const avatar = document.createElement('div');
      avatar.className = 'agent-avatar';
      avatar.addEventListener('click', () => cyclePet(model.id, avatar));
      renderAvatar(avatar, model.id);
      const name = document.createElement('div');
      name.className = 'agent-name';
      name.textContent = model.name;
      const stateEl = document.createElement('div');
      stateEl.className = 'agent-state';
      stateEl.textContent = '等待中';
      node.append(avatar, name, stateEl);
      stage.append(node);
    }
    stage.hidden = false;
  }

  function setAgentState(modelId, state, answer, withBubble = true, labelOverride = null) {
    if (!stage) return;
    const node = stage.querySelector(`.agent-node[data-model-id="${CSS.escape(modelId)}"]`);
    if (!node) return;
    node.dataset.state = state;
    const stateEl = node.querySelector('.agent-state');
    const label = { waiting: '等待中', thinking: '思考中…', speaking: '发言中', stalled: '等待中：日志暂无正文', failed: '未拿到结果', done: '已发言' };
    if (stateEl) stateEl.textContent = labelOverride || label[state] || state;
    const avatar = node.querySelector('.agent-avatar');
    if (avatar && AVATARS) {
      AVATARS.updateState(avatar, currentPet(modelId), state, 'discuss');
    }
    if (state === 'done' && withBubble) {
      let bubble = node.querySelector('.agent-bubble');
      if (!bubble) { bubble = document.createElement('div'); bubble.className = 'agent-bubble'; node.append(bubble); }
      bubble.textContent = answer || '（没有有效发言）';
    }
  }

  // ---------- 讨论模式 ----------
  // 多个模型串行发言，每位能看到前面所有发言；返回该位模型的非空回答，否则 null。
  async function runDiscussionTurn(model, prompt, onState, gen = multiGeneration) {
    const multi = window.__chatMulti;
    if (gen !== multiGeneration) return null;
    const branch = multi.createBranch(model, 0);
    const reply = await window.workbench.dispatchSend({ prompt, modelId: model.id, kind: 'chat', project: projectPath });
    if (gen !== multiGeneration) return null;
    if (!reply || !reply.ok) { if (onState) onState('done'); return null; }
    branch.taskId = reply.data.id;
    multiTaskIds.add(branch.taskId);
    multi.applyStatus(branch, { state: reply.data.status || 'queued' });
    if (onState) onState('thinking');
    await new Promise((resolve) => {
      let logTimer = null;
      let statusTimer = null;
      let stalledTimer = null;
      let waitTimer = null;
      let hasSpoken = false;
      const finish = () => {
        // 讨论的 finish 原来没登记，切页/切项目时要等下一次 interval 才停；
        // 现在和 watchBranch 一样由 abortMulti 统一中止。
        multiFinishers.delete(finish);
        if (logTimer) clearInterval(logTimer);
        if (statusTimer) clearInterval(statusTimer);
        if (stalledTimer) clearTimeout(stalledTimer);
        if (waitTimer) clearTimeout(waitTimer);
        resolve();
      };
      multiFinishers.add(finish);
      waitTimer = setTimeout(() => {
        multi.markWaitTimeout(branch, multi.WAIT_TIMEOUT_MS);
        if (onState) onState('failed');
        finish();
      }, multi.WAIT_TIMEOUT_MS);
      // A07：等了很久日志还没有正文，如实说「等待中：日志暂无正文」，不假装在思考。
      stalledTimer = setTimeout(() => {
        if (gen === multiGeneration && !hasSpoken && onState) onState('stalled');
      }, 8000);
      logTimer = setInterval(async () => {
        if (gen !== multiGeneration) { finish(); return; }
        if (!branch.taskId || document.hidden) return;
        try {
          const live = await window.workbench.dispatchLog(branch.taskId);
          if (live && live.ok) { const text = String(live.data.answer || '').trim(); if (text) { branch.answer = text; if (!hasSpoken) { hasSpoken = true; if (onState) onState('speaking'); } } }
        } catch {}
      }, 500);
      statusTimer = setInterval(async () => {
        if (gen !== multiGeneration) { finish(); return; }
        try {
          const status = await window.workbench.dispatchStatus(branch.taskId);
          if (!status || !status.ok) return;
          const task = status.data.task;
          multi.applyStatus(branch, { state: task ? (task.status || task.phase) : 'running', answer: status.data.answer, exitCode: status.data.exitCode, tokens: task && task.usage ? task.usage.total_tokens : null });
          if (multi.isSettled(branch)) finish();
        } catch {}
      }, 2000);
    });
    if (branch.status !== 'done' || !String(branch.answer || '').trim()) return null;
    return { answer: String(branch.answer).trim(), tokens: branch.tokens };
  }

  // 讨论发言的"采纳"按钮：把某位模型的发言写进历史，后续追问能带上它。
  function discussionAdoptButton(modelName, answer) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-adopt';
    btn.textContent = '采纳这条继续';
    btn.addEventListener('click', () => {
      messages.push({ role: 'assistant', text: answer, meta: `讨论 · ${modelName}` });
      persist();
      for (const b of log.querySelectorAll('.chat-adopt')) b.disabled = true;
      say(`已采纳「${modelName}」的发言；继续追问会带上它。`);
    });
    return btn;
  }

  async function sendDiscussion() {
    const multi = window.__chatMulti;
    const text = input.value.trim();
    if (!historyReady || clearing || !text || !consent.checked || consent.disabled || pendingTask || sending || multiGroupRunning) {
      if (multiGroupRunning) say('上一组多视角还没结束，请稍候再开始讨论。', true);
      else if (!consent.checked || consent.disabled) say('请先勾选确认，再发送讨论。', true);
      else say('讨论未发送：请检查模型选择与内容。', true);
      return;
    }
    if (!projectPath) { say('请先选择项目文件夹。', true); return; }
    const chosen = multi.pickModels(loadedModels, multiSelect ? [...multiSelect.selectedOptions].map((o) => o.value) : []).map((m) => ({ ...m, name: aliasOf(m) }));
    if (chosen.length < 2) { say('讨论至少需要两个可用模型：先读模型，再勾两个。', true); return; }

    const gen = multiGeneration;
    multiTaskIds.clear();
    multiGroupRunning = true;
    refresh();
    messages.push({ role: 'user', text });
    persist();
    input.value = '';
    bubble('user', text);

    const spoken = [];
    renderStage(chosen);
    say(`讨论开始：${chosen.length} 位模型依次发言，每位能看到前面的发言。`);
    try {
      for (const model of chosen) {
        // 停止之后不能继续让下一位发言，否则「停止」只是停了界面，任务照样排队。
        if (gen !== multiGeneration) break;
        say(`讨论中：${model.name} 正在发言…`);
        setAgentState(model.id, 'thinking');
        const prompt = window.__chatMulti.buildDiscussionPrompt({ question: text, spoken });
        const result = await runDiscussionTurn(model, prompt, (state) => setAgentState(model.id, state), gen);
        if (result) {
          spoken.push({ modelName: model.name, text: result.answer });
          setAgentState(model.id, 'done', result.answer);
          const wrap = bubble('assistant', result.answer, result.tokens ? `${result.tokens} tokens` : '', `讨论 · ${model.name}`);
          wrap.append(discussionAdoptButton(model.name, result.answer));
        } else {
          setAgentState(model.id, 'done', '（没有有效发言）');
          bubble('assistant', '（这位模型没有给出有效发言）', '', `讨论 · ${model.name}`);
        }
      }
      if (gen === multiGeneration) say(`讨论结束，${spoken.length}/${chosen.length} 位已发言。`);
    } catch (error) {
      say(`讨论失败：${error.message}`, true);
    } finally {
      multiGroupRunning = false;
      multiTaskIds.clear();
      refresh();
    }
  }

  // 导航：切到对话时隐藏其他页，切走时隐藏自己。
  const PAGES = ['memory-page', 'tasks-page', 'designer-page', 'chat-page', 'models-page', 'stage-page'];
  function showChat() {
    syncProject().then(() => { if (projectPath && !historyReady) switchConversation(projectPath); });
    window.__modelsUi?.hide();
    for (const id of PAGES) { const el = $(id); if (el) el.hidden = id !== 'chat-page'; }
    for (const b of document.querySelectorAll('.nav-button')) b.classList.toggle('active', b.id === 'nav-chat');
    refresh();
  }
  function hideChat() {
    const el = $('chat-page');
    if (el) el.hidden = true;
    $('nav-chat')?.classList.remove('active');
    // 页面切走就停轮询：任务还在跑，但没必要继续拉隐藏页的 DOM 和 IPC。
    stopPolling();
    abortMulti();
    resetPet();
  }
  $('nav-chat').addEventListener('click', () => { hideChat(); showChat(); });
  for (const id of ['nav-memory', 'nav-tasks', 'nav-designer', 'nav-panel', 'nav-stage']) {
    const button = $(id);
    if (button) button.addEventListener('click', hideChat);
  }

  $('chat-models').addEventListener('click', loadModels);
  // 网页 AI：每次打开都要过一遍风险确认，不做"记住选择"。
  $('chat-webai').addEventListener('click', () => {
    const error = $('webai-error');
    if (error) error.textContent = '';
    $('webai-dialog')?.showModal();
  });
  $('webai-confirm').addEventListener('click', async () => {
    const picked = document.querySelector('input[name="webai-target"]:checked');
    const url = picked ? picked.value : '';
    const button = $('webai-confirm');
    button.disabled = true;
    try {
      const reply = await window.workbench.webaiOpen(url);
      if (!reply || !reply.ok) throw new Error((reply && reply.error) || '打开失败。');
      $('webai-dialog').close();
      say(`已打开第三方网页 AI（${reply.data.host}）：它不经过本工作台，回复不会自动带回这里。`);
    } catch (error) {
      $('webai-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  // 复用任务页那套原生目录选择：不另写一份选择逻辑，避免两处行为不一致。
  $('chat-project').addEventListener('click', () => {
    const choose = $('choose');
    if (choose) choose.click();
    setTimeout(async () => { await syncProject(); refresh(); }, 800);
  });
  function invalidateSend() { sendRevision++; refresh(); }
  consent.addEventListener('change', invalidateSend);
  useMemory.addEventListener('change', () => { consent.checked = false; invalidateSend(); });
  if (useHistory) useHistory.addEventListener('change', () => { consent.checked = false; invalidateSend(); });
  modelSelect.addEventListener('change', () => { consent.checked = false; invalidateSend(); });
  if (multiToggle) multiToggle.addEventListener('change', () => { if (multiToggle.checked) { if (discussionToggle) discussionToggle.checked = false; if (petToggle) petToggle.checked = false; } refresh(); });
  if (discussionToggle) discussionToggle.addEventListener('change', () => { if (discussionToggle.checked) { if (multiToggle) multiToggle.checked = false; if (petToggle) petToggle.checked = false; } refresh(); });
  if (petToggle) petToggle.addEventListener('change', () => { if (petToggle.checked) { if (multiToggle) multiToggle.checked = false; if (discussionToggle) discussionToggle.checked = false; } refresh(); });
  if (multiSelect) multiSelect.addEventListener('change', refresh);
  input.addEventListener('input', invalidateSend);
  window.addEventListener('workbench-project-changed', () => {
    consent.checked = false; invalidateSend(); syncProject().then(refresh);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); }
  });
  sendButton.addEventListener('click', send);
  // 停止一组多模型任务：逐个对已派发的 id 请求取消，再停掉本地轮询。
  // 「请求已发出」不等于「任务已停止」，确认与未确认分开报，不冒充成功。
  async function cancelGroup() {
    if (multiCancelling) return;
    const ids = [...multiTaskIds];
    const gen = multiGeneration;
    let ok = 0;
    let failed = 0;
    multiCancelling = true;
    refresh();
    for (const id of ids) {
      try {
        const reply = await window.workbench.dispatchCancel(id);
        if (reply && reply.ok) ok += 1; else failed += 1;
      } catch { failed += 1; }
      if (gen !== multiGeneration) return; // 切页/切项目已接管
    }
    abortMulti();
    say(window.__chatMulti.groupCancelMessage({ ok, failed, total: ids.length }), failed > 0);
    refresh();
  }

  $('chat-cancel').addEventListener('click', async () => {
    if (multiGroupRunning) { await cancelGroup(); return; }
    if (!pendingTask || cancelling) return;
    const id = pendingTask, revision = conversationRevision;
    cancelling = true; refresh();
    try {
      await syncProject();
      if (revision !== conversationRevision || pendingTask !== id) return;
      const reply = await window.workbench.dispatchCancel(id);
      if (revision !== conversationRevision || pendingTask !== id) return;
      if (!reply?.ok) throw new Error('cancel failed');
      say('已请求停止；继续查询原任务，等待执行器确认结束。');
    } catch {
      if (revision === conversationRevision) say('停止请求未确认，原任务仍保留；请查看任务状态后再操作。', true);
    } finally { if (revision === conversationRevision) { cancelling = false; refresh(); } }
  });
  $('chat-clear').addEventListener('click', async () => {
    if (clearing || sending || pendingTask) return;
    const revision = conversationRevision;
    clearing = true; refresh();
    try {
      const reply = await window.workbench.chatClear(projectPath);
      if (revision !== conversationRevision) return;
      if (!reply?.ok) throw new Error('clear failed');
      messages.length = 0;
      log.replaceChildren();
      stopPolling();
      resetPet();
      pendingTask = null;
      historyReady = true; // 坏记录已删除，允许重新开始
      say('对话已清空（本机记录也已删除；任务记录不受影响）。');
      renderEmpty();
    } catch { if (revision === conversationRevision) say('清空失败，保留当前对话，请稍后重试。', true); }
    finally { if (revision === conversationRevision) { clearing = false; refresh(); } }
  });

  syncProject().then(refresh);
  async function selectModel(id) {
    if (pendingTask || sending) { say('当前对话任务正在准备或执行，结束后再切换模型。', true); return false; }
    if (!await loadModels()) return false;
    if (![...modelSelect.options].some(option => option.value === id)) {
      modelSelect.value = ''; consent.checked = false; refresh();
      say('该模型已停用或不可用，请重新选择。', true); return false;
    }
    modelSelect.value = id; consent.checked = false; refresh();
    say('已选择模型。确认发送范围后再发送消息。');
    return true;
  }
  window.__chatUi = { send, selectModel, hidePage: hideChat, refreshModelLabels, state: () => ({ messages: messages.length, pendingTask }) };
})();
