(() => {
  const $ = (id) => document.getElementById(id);
  const kindLabels = { project: '项目记忆', shared: '本机公共池', special: '专用记忆' };
  const statusLabels = { candidate: '待确认', published: '已发布 · 本机', retracted: '已撤回' };
  let state = null;
  let selectedId = null;
  let selectedSection = null;
  let formContext = null;
  let entryContext = null;
  let proposalId = null;
  let exportedSpaceId = null;
  let retractContext = null;
  let packetContext = null;
  let packetId = null;
  let proposalRequest = 0;
  const dirtyDialogs = new Set();
  const picked = new Set();
  let lastFiltered = [];
  let batchRetract = false;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function button(text, action, className = '') {
    const element = node('button', className, text);
    element.type = 'button';
    element.addEventListener('click', async () => {
      element.disabled = true;
      try { await action(); } catch (error) { message(error.message, true); }
      finally { element.disabled = false; }
    });
    return element;
  }
  async function result(promise) {
    const reply = await promise;
    if (!reply.ok) throw new Error(reply.error || '操作失败，原内容未更新。');
    return reply.data;
  }
  function current() { return state?.spaces.find((space) => space.id === selectedId); }
  function message(text, error = false) {
    $('memory-message').textContent = text;
    $('memory-message').classList.toggle('error', error);
  }
  function page(name) {
    window.__modelsUi?.hide();
    window.__workbenchShell?.hideAdvanced();
    $('designer-page').hidden = true;
    $('nav-designer').classList.remove('active');
    // 对话页由 chat-ui 自己管理：切走时必须让它一起收起，避免页面叠加。
    window.__chatUi?.hidePage?.();
    $('memory-page').hidden = name !== 'memory';
    $('tasks-page').hidden = name !== 'tasks';
    $('nav-memory').classList.toggle('active', name === 'memory');
    $('nav-tasks').classList.toggle('active', name === 'tasks');
  }
  function selectSpace(id) {
    selectedId = id;
    picked.clear();
    $('memory-map').textContent = '点击刷新，查看当前空间的关系图。';
    selectedSection = null;
    $('memory-search').value = '';
    $('status-filter').value = 'active';
    page('memory');
    render();
    message('已切换空间；其他空间的记忆保持独立。');
  }
  async function reload() {
    state = await result(window.workbench.memorySnapshot());
    if (!state.spaces.some((space) => space.id === selectedId)) selectedId = state.spaces[0]?.id;
    render();
  }
  async function execute(command) {
    state = await result(window.workbench.memoryExecute(command));
    render();
  }
  function render() {
    const space = current();
    if (!space) return;
    $('space-list').replaceChildren();
    for (const item of state.spaces) {
      const itemButton = button(item.name, () => selectSpace(item.id), `space-button${item.id === selectedId ? ' selected' : ''}`);
      itemButton.dataset.spaceId = item.id;
      itemButton.setAttribute('aria-current', item.id === selectedId ? 'true' : 'false');
      itemButton.append(node('small', '', `${kindLabels[item.kind]} · ${item.entries.filter((entry) => entry.status !== 'retracted').length} 条`));
      $('space-list').append(itemButton);
    }
    $('space-name').textContent = space.name;
    $('space-kind').textContent = kindLabels[space.kind];
    $('space-description').textContent = space.kind === 'shared'
      ? '由你手动整理的本机共享内容，尚未开放给 AI 或云端。'
      : space.kind === 'special' ? '为特定用途保存独立记忆，与其他项目分开。' : '目标、决定、进度和下一步，都留在这个项目里。';
    $('revision-label').textContent = `已保存 · 版本 ${state.revision}`;
    $('published-count').textContent = space.entries.filter((entry) => entry.status === 'published').length;
    $('candidate-count').textContent = space.entries.filter((entry) => entry.status === 'candidate').length;
    const used = space.entries.reduce((sum, entry) => sum + [...entry.body].length, 0);
    $('capacity-count').textContent = `${used.toLocaleString()} / ${space.capacityChars.toLocaleString()}`;
    $('capacity-meter').max = space.capacityChars;
    $('capacity-meter').value = used;
    $('context-count').textContent = `上下文预算：${space.contextChars.toLocaleString()} 字符 · 设置待接入`;
    if (selectedSection && !space.sections.includes(selectedSection)) selectedSection = null;
    $('architecture').replaceChildren();
    for (const [index, section] of space.sections.entries()) {
      const card = button('', () => { selectedSection = section; render(); }, `arch-node${selectedSection === section ? ' active' : ''}`);
      card.append(node('div', 'node-number', String(index + 1).padStart(2, '0')),
        node('strong', '', section), node('span', '', `${space.entries.filter((entry) => entry.section === section && entry.status !== 'retracted').length} 条记忆 →`));
      $('architecture').append(card);
    }
    renderEntries();
  }
  function renderEntries() {
    const space = current();
    if (!space) return;
    $('entries-heading').textContent = selectedSection || '全部记忆';
    const query = $('memory-search').value.trim().toLocaleLowerCase();
    const filter = $('status-filter').value;
    const entries = space.entries.filter((entry) => (!selectedSection || entry.section === selectedSection)
      && (filter === 'active' ? entry.status !== 'retracted' : entry.status === filter)
      && (!query || [entry.title, entry.body, entry.source].join('\n').toLocaleLowerCase().includes(query)));
    $('entries').replaceChildren();
    lastFiltered = entries;
    if (!entries.length) {
      const empty = node('div', 'empty-state');
      empty.append(node('strong', '', space.entries.length ? '没有符合条件的记忆' : '这个空间还没有记忆'),
        node('p', '', space.entries.length ? '调整栏目、状态或搜索词试试。搜索只发生在当前空间。' : '从一条目标、一个决定或下一步待办开始。点击右上角「添加记忆」。'));
      $('entries').append(empty);
    }
    for (const entry of entries) {
      const card = node('article', 'entry-card');
      card.dataset.entryId = entry.id;
      card.classList.toggle('picked', picked.has(entry.id));
      const top = node('div', 'entry-top');
      if (entry.status !== 'retracted') {
        const check = node('input', 'entry-check');
        check.type = 'checkbox';
        check.checked = picked.has(entry.id);
        check.setAttribute('aria-label', `选择「${entry.title}」`);
        check.dataset.entryCheck = entry.id;
        check.addEventListener('change', () => {
          if (check.checked) picked.add(entry.id); else picked.delete(entry.id);
          card.classList.toggle('picked', check.checked);
          updateBatchBar();
        });
        top.append(check);
      }
      top.append(node('strong', '', entry.title), node('span', `entry-badge ${entry.status}`, statusLabels[entry.status]));
      card.append(top, node('div', 'entry-body', entry.body),
        node('div', 'entry-meta', `${entry.section} · v${entry.version} · 来源：${entry.source || '尚未填写'}`));
      if (entry.status === 'retracted' && entry.retractReason) {
        card.append(node('div', 'entry-meta', `撤回原因：${entry.retractReason}${entry.retractedAt ? ' · ' + new Date(entry.retractedAt).toLocaleString() : ''}`));
      }
      const actions = node('div', 'entry-actions');
      if (entry.status !== 'retracted') {
        actions.append(button('编辑', () => editEntry(entry)));
        if (entry.status === 'candidate') actions.append(button('确认并发布', async () => {
          if (!entry.source.trim()) throw new Error('请先编辑并填写来源或核实依据，再确认发布。');
          await execute({ type: 'publishEntry', spaceId: space.id, entryId: entry.id, expectedRevision: state.revision });
          message('已发布到本机空间；不会自动共享给 AI 或外发。');
        }));
        actions.append(button('撤回', () => {
          batchRetract = false;
          retractContext = { spaceId: space.id, entryId: entry.id, revision: state.revision };
          $('retract-title').textContent = entry.title;
          $('retract-reason').value = '';
          $('retract-error').textContent = '';
          $('retract-dialog').showModal();
        }));
      } else {
        actions.append(button('复制为新候选', () => editEntry({ ...entry, id: undefined })));
      }
      card.append(actions);
      $('entries').append(card);
    }
    updateBatchBar();
  }
  function updateBatchBar() {
    const space = current();
    if (!space) return;
    const alive = new Set(space.entries.filter((entry) => entry.status !== 'retracted').map((entry) => entry.id));
    for (const id of [...picked]) if (!alive.has(id)) picked.delete(id);
    const selectable = lastFiltered.filter((entry) => entry.status !== 'retracted');
    const allPicked = selectable.length > 0 && selectable.every((entry) => picked.has(entry.id));
    const pickAll = $('pick-all');
    pickAll.checked = allPicked;
    pickAll.disabled = selectable.length === 0;
    pickAll.indeterminate = !allPicked && selectable.some((entry) => picked.has(entry.id));
    $('batch-bar').hidden = picked.size === 0;
    $('batch-count').textContent = `已选 ${picked.size} 条`;
  }
  // CTX-03：把「这次到底注入了哪几条」列出来，可追溯、能看出裁剪。
  function renderManifest(packet) {
    const box = $('packet-manifest');
    if (!box) return;
    box.replaceChildren();
    box.hidden = false;
    const head = node('div', 'pm-head');
    const dropped = Number.isInteger(packet.dropped) ? packet.dropped : 0;
    head.append(
      node('strong', '', `注入清单 · 收录 ${packet.items.length} 条 / 命中 ${packet.matched ?? packet.items.length} 条`),
      node('span', 'pm-note', dropped > 0
        ? `裁掉 ${dropped} 条：预算 ${packet.budgetChars} 字符，单次最多 10 条`
        : `未裁剪 · 预算 ${packet.budgetChars} 字符`),
    );
    box.append(head);
    if (!packet.items.length) {
      box.append(node('p', 'hint', '没有收录任何片段，正文里不会出现记忆内容。'));
      return;
    }
    packet.items.forEach((item, index) => {
      const row = node('div', 'pm-row');
      row.append(
        node('span', 'pm-index', String(index + 1)),
        node('span', 'pm-title', item.title),
        node('span', 'pm-meta', `ID ${String(item.id).slice(0, 8)}… · v${item.version} · ${item.excerptChars ?? '?'} 字符 · 来源：${item.source || '未填'}`),
      );
      box.append(row);
    });
    box.append(node('p', 'pm-note', `合计 ${packet.usedChars} 字符，约 ${estimateTokens(packet.text)} tokens（中文 1 字≈1、其他 4 字符≈1，粗估；实际以模型分词为准，不代表计费）。`));
  }
  // 粗估：中文/日文/韩文按 1 字 1 token，其余按 4 字符 1 token。
  function estimateTokens(text) {
    const source = typeof text === 'string' ? text : '';
    const cjk = (source.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    return cjk + Math.ceil((source.length - cjk) / 4);
  }
  function clearManifest() {
    const box = $('packet-manifest');
    if (!box) return;
    box.hidden = true;
    box.replaceChildren();
  }
  function editSpace(create = false, shared = false) {
    if (!state) return;
    const space = current();
    const sharedOption = $('space-form-kind').querySelector('[value=shared]');
    sharedOption.hidden = !shared; sharedOption.disabled = !shared;
    $('space-form-kind').value = shared ? 'shared' : 'project';
    formContext = { create, spaceId: space.id, revision: state.revision };
    $('space-dialog-title').textContent = create ? '新建记忆空间' : '编辑记忆架构';
    $('space-form-name').value = create ? '' : space.name;
    $('space-kind-field').hidden = !create;
    $('space-settings').hidden = create;
    $('space-capacity').value = space.capacityChars;
    $('space-context').value = space.contextChars;
    $('space-sections').value = space.sections.join('\n');
    $('space-error').textContent = '';
    $('space-dialog').showModal();
    $('space-form-name').focus();
  }
  $('space-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('save-space');
    submit.disabled = true;
    try {
      const previousIds = state.spaces.map((space) => space.id);
      const command = formContext.create
        ? { type: 'createSpace', name: $('space-form-name').value.trim(), kind: $('space-form-kind').value }
        : { type: 'updateSpace', spaceId: formContext.spaceId, patch: {
          name: $('space-form-name').value.trim(), capacityChars: Number($('space-capacity').value),
          contextChars: Number($('space-context').value), sections: $('space-sections').value.split('\n').map((value) => value.trim()).filter(Boolean),
        } };
      await execute({ ...command, expectedRevision: formContext.revision });
      if (formContext.create) selectSpace(state.spaces.find((space) => !previousIds.includes(space.id)).id);
      $('space-dialog').close();
      dirtyDialogs.delete('space-dialog');
      message('记忆架构已保存到本机。');
    } catch (error) { $('space-error').textContent = error.message; }
    finally { submit.disabled = false; }
  });
  function editEntry(entry = null) {
    const space = current();
    if (!space) return;
    entryContext = { spaceId: space.id, entryId: entry?.id, revision: state.revision };
    $('entry-dialog-title').textContent = entry ? '编辑记忆' : '添加记忆';
    $('entry-space-label').textContent = `保存到：${space.name}`;
    $('entry-title').value = entry?.title || '';
    $('entry-body').value = entry?.body || '';
    $('entry-source').value = entry?.source || '';
    $('entry-section').replaceChildren(...space.sections.map((section) => { const option = node('option', '', section); option.value = section; return option; }));
    $('entry-section').value = entry?.section || selectedSection || space.sections[0];
    $('entry-error').textContent = '';
    $('entry-dialog').showModal();
    $('entry-title').focus();
  }
  $('entry-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const fields = { title: $('entry-title').value.trim(), body: $('entry-body').value,
        section: $('entry-section').value, source: $('entry-source').value.trim() };
      const command = entryContext.entryId ? { type: 'updateEntry', entryId: entryContext.entryId, patch: fields }
        : { type: 'addEntry', ...fields };
      await execute({ ...command, spaceId: entryContext.spaceId, expectedRevision: entryContext.revision });
      $('entry-dialog').close();
      dirtyDialogs.delete('entry-dialog');
      message('候选记忆已保存。确认依据后可以发布。');
    } catch (error) { $('entry-error').textContent = error.message; }
    finally { submit.disabled = false; }
  });
  $('open-proposal').addEventListener('click', async () => {
    try {
      exportedSpaceId = selectedId;
      $('architecture-export').value = await result(window.workbench.memoryExport(exportedSpaceId));
      $('proposal-input').value = '';
      $('proposal-error').textContent = '';
      $('proposal-diff').hidden = true;
      $('apply-proposal').disabled = true;
      proposalId = null;
      proposalRequest += 1;
      $('preview-proposal').disabled = false;
      $('proposal-input').disabled = false;
      $('proposal-dialog').showModal();
    } catch (error) { message(error.message, true); }
  });
  $('copy-architecture').addEventListener('click', async () => {
    try {
      $('architecture-export').value = await result(window.workbench.memoryExport(exportedSpaceId, true));
      $('proposal-error').textContent = '已复制结构，未包含记忆正文。';
    } catch (error) { $('proposal-error').textContent = error.message; }
  });
  $('proposal-input').addEventListener('input', () => { proposalRequest += 1; proposalId = null; $('apply-proposal').disabled = true; $('proposal-diff').hidden = true; });
  $('preview-proposal').addEventListener('click', async () => {
    const request = ++proposalRequest;
    $('preview-proposal').disabled = true;
    $('proposal-input').disabled = true;
    $('apply-proposal').disabled = true;
    $('proposal-diff').hidden = true;
    $('proposal-error').textContent = '';
    proposalId = null;
    try {
      let parsed;
      try { parsed = JSON.parse($('proposal-input').value); } catch { throw new Error('请粘贴有效的 JSON 建议，不要包含代码围栏。'); }
      if (!parsed || typeof parsed !== 'object') throw new Error('架构建议必须是 JSON 对象。');
      if (parsed.spaceId !== exportedSpaceId) throw new Error('建议的空间与当前导出不一致。');
      const proposal = await result(window.workbench.memoryPrepare($('proposal-input').value));
      if (request !== proposalRequest) return;
      proposalId = proposal.id;
      $('proposal-diff').textContent = `修改前\n${JSON.stringify(proposal.before, null, 2)}\n\n修改后\n${JSON.stringify(proposal.after, null, 2)}\n\n只应用此空间的架构字段；10 分钟内有效，使用一次即失效。`;
      $('proposal-diff').hidden = false;
      $('apply-proposal').disabled = false;
      $('proposal-error').textContent = '';
    } catch (error) { $('proposal-error').textContent = error.message; }
    finally { if (request === proposalRequest) { $('preview-proposal').disabled = false; $('proposal-input').disabled = false; } }
  });
  $('apply-proposal').addEventListener('click', async () => {
    $('apply-proposal').disabled = true;
    try {
      state = await result(window.workbench.memoryApplyProposal(proposalId));
      proposalId = null;
      render();
      $('proposal-dialog').close();
      dirtyDialogs.delete('proposal-dialog');
      message('本次架构建议已应用，授权已消耗。');
    } catch (error) { $('proposal-error').textContent = error.message; }
  });
  $('confirm-retract').addEventListener('click', async () => {
    const reason = $('retract-reason').value.trim();
    if (!reason) { $('retract-error').textContent = '请填写撤回原因（会记入审计）。'; return; }
    $('confirm-retract').disabled = true;
    try {
      if (batchRetract && Array.isArray(retractContext?.entryIds)) {
        let done = 0; let failure = '';
        for (const entryId of retractContext.entryIds) {
          try {
            await execute({ type: 'retractEntry', spaceId: retractContext.spaceId, entryId, expectedRevision: state.revision, reason });
            done += 1;
          } catch (error) { failure = error.message; break; }
        }
        picked.clear();
        render();
        $('retract-dialog').close();
        batchRetract = false;
        message(failure ? `已撤回 ${done} 条后中断：${failure}` : `已撤回 ${done} 条，原因已记入审计。`, Boolean(failure));
      } else {
        await execute({ type: 'retractEntry', spaceId: retractContext.spaceId, entryId: retractContext.entryId, expectedRevision: retractContext.revision, reason });
        $('retract-dialog').close();
        message('已撤回并记录原因，原文保留在「已撤回」中，可复制为新候选。');
      }
    } catch (error) { $('retract-error').textContent = error.message; }
    finally { $('confirm-retract').disabled = false; }
  });
  $('open-packet').addEventListener('click', () => {
    const space = current();
    if (!space) return;
    packetContext = { spaceId: space.id, budgetChars: space.contextChars };
    packetId = null;
    $('packet-scope').textContent = `${space.name} · 仅检索已发布记忆 · 最多 ${space.contextChars} 字符（含来源与说明）`;
    $('packet-query').value = '';
    $('packet-preview').value = '';
    $('packet-summary').textContent = '';
    $('packet-error').textContent = '';
    $('packet-consent').checked = false;
    $('packet-consent').disabled = true;
    $('copy-packet').disabled = true;
    clearManifest();
    $('packet-dialog').showModal();
  });
  $('packet-query').addEventListener('input', () => { packetId = null; $('packet-consent').checked = false; $('packet-consent').disabled = true; $('copy-packet').disabled = true; clearManifest(); });
  $('build-packet').addEventListener('click', async () => {
    $('build-packet').disabled = true;
    $('packet-query').disabled = true;
    $('copy-packet').disabled = true;
    $('packet-error').textContent = '';
    try {
      const packet = await result(window.workbench.memoryPacket({ ...packetContext, query: $('packet-query').value }));
      packetId = packet.previewId;
      $('packet-preview').value = packet.text;
      $('packet-summary').textContent = `${packet.items.length} 个来源片段 · ${packet.usedChars} / ${packet.budgetChars} 字符${packet.truncated ? ' · 已按预算截取' : ''} · 本机关键词检索`;
      renderManifest(packet);
      $('packet-consent').checked = false;
      $('packet-consent').disabled = packet.items.length === 0;
      $('copy-packet').disabled = true;
    } catch (error) { $('packet-error').textContent = error.message; }
    finally { $('build-packet').disabled = false; $('packet-query').disabled = false; }
  });
  $('packet-consent').addEventListener('change', () => { $('copy-packet').disabled = !packetId || !$('packet-consent').checked; });
  $('copy-packet').addEventListener('click', async () => {
    if (!$('packet-consent').checked) { $('packet-error').textContent = '请先勾选确认将上下文发送给外部 AI。'; return; }
    $('copy-packet').disabled = true;
    try {
      const grant = await result(window.workbench.memoryGrantSend(packetId));
      await result(window.workbench.memoryCopyPacket(grant.token));
      $('packet-error').textContent = '已授权并复制预览中的上下文。请粘贴到你选定的主导 AI 软件。';
      $('packet-consent').checked = false;
      $('packet-consent').disabled = true;
    } catch (error) { $('packet-error').textContent = error.message; }
    finally { $('copy-packet').disabled = !$('packet-consent').checked || !packetId; }
  });
  function allowClose(id) {
    if (dirtyDialogs.has(id) && !window.confirm('有尚未保存的修改，确定放弃吗？')) return false;
    dirtyDialogs.delete(id);
    if (id === 'proposal-dialog') { proposalRequest += 1; proposalId = null; }
    return true;
  }
  for (const id of ['space-dialog', 'entry-dialog', 'proposal-dialog']) {
    $(id).addEventListener('input', (event) => { if (!event.target.readOnly) dirtyDialogs.add(id); });
    $(id).addEventListener('cancel', (event) => { if (!allowClose(id)) event.preventDefault(); });
  }
  window.addEventListener('beforeunload', (event) => {
    if (dirtyDialogs.size) { event.preventDefault(); event.returnValue = ''; }
  });
  for (const close of document.querySelectorAll('[data-close]')) close.addEventListener('click', () => {
    if (allowClose(close.dataset.close)) $(close.dataset.close).close();
  });
  $('nav-memory').addEventListener('click', () => page('memory'));
  $('nav-tasks').addEventListener('click', () => page('tasks'));
  $('open-settings').addEventListener('click', () => $('settings-dialog').showModal());
  $('close-settings').addEventListener('click', () => $('settings-dialog').close());
  $('new-shared-space').addEventListener('click', () => { $('settings-dialog').close(); editSpace(true, true); });
  $('refresh-memory-map').addEventListener('click', () => {
    const space = current(); if (!space) return;
    const map = $('memory-map'); map.replaceChildren();
    map.append(node('strong', '', `${space.name} · 版本 ${state.revision}`));
    const list = node('ul', '');
    for (const section of space.sections) {
      const entries = space.entries.filter(entry => entry.section === section);
      list.append(node('li', '', `${section} → ${entries.filter(e => e.status === 'published').length} 已发布 / ${entries.filter(e => e.status === 'candidate').length} 候选 / ${entries.filter(e => e.status === 'retracted').length} 撤回`));
    }
    map.append(list, node('small', '', `手动刷新于 ${new Date().toLocaleTimeString()}`));
  });
  $('new-space').addEventListener('click', () => editSpace(true));
  $('configure-space').addEventListener('click', () => editSpace());
  $('add-memory').addEventListener('click', () => editEntry());
  $('show-all').addEventListener('click', () => { selectedSection = null; render(); });
  $('memory-search').addEventListener('input', renderEntries);
  $('status-filter').addEventListener('change', renderEntries);

  // ---- 批量操作 ----
  $('pick-all').addEventListener('change', () => {
    const on = $('pick-all').checked;
    for (const entry of lastFiltered) {
      if (entry.status === 'retracted') continue;
      if (on) picked.add(entry.id); else picked.delete(entry.id);
    }
    renderEntries();
  });
  $('batch-clear').addEventListener('click', () => { picked.clear(); renderEntries(); });
  $('batch-publish').addEventListener('click', async () => {
    const space = current(); if (!space) return;
    const targets = space.entries.filter((entry) => picked.has(entry.id) && entry.status === 'candidate');
    if (!targets.length) { message('所选条目里没有「待确认」的记忆。', true); return; }
    const missing = targets.filter((entry) => !String(entry.source || '').trim());
    if (missing.length) { message(`以下条目缺少来源，先补来源再发布：${missing.map((entry) => entry.title).join('、')}`, true); return; }
    $('batch-publish').disabled = true;
    let done = 0; let failure = '';
    try {
      for (const entry of targets) {
        try {
          await execute({ type: 'publishEntry', spaceId: space.id, entryId: entry.id, expectedRevision: state.revision });
          done += 1;
        } catch (error) { failure = `「${entry.title}」失败：${error.message}（已完成 ${done} 条）`; break; }
      }
    } finally { $('batch-publish').disabled = false; }
    picked.clear();
    render();
    message(failure || `已发布 ${done} 条；不会自动共享给 AI 或外发。`, Boolean(failure));
  });
  $('batch-retract').addEventListener('click', () => {
    const space = current(); if (!space) return;
    const targets = space.entries.filter((entry) => picked.has(entry.id) && entry.status !== 'retracted');
    if (!targets.length) { message('所选条目里没有可撤回的记忆。', true); return; }
    batchRetract = true;
    retractContext = { spaceId: space.id, entryIds: targets.map((entry) => entry.id), revision: state.revision };
    $('retract-title').textContent = `将撤回 ${targets.length} 条：${targets.map((entry) => entry.title).join('、')}`;
    $('retract-reason').value = '';
    $('retract-error').textContent = '';
    $('retract-dialog').showModal();
  });
  $('open-palette').addEventListener('click', () => { if (window.__palette) window.__palette.open(); });

  // ---- 列表密度 ----
  const densitySelect = $('density-select');
  function applyDensity(value) {
    const density = value === 'compact' ? 'compact' : 'normal';
    document.body.dataset.density = density;
    if (densitySelect) densitySelect.value = density;
  }
  let savedDensity = 'normal';
  try { savedDensity = localStorage.getItem('density') || 'normal'; } catch {}
  applyDensity(savedDensity);
  if (densitySelect) densitySelect.addEventListener('change', () => {
    applyDensity(densitySelect.value);
    try { localStorage.setItem('density', document.body.dataset.density); } catch {}
  });
  $('reload-memory').addEventListener('click', () => reload().then(() => message('已从本机重新读取。')).catch((error) => message(error.message, true)));
  reload().catch((error) => {
    message(`记忆读取失败：${error.message}`, true);
    for (const id of ['new-space', 'configure-space', 'add-memory', 'open-packet', 'open-proposal']) {
      const control = $(id);
      if (control) control.disabled = true;
    }
  });

  // 供命令面板读取/跳转，不改变记忆逻辑本身。
  window.__memoryUi = {
    page,
    currentSpaceId: () => selectedId,
    spaces: () => (state ? state.spaces.map((space) => ({ id: space.id, name: space.name, kind: space.kind, count: space.entries.length })) : []),
    entries: () => (state ? state.spaces.flatMap((space) => space.entries.map((entry) => ({ spaceId: space.id, spaceName: space.name, id: entry.id, title: entry.title, status: entry.status, section: entry.section }))) : []),
    // 跨空间全文检索：只在本机内存里过一遍，不发网络、不写盘。撤回条目不计入。
    // 支持空格分隔的多词，要求**每个词都命中**（标题/正文/来源任意一处）。
    search(query) {
      const terms = String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length || terms.join('').length < 2 || !state) return [];
      const hits = [];
      for (const space of state.spaces) {
        for (const entry of space.entries) {
          if (entry.status === 'retracted') continue;
          const title = entry.title.toLocaleLowerCase();
          const body = entry.body.toLocaleLowerCase();
          const source = String(entry.source || '').toLocaleLowerCase();
          if (!terms.every((term) => title.includes(term) || body.includes(term) || source.includes(term))) continue;
          const inBody = terms.some((term) => body.includes(term));
          const matchedIn = inBody ? 'body' : (terms.some((term) => source.includes(term)) ? 'source' : 'title');
          let snippet;
          if (inBody) {
            const at = body.indexOf(terms.find((term) => body.includes(term)));
            snippet = `…${entry.body.slice(Math.max(0, at - 12), at + 34)}…`;
          } else {
            snippet = `${entry.section} · ${matchedIn === 'title' ? '标题命中' : '来源命中'}`;
          }
          hits.push({ spaceId: space.id, spaceName: space.name, id: entry.id, title: entry.title, section: entry.section, status: entry.status, matchedIn, terms, snippet: snippet.replace(/\s+/g, ' ').trim().slice(0, 56) });
          if (hits.length >= 24) return hits;
        }
      }
      return hits;
    },
    focus(spaceId, entryId) {
      const entry = state?.spaces.find((space) => space.id === spaceId)?.entries.find((item) => item.id === entryId);
      if (!entry) return false;
      if (selectedId !== spaceId) selectSpace(spaceId);
      selectedSection = entry.section;
      $('memory-search').value = '';
      $('status-filter').value = entry.status === 'retracted' ? 'retracted' : 'active';
      page('memory');
      render();
      const card = document.querySelector(`.entry-card[data-entry-id="${entryId}"]`);
      if (!card) return false;
      card.scrollIntoView({ block: 'center' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1200);
      return true;
    },
  };
})();
