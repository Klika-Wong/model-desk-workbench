(() => {
  const $ = id => document.getElementById(id);
  const page = $('models-page');
  if (!page) return;
  let snapshot = null;
  let unavailable = false;
  let busy = false;
  let epoch = 0;
  const visible = () => !page.hidden && !document.hidden && !window.__workbenchShell?.isPanelShown();
  function status(message, error = false) {
    $('models-status').textContent = message;
    $('models-status').classList.toggle('is-error', error);
  }
  function draw() {
    if (!snapshot) {
      $('models-count').textContent = '模型数量未知';
      $('models-list').textContent = '暂未取得模型列表，请连接服务后刷新。';
      $('models-accounts').textContent = '暂未取得账户数据。';
      return;
    }
    const query = $('models-search').value.trim().toLowerCase();
    const filter = $('models-filter').value;
    const all = snapshot?.models || [];
    const selected = all.filter(m => (!query || [m.name, m.providerLabel, m.executorLabel].join(' ').toLowerCase().includes(query)) &&
      (filter === 'all' || filter === 'local' && m.local || filter === 'cloud' && !m.local || filter === 'enabled' && m.enabled));
    $('models-count').textContent = `${unavailable ? '上次数据 · ' : ''}${selected.length} / ${all.length} 个模型`;
    window.ModelCards.renderModels($('models-list'), selected.map(m => ({...m, unavailable})), async id => {
      $('nav-chat').click();
      await window.__chatUi?.selectModel(id);
    });
    window.ModelCards.renderAccounts($('models-accounts'), snapshot.accounts.map(a => unavailable ? {...a, stateLabel: `连接中断 · 上次数据（${a.stateLabel}）`} : a));
  }
  async function refresh() {
    if (busy || !visible()) return;
    busy = true; const request = epoch;
    $('models-refresh').disabled = true;
    status('正在读取模型与账户快照…');
    try {
      const saved = localStorage.getItem('panelBase');
      const bases = [...new Set([saved, 'http://127.0.0.1:8765', 'http://127.0.0.1:18765'].filter(Boolean))];
      let data;
      for (const base of bases) {
        if (request !== epoch || !visible()) return;
        const reply = await window.workbench.panelStatus(base);
        if (reply?.ok && reply.data?.state === 'connected') { data = reply.data; break; }
      }
      if (request !== epoch || !visible()) return;
      if (!data) throw new Error('未连接本机服务。请启动工作台服务，或在设置中检查连接地址。');
      if (!data.overview || !Array.isArray(data.overview.models)) throw new Error('当前桌面连接层尚未提供模型总览，请更新并重开桌面。');
      snapshot = data.overview; unavailable = false; draw();
      status('已读取快照 · 执行端就绪不等于正在执行 · 此页可见时每 30 秒更新');
    } catch (error) {
      if (request !== epoch || !visible()) return;
      unavailable = true; draw(); // Retain the previous snapshot read-only with an explicit stale label.
      status(error.message || '读取失败，请重试。', true);
    } finally {
      busy = false; $('models-refresh').disabled = false;
      if (request !== epoch && visible()) refresh();
    }
  }
  function hide() { epoch++; page.hidden = true; $('nav-panel').classList.remove('active'); }
  function show() {
    window.__workbenchShell?.hideAdvanced();
    for (const id of ['memory-page', 'tasks-page', 'designer-page', 'chat-page']) $(id).hidden = true;
    page.hidden = false;
    for (const nav of document.querySelectorAll('.nav-button')) nav.classList.toggle('active', nav.id === 'nav-panel');
    if (busy) status('正在等待上一轮读取完成…');
    if (!snapshot) draw();
    refresh();
  }
  $('models-search').addEventListener('input', draw);
  $('models-filter').addEventListener('change', draw);
  $('models-refresh').addEventListener('click', refresh);
  $('models-advanced').addEventListener('click', () => window.__workbenchShell?.openAdvanced());
  document.addEventListener('visibilitychange', () => { epoch++; if (visible()) refresh(); });
  window.addEventListener('pagehide', () => { epoch++; });
  window.setInterval(() => { if (visible()) refresh(); }, 30000);
  window.__modelsUi = {show, hide, refresh, status};
})();
