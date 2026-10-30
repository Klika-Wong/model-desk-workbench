(() => {
  const root = document.documentElement;
  const themeSelect = document.getElementById('theme-select');
  const themeSeg = document.getElementById('theme-seg');
  const viewSeg = document.getElementById('view-seg');
  const THEMES = ['light', 'dark'];
  let panelShown = false;

  // ---------- theme ----------
  function normalizeTheme(value) { return THEMES.includes(value) ? value : 'light'; }
  function syncThemeUi(theme) {
    if (themeSelect) themeSelect.value = theme;
    if (themeSeg) for (const b of themeSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.themeValue === theme));
  }
  function pushThemeToPanel(theme) {
    if (!panelShown) return;
    const target = theme === 'dark' ? 'dark' : 'light';
    try { window.workbench.panelTheme(target); } catch {}
  }
  function applyTheme(value) {
    const theme = normalizeTheme(value);
    root.setAttribute('data-theme', theme);
    syncThemeUi(theme);
    pushThemeToPanel(theme);
    return theme;
  }
  function setTheme(value) {
    const theme = applyTheme(value);
    try { localStorage.setItem('theme', theme); } catch {}
    return theme;
  }
  let initialTheme = 'light';
  try { initialTheme = localStorage.getItem('theme') || 'light'; } catch {}
  applyTheme(initialTheme);
  if (themeSelect) themeSelect.addEventListener('change', () => setTheme(themeSelect.value));
  if (themeSeg) themeSeg.addEventListener('click', (event) => {
    const b = event.target.closest('button[data-theme-value]');
    if (b) setTheme(b.dataset.themeValue);
  });

  // ---------- view switch (新版 ⇄ 完整工作台) ----------
  function syncViewUi(view) {
    if (viewSeg) for (const b of viewSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  }
  syncViewUi('new');
  function setNavActive(id) { for (const b of document.querySelectorAll('.nav-button')) b.classList.toggle('active', b.id === id); }

  // Sidebar refresh: refresh whichever page is visible.
  const refresh = document.getElementById('sidebar-refresh');
  if (refresh) {
    refresh.addEventListener('click', () => {
      const designer = document.getElementById('designer-page');
      const memory = document.getElementById('memory-page');
      if (panelShown) { showPanelEmbedded(); return; }
      if (!document.getElementById('models-page')?.hidden) { window.__modelsUi?.refresh(); return; }
      if (designer && !designer.hidden) { const b = document.getElementById('designer-reload'); if (b) b.click(); return; }
      if (memory && !memory.hidden) { const b = document.getElementById('reload-memory'); if (b) b.click(); return; }
      const chat = document.getElementById('chat-page');
      if (chat && !chat.hidden) { const b = document.getElementById('chat-models'); if (b) b.click(); return; }
      const b = document.getElementById('refresh'); if (b) b.click();
    });
  }

  // ---- real workbench panel probe ----
  const DEFAULT_BASE = 'http://127.0.0.1:8765';
  function panelBase() { try { return localStorage.getItem('panelBase') || DEFAULT_BASE; } catch { return DEFAULT_BASE; } }
  function setConnStatus(text, isError = false) {
    const el = document.getElementById('conn-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-error', Boolean(isError));
  }
  function chipIcon(label) { return (String(label || '?').trim().slice(0, 1) || '?').toUpperCase(); }
  function idleChips() { const graph = document.getElementById('conn-graph'); if (graph) for (const el of graph.querySelectorAll('.conn-node')) { el.dataset.status = 'idle'; const health=el.querySelector('.conn-health'); if(health) health.textContent='未连接'; } }
  function renderExecs(hub, executors, tasks, project, projects) {
    const graph = document.getElementById('conn-graph');
    if (window.renderConnectionGraph) window.renderConnectionGraph(graph, hub, executors, tasks, project, projects);
  }
  function renderRealTasks(list) {
    const box = document.getElementById('real-tasks');
    if (!box) return;
    if (window.renderTaskFeed) window.renderTaskFeed(box, list);
  }
  async function probeFirst(allProjects = false) {
    const bases = [...new Set([panelBase(), DEFAULT_BASE, 'http://127.0.0.1:18765'])];
    let last = null;
    for (const base of bases) {
      let reply; try { reply = await (allProjects ? window.workbench.panelStatusAll(base) : window.workbench.panelStatus(base)); } catch (e) { reply = { ok: false, error: e.message }; }
      if (reply && reply.ok && reply.data && reply.data.state === 'connected') return reply.data;
      const candidate = (reply && reply.ok) ? reply.data : {state:'error',baseUrl:base,message:reply?.error || '状态请求失败',executors:[]};
      if (!last || last.state !== 'error' || candidate?.state === 'error') last = candidate;
    }
    return last || { state: 'unreachable', baseUrl: bases[0], message: '未发现运行中的工作台', hub: '本机主脑', executors: [] };
  }
  let probeSequence = 0;
  let probesPending = 0;
  function projectKey(value) { return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); }
  async function refreshPanel() {
    const sequence = ++probeSequence;
    const allProjects = Boolean(document.getElementById('all-projects')?.checked);
    setConnStatus('正在探测本机工作台…');
    probesPending += 1;
    let d;
    try {
      d = await probeFirst(allProjects);
      if (!allProjects && d.state === 'connected') {
        const current = await window.workbench.getState();
        if (sequence !== probeSequence) return;
        if (projectKey(d.project) !== projectKey(current.project)) {
          renderRealTasks([]);
          idleChips();
          setConnStatus('项目已切换，正在更新任务…');
          window.setTimeout(refreshPanel, 0);
          return;
        }
      }
    } catch (error) {
      d = {state:'error',message:error.message,baseUrl:panelBase()};
    } finally { probesPending -= 1; }
    if (sequence !== probeSequence) return;
    if (d.state === 'connected') {
      const extra = `${d.execution ? '｜' + d.execution : ''}${typeof d.tasks === 'number' ? '｜任务 ' + d.tasks : ''}`;
      setConnStatus(`已连接服务 ${d.baseUrl}${extra}｜${allProjects ? '全部项目只读总览' : '当前项目视图'}${d.truncated ? '｜仅显示前 20 条' : ''}`);
      renderExecs(d.hub, d.executors, d.runningTasks || d.taskList, allProjects ? '全部项目' : d.project, d.projects);
      renderRealTasks(d.taskList);
      if (!allProjects && !d.project) { const box=document.getElementById('real-tasks'); if(box) box.textContent='尚未绑定项目：请先选择项目文件夹；不显示其他项目任务。'; }
    } else if (d.state === 'unreachable') {
      setConnStatus(`未连接：未发现运行中的工作台。真实连接需先运行「启动模型面板.ps1」（默认 8765；若已自定义端口请在上方填写）。`);
      idleChips();
      renderRealTasks([]);
    } else {
      setConnStatus(`连接异常：${d.message || '未知'}（${d.baseUrl}）`);
      idleChips();
      renderRealTasks([]);
    }
  }
  window.addEventListener('workbench-project-changed', () => {
    probeSequence += 1;
    renderRealTasks([]);
    const graph = document.getElementById('conn-graph');
    if (graph) graph.replaceChildren();
    refreshPanel();
  });
  const baseInput = document.getElementById('panel-base');
  if (baseInput) {
    baseInput.value = panelBase();
    baseInput.addEventListener('change', () => { try { localStorage.setItem('panelBase', baseInput.value.trim() || DEFAULT_BASE); } catch {} refreshPanel(); });
  }
  const connRefresh = document.getElementById('conn-refresh');
  if (connRefresh) connRefresh.addEventListener('click', () => refreshPanel());
  const allProjectsToggle = document.getElementById('all-projects');
  if (allProjectsToggle) allProjectsToggle.addEventListener('change', () => refreshPanel());
  const sidebarSearch = document.getElementById('sidebar-search');
  if (sidebarSearch) sidebarSearch.addEventListener('click', () => document.getElementById('open-palette')?.click());

  function workspaceRect() {
    const m = document.querySelector('main.workspace');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    // getBoundingClientRect().height 是元素**完整**高度，页面有内容时会大于窗口，
    // 直接当视图高度会让面板伸出窗口底部（对话框底部点不到）。必须裁到可见区。
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const width = Math.max(0, Math.min(window.innerWidth, r.right) - left);
    const height = Math.max(0, Math.min(window.innerHeight, r.bottom) - top);
    if (!width || !height) return null;
    return { x: Math.round(left), y: Math.round(top), width: Math.round(width), height: Math.round(height) };
  }
  async function showPanelEmbedded() {
    // 顺序很重要：先锁外壳滚动（会改变可用宽度），再量尺寸，否则视图右边会留一条缝。
    root.classList.add('panel-embedded');
    window.scrollTo(0, 0);
    const rect = workspaceRect();
    if (!rect) { root.classList.remove('panel-embedded'); return; }
    setConnStatus('正在把完整工作台嵌入本窗口…');
    let reply; try { reply = await window.workbench.panelEmbed(rect); } catch (e) { reply = { ok: false, error: e.message }; }
    if (reply && reply.ok) {
      panelShown = true; setNavActive('nav-panel'); syncViewUi('original');
      pushThemeToPanel(root.getAttribute('data-theme'));
      setConnStatus(`完整工作台已嵌入本窗口：${reply.data.url}`);
    } else {
      syncViewUi('new');
      root.classList.remove('panel-embedded');
      setConnStatus(`嵌入失败：${(reply && reply.error) || '未发现运行中的工作台'}`);
      window.__modelsUi?.status(`高级设置未打开：${reply?.error || '未发现运行中的工作台'}`, true);
    }
  }
  function hidePanelEmbedded() {
    syncViewUi('new');
    root.classList.remove('panel-embedded');
    if (!panelShown) return;
    panelShown = false;
    try { window.workbench.panelEmbedHide(); } catch {}
    const nav = document.getElementById('nav-panel'); if (nav) nav.classList.remove('active');
  }
  function showNewView() { hidePanelEmbedded(); setNavActive('nav-memory'); const b = document.getElementById('nav-memory'); if (b) b.click(); }
  function toggleView() { if (panelShown) window.__modelsUi?.show(); else showPanelEmbedded(); }

  const navPanel = document.getElementById('nav-panel');
  if (navPanel) navPanel.addEventListener('click', () => window.__modelsUi?.show());
  for (const id of ['nav-memory', 'nav-tasks', 'nav-designer', 'nav-chat']) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => hidePanelEmbedded());
  }
  if (viewSeg) viewSeg.addEventListener('click', (event) => {
    const b = event.target.closest('button[data-view]');
    if (!b) return;
    if (b.dataset.view === 'original') showPanelEmbedded(); else showNewView();
  });
  const openReal = document.getElementById('open-real-panel');
  if (openReal) openReal.addEventListener('click', () => window.__modelsUi?.show());
  // 嵌入视图尺寸跟随宿主区域：窗口缩放、侧栏拖宽、左右停靠都会触发。
  const workspaceEl = document.querySelector('main.workspace');
  if (workspaceEl && typeof ResizeObserver !== 'undefined') {
    let frame = 0;
    new ResizeObserver(() => {
      if (!panelShown) return;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = workspaceRect();
        if (r) window.workbench.panelEmbedBounds(r);
      });
    }).observe(workspaceEl);
  } else {
    window.addEventListener('resize', () => { if (panelShown) { const r = workspaceRect(); if (r) window.workbench.panelEmbedBounds(r); } });
  }
  const navTasks = document.getElementById('nav-tasks');
  if (navTasks) navTasks.addEventListener('click', () => setTimeout(refreshPanel, 50));
  refreshPanel();
  window.setInterval(() => {
    const page = document.getElementById('tasks-page');
    if (page && !page.hidden && !document.hidden && !panelShown && probesPending === 0) refreshPanel();
  }, 5000);

  // ---------- shortcuts: Ctrl+Shift+1/2 主题，Ctrl+Shift+W 切换视图 ----------
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
    const code = event.code;
    if (code === 'Digit1') { setTheme('light'); event.preventDefault(); }
    else if (code === 'Digit2') { setTheme('dark'); event.preventDefault(); }
    // 快捷键总览里写了这一条，之前没实现——按了没反应比不写更糟。
    else if (code === 'KeyW') { toggleView(); event.preventDefault(); }
  });

  // expose for smoke/automation without touching globals at large
  // 主进程在嵌入视图崩溃/加载失败时回调这里：把状态改回"未嵌入"，并说明原因。
  function onPanelGone(reason) {
    panelShown = false;
    root.classList.remove('panel-embedded');
    syncViewUi('new');
    const nav = document.getElementById('nav-panel'); if (nav) nav.classList.toggle('active', !document.getElementById('models-page')?.hidden);
    setConnStatus(`高级设置已断开：${reason}。可从「模型与额度」重新打开高级设置。`, true);
    window.__modelsUi?.status(`高级设置已断开：${reason}`, true);
  }
  window.__workbenchShell = { setTheme, getTheme: () => root.getAttribute('data-theme'), toggleView, openAdvanced: showPanelEmbedded, hideAdvanced: hidePanelEmbedded, isPanelShown: () => panelShown, onPanelGone };
})();
