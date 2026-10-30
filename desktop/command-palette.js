/* 命令面板（Ctrl+K）+ 快捷键总览（Ctrl+/）。
   只做导航与已有按钮的转发，不新增任何数据写入逻辑。
   支持：跨空间全文命中（正文/来源）、最近使用、分组结果。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const palette = $('palette');
  const input = $('palette-input');
  const list = $('palette-list');
  const shortcutsDialog = $('shortcuts-dialog');
  const RECENT_KEY = 'palette.recent';

  let filtered = [];
  let active = 0;
  let isOpen = false;

  const click = (id) => { const el = $(id); if (el && !el.disabled) el.click(); };
  const shell = () => window.__workbenchShell;
  const mem = () => window.__memoryUi;

  function themeLabel() {
    const t = shell()?.getTheme?.();
    return t === 'dark' ? '黑夜' : t === 'classic' ? '原版外观' : '浅色';
  }

  // ---- 最近使用 ----
  function loadRecent() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((key) => typeof key === 'string').slice(0, 6) : [];
    } catch { return []; }
  }
  function pushRecent(key) {
    if (!key) return;
    const next = [key, ...loadRecent().filter((item) => item !== key)].slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
  }

  // ---- 静态命令 ----
  function allItems() {
    const items = [];
    const add = (group, label, hint, run, key) => items.push({ group, label, hint, run, key: key || `${group}|${label}` });

    add('导航', '记忆空间', '空间列表 / 记忆条目 / 检索', () => click('nav-memory'));
    add('导航', '运行与连接', '执行端与任务', () => click('nav-tasks'));
    add('导航', '架构画布', '无限画布 / 节点 / 连线', () => click('nav-designer'));
    add('导航', '完整工作台（原版）', '全部原有功能 · 同窗口嵌入', () => click('nav-panel'));

    const api = mem();
    for (const space of api?.spaces?.() || []) {
      add('记忆空间', `切换到「${space.name}」`, `${space.kind === 'shared' ? '公共池' : space.kind === 'special' ? '专用' : '项目'} · ${space.count} 条`,
        () => { api.page('memory'); const btn = document.querySelector(`.space-button[data-space-id="${space.id}"]`); if (btn) btn.click(); },
        `space|${space.id}`);
    }

    const currentSpace = api?.currentSpaceId?.();
    const entries = (api?.entries?.() || []).slice()
      .sort((a, b) => (a.spaceId === currentSpace ? -1 : 1) - (b.spaceId === currentSpace ? -1 : 1))
      .slice(0, 60);
    for (const entry of entries) {
      add('记忆条目', entry.title, `${entry.spaceName} · ${entry.section} · ${{ candidate: '待确认', published: '已发布', retracted: '已撤回' }[entry.status] || entry.status}`,
        () => api.focus(entry.spaceId, entry.id), `entry|${entry.id}`);
    }

    add('动作', '添加记忆', '新建一条候选记忆', () => click('add-memory'), 'act.add');
    add('动作', '编辑当前空间架构', '名称 / 栏目 / 容量', () => click('configure-space'), 'act.space');
    add('动作', '检索并交给 AI', '本地检索已发布内容', () => click('open-packet'), 'act.packet');
    add('动作', '架构建议（导入 AI 结果）', '单次应用', () => click('open-proposal'), 'act.proposal');
    add('动作', '重新读取记忆', '从本机刷新', () => click('reload-memory'), 'act.reload');
    add('动作', '全选当前列表', '批量操作前先选中', () => { const b = $('pick-all'); if (b && !b.disabled) b.click(); }, 'act.pickall');
    add('动作', '打开设置', '外观 / 连接 / 容量', () => click('open-settings'), 'act.settings');
    add('动作', '性能监测', 'CPU / GPU 采样', () => click('open-performance'), 'act.perf');
    add('动作', '重新探测本机工作台', '8765 / 18765', () => click('conn-refresh'), 'act.probe');
    add('动作', '打开悬浮任务窗', '常驻小窗', () => click('open-mini'), 'act.mini');

    add('外观', `浅色（当前：${themeLabel()}）`, 'Ctrl+Shift+1', () => shell()?.setTheme('light'), 'theme.light');
    add('外观', '黑夜模式', 'Ctrl+Shift+2', () => shell()?.setTheme('dark'), 'theme.dark');

    add('视图', '新版界面', '记忆 / 画布', () => { const b = document.querySelector('#view-seg button[data-view="new"]'); if (b) b.click(); }, 'view.new');
    add('视图', '原版工作台', 'Ctrl+Shift+W · 全部原有功能', () => { const api = window.__workbenchShell; if (api && api.toggleView) api.toggleView(); }, 'view.original');

    add('帮助', '快捷键总览', 'Ctrl+/', () => openShortcuts(), 'help.keys');
    return items;
  }

  // ---- 评分 ----
  function score(text, query) {
    if (!query) return 1;
    const t = String(text).toLowerCase();
    const at = t.indexOf(query);
    if (at >= 0) return 100 - Math.min(at, 40);
    let i = 0;
    for (const ch of t) { if (ch === query[i]) i += 1; if (i === query.length) return 12; }
    return 0;
  }

  function searchHits(query) {
    const api = mem();
    if (!api?.search) return [];
    return (api.search(query) || [])
      .filter((hit) => hit.matchedIn !== 'title') // 标题命中已在「记忆条目」组里
      .slice(0, 8)
      .map((hit) => ({
        group: '全文命中',
        label: hit.title,
        hint: `${hit.spaceName} · ${hit.snippet}`,
        key: `hit|${hit.id}`,
        terms: hit.terms || [],
        run: () => api.focus(hit.spaceId, hit.id),
        snippet: hit.snippet,
      }));
  }

  function rank(query) {
    const q = query.trim().toLowerCase();
    const base = allItems();
    if (!q) {
      const byKey = new Map(base.map((item) => [item.key, item]));
      const recentKeys = loadRecent();
      const recent = recentKeys
        .map((key) => byKey.get(key))
        .filter(Boolean)
        .map((item) => ({ ...item, group: '最近使用' }));
      const used = new Set(recentKeys);
      return [...recent, ...base.filter((item) => !used.has(item.key))];
    }
    const terms = q.split(/\s+/).filter(Boolean);
    // 求和而不是取最大：否则输入「示例项目 B」时，长词让 A/B 打平，短词 B 的区分度被丢掉。
    // 全词命中额外加 200 分，保证「整句都对上」的项稳定排在最前。
    const best = (text) => {
      const lower = String(text).toLowerCase();
      let total = 0;
      let all = true;
      for (const term of terms) {
        const s = score(lower, term);
        if (s === 0) all = false;
        total += s * (1 + Math.min(term.length, 8) / 12);
      }
      return total + (all && terms.length ? 200 : 0);
    };
    const rows = [];
    for (const item of base) {
      const s = Math.max(best(item.label), best(item.hint) * 0.6);
      if (s > 0) rows.push({ item, s });
    }
    for (const hit of searchHits(query)) {
      // 正文命中给一点提权，避免被命令名噪声盖住；强命令匹配（如「设置」）仍然优先。
      const snippetScore = Math.max(0, ...(hit.terms.length ? hit.terms : [q]).map((term) => score(hit.snippet || '', term)));
      rows.push({ item: hit, s: snippetScore * 0.5 + 26 });
    }
    rows.sort((a, b) => b.s - a.s);
    return rows.map((row) => row.item);
  }

  // 把命中的词包成 <mark>，避免整段用一个 textContent 塞进去。
  function highlight(text, terms) {
    const frag = document.createDocumentFragment();
    const source = String(text ?? '');
    if (!terms.length || !source) { frag.append(document.createTextNode(source)); return frag; }
    const lower = source.toLowerCase();
    const ranges = [];
    for (const term of terms) {
      let from = 0;
      while (true) {
        const at = lower.indexOf(term, from);
        if (at < 0) break;
        ranges.push([at, at + term.length]);
        from = at + Math.max(term.length, 1);
      }
    }
    if (!ranges.length) { frag.append(document.createTextNode(source)); return frag; }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([...range]);
    }
    let cursor = 0;
    for (const [start, end] of merged) {
      if (start > cursor) frag.append(document.createTextNode(source.slice(cursor, start)));
      const mark = document.createElement('mark');
      mark.className = 'palette-mark';
      mark.textContent = source.slice(start, end);
      frag.append(mark);
      cursor = end;
    }
    if (cursor < source.length) frag.append(document.createTextNode(source.slice(cursor)));
    return frag;
  }

  function render() {
    const queryText = input.value;
    const terms = queryText.trim().toLowerCase().split(/\s+/).filter(Boolean);
    filtered = rank(queryText);
    active = Math.min(active, Math.max(filtered.length - 1, 0));
    list.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '没有匹配的命令';
      list.append(empty);
      return;
    }
    let group = '';
    filtered.forEach((item, index) => {
      if (item.group !== group) {
        group = item.group;
        const head = document.createElement('li');
        head.className = 'palette-group';
        head.textContent = group;
        head.setAttribute('aria-hidden', 'true');
        list.append(head);
      }
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.key = item.key || '';
      li.setAttribute('aria-selected', String(index === active));
      const label = document.createElement('span');
      label.className = 'palette-label';
      label.append(highlight(item.label, terms));
      const hint = document.createElement('span');
      hint.className = 'palette-hint';
      hint.append(highlight(item.hint || '', terms));
      li.append(label, hint);
      li.addEventListener('mousemove', () => { if (active !== index) { active = index; paint(); } });
      li.addEventListener('click', () => runAt(index));
      list.append(li);
    });
  }

  function paint() {
    let index = -1;
    for (const li of list.children) {
      if (li.getAttribute('role') !== 'option') continue;
      index += 1;
      li.setAttribute('aria-selected', String(index === active));
    }
    const selected = list.querySelector('li[aria-selected="true"]');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function openPalette() {
    if (!palette) return;
    isOpen = true;
    palette.hidden = false;
    input.value = '';
    active = 0;
    render();
    input.focus();
  }
  function closePalette() {
    if (!palette) return;
    isOpen = false;
    palette.hidden = true;
    input.value = '';
  }
  function runAt(index) {
    const item = filtered[index];
    if (!item) return;
    pushRecent(item.key);
    closePalette();
    try { item.run(); } catch (error) { console.warn('palette action failed', error); }
  }

  const SHORTCUTS = [
    ['Ctrl + K', '命令面板（搜命令、空间、记忆标题与正文）'],
    ['Ctrl + /', '打开这份快捷键总览'],
    ['Ctrl + Shift + 1 / 2', '切换 浅色 / 黑夜'],
    ['Ctrl + Shift + W', '在新版界面与原版工作台之间快速切换'],
    ['Ctrl + B', '隐藏 / 显示侧栏'],
    ['V / H', '架构画布：选择工具 / 抓手工具'],
    ['按住空格', '架构画布：临时平移'],
    ['空白处拖拽', '架构画布：框选多个节点'],
    ['Delete / Backspace', '架构画布：删除选中节点'],
    ['Ctrl + 0', '架构画布：重置缩放为 100%'],
    ['Ctrl + 滚轮', '架构画布：以光标为中心缩放'],
    ['中键拖动', '架构画布：平移画布'],
    ['Esc', '关闭当前弹层 / 命令面板'],
  ];
  function openShortcuts() {
    const body = $('shortcuts-body');
    if (body && !body.childElementCount) {
      for (const [keys, desc] of SHORTCUTS) {
        const row = document.createElement('div');
        row.className = 'shortcut-row';
        const key = document.createElement('span');
        key.textContent = keys;
        const text = document.createElement('span');
        text.textContent = desc;
        row.append(key, text);
        body.append(row);
      }
    }
    closePalette();
    if (shortcutsDialog) shortcutsDialog.showModal();
  }
  if ($('close-shortcuts')) $('close-shortcuts').addEventListener('click', () => shortcutsDialog.close());

  if (input) input.addEventListener('input', () => { active = 0; render(); });
  if (palette) palette.addEventListener('click', (event) => { if (event.target === palette) closePalette(); });

  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.shiftKey && !event.altKey && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault();
      if (isOpen) closePalette(); else openPalette();
      return;
    }
    if (mod && !event.shiftKey && event.key === '/') { event.preventDefault(); openShortcuts(); return; }
    if (!isOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); closePalette(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); if (filtered.length) { active = (active + 1) % filtered.length; paint(); } return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); if (filtered.length) { active = (active - 1 + filtered.length) % filtered.length; paint(); } return; }
    if (event.key === 'Enter') { event.preventDefault(); runAt(active); }
  }, true);

  window.__palette = { open: openPalette, close: closePalette, isOpen: () => isOpen, shortcuts: openShortcuts, clearRecent: () => { try { localStorage.removeItem(RECENT_KEY); } catch {} } };
})();
