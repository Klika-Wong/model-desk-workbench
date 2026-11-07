(() => {
  const $ = id => document.getElementById(id);
  const page = $('models-page');
  if (!page) return;
  let snapshot = null;
  let unavailable = false;
  let busy = false;
  let epoch = 0;
  let serviceBase = '';
  let autoRefresh=true, refreshSeconds=60, autoTimer=null;
  const visible = () => !page.hidden && !document.hidden && !$('model-settings-dialog')?.open && !window.__workbenchShell?.isPanelShown();
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
    $('models-count').textContent = `${snapshot.cached ? '本机离线清单 · ' : unavailable ? '上次数据 · ' : ''}${selected.length} / ${all.length} 个模型`;
    window.ModelCards.renderModels($('models-list'), selected.map(m => ({...m, unavailable,cached:snapshot.cached})), async id => {
      $('nav-chat').click();
      await window.__chatUi?.selectModel(id);
    }, model => window.__modelSettingsUi?.open(model, serviceBase), model => window.__modelSettingsUi?.open(model, serviceBase, 'edit'));
    window.ModelCards.renderAccounts($('models-accounts'), snapshot.accounts.map(a => unavailable ? {...a, stateLabel: `连接中断 · 上次数据（${a.stateLabel}）`} : a));
  }
  async function refresh(background=false) {
    const allowed=()=>background ? !document.hidden && !$('model-settings-dialog')?.open && !window.__workbenchShell?.isPanelShown() : visible();
    if (busy || !allowed()) return;
    busy = true; const request = epoch;
    $('models-refresh').disabled = true;
    status('正在读取模型与账户快照…');
    try {
      const saved = localStorage.getItem('panelBase');
      const bases = [...new Set([saved, 'http://127.0.0.1:8765', 'http://127.0.0.1:18765'].filter(Boolean))];
      let data;
      for (const base of bases) {
        if (request !== epoch || !allowed()) return;
        const reply = await window.workbench.panelStatus(base);
        if (reply?.ok && reply.data?.state === 'connected') { data = reply.data; break; }
      }
      if (request !== epoch || !allowed()) return;
      if (!data) throw new Error('未连接本机服务。请启动工作台服务，或在设置中检查连接地址。');
      if (!data.overview || !Array.isArray(data.overview.models)) throw new Error('当前桌面连接层尚未提供模型总览，请更新并重开桌面。');
      snapshot = data.overview; serviceBase = data.baseUrl; unavailable = false; draw();
      $('models-add').disabled = false;
      status(`已读取快照 · ${new Date().toLocaleTimeString()} · ${autoRefresh ? '自动更新 '+refreshSeconds+' 秒' : '自动更新已关闭'} · 就绪不等于正在执行`);
      return true;
    } catch (error) {
      if (request !== epoch || !allowed()) return;
      if(!snapshot&&window.workbench.modelCache){
        try{const cached=await window.workbench.modelCache();if(request!==epoch||!allowed())return;if(cached?.ok&&cached.data)snapshot=cached.data;}catch{/* Keep the original connection error. */}
      }
      unavailable = true; draw(); // Retain the previous snapshot read-only with an explicit stale label.
      $('models-add').disabled = true;
      status(error.message || '读取失败，请重试。', true);
      return false;
    } finally {
      busy = false; $('models-refresh').disabled = false;
      if (request !== epoch && visible()) refresh();
    }
  }
  function hide() { epoch++; page.hidden = true; $('nav-panel').classList.remove('active'); clearTimeout(autoTimer); autoTimer = null; }
  function show() {
    window.__workbenchShell?.hideAdvanced();
    for (const id of ['memory-page', 'tasks-page', 'designer-page', 'chat-page']) $(id).hidden = true;
    page.hidden = false;
    for (const nav of document.querySelectorAll('.nav-button')) nav.classList.toggle('active', nav.id === 'nav-panel');
    if (busy) status('正在等待上一轮读取完成…');
    if (!snapshot) draw();
    refresh();
    scheduleAuto();
  }
  $('models-search').addEventListener('input', draw);
  $('models-filter').addEventListener('change', draw);
  $('models-refresh').addEventListener('click', () => refresh());
  $('models-add').addEventListener('click', () => window.__modelSettingsUi?.open(null, serviceBase));
  $('models-advanced').addEventListener('click', () => window.__workbenchShell?.openAdvanced());
  document.addEventListener('visibilitychange', () => { epoch++; if (visible()) { refresh(); scheduleAuto(); } else { clearTimeout(autoTimer); autoTimer = null; } });
  window.addEventListener('pagehide', () => { epoch++; });
  function scheduleAuto() {
    clearTimeout(autoTimer);
    autoTimer = null;
    if(!autoRefresh) return;
    autoTimer=setTimeout(async()=>{
      if(!visible()){ autoTimer=null; return; }  // 页面不可见就停，等 show/visibilitychange 重启
      await refresh(true);
      scheduleAuto();
    },refreshSeconds*1000);
  }
  window.addEventListener('workbench-preferences-changed',event=>{
    const prefs=event.detail;
    if(!prefs || typeof prefs.quotaAutoRefresh!=='boolean' || !Number.isInteger(prefs.quotaRefreshSeconds) || prefs.quotaRefreshSeconds<30 || prefs.quotaRefreshSeconds>600)return;
    autoRefresh=prefs.quotaAutoRefresh;refreshSeconds=prefs.quotaRefreshSeconds;scheduleAuto();
  });
  scheduleAuto();
  window.__modelsUi = {show, hide, refresh, status, invalidate: () => {epoch++;}};
})();
