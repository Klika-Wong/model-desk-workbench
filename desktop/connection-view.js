(() => {
  const ACTIVE = new Set(['running', 'in_progress', 'executing']);
  function add(tag, className, value) {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = value;
    return el;
  }
  function renderConnectionGraph(graph, hub, executors, tasks, project, projectPaths) {
    if (!graph) return;
    graph.replaceChildren();
    const activeTasks = (Array.isArray(tasks) ? tasks : []).filter(t => ACTIVE.has(String(t.status || '').toLowerCase()));
    const lead = add('div', 'conn-node conn-hub', '');
    lead.dataset.status = activeTasks.length ? 'running' : 'idle';
    lead.append(add('span', 'conn-level', '主导'), add('span', 'conn-name', hub || '主导身份未报告'), add('span', 'conn-dot', ''));
    lead.append(add('small', 'conn-health', activeTasks.length ? '协作任务运行中' : '暂无运行任务'));
    graph.append(lead);
    if (project === '全部项目') {
      const projects = Array.isArray(projectPaths) ? projectPaths : [...new Set((Array.isArray(tasks) ? tasks : []).map(t => String(t.project || '')).filter(Boolean))];
      const list = add('div', 'conn-project-list', '');
      list.append(add('span', 'conn-project', `有任务记录的项目 · ${projects.length} 个`));
      for (const path of projects) {
        const chip = add('span', 'conn-project-chip', path.split(/[\\/]/).filter(Boolean).pop() || path);
        chip.title = path;
        list.append(chip);
      }
      graph.append(list);
    } else if (project) graph.append(add('p', 'conn-project', `当前项目 · ${project}`));
    const rows = add('div', 'conn-execs', '');
    const endpoints = Array.isArray(executors) ? executors : [];
    const assigned = new Map(endpoints.map(e => [e, []]));
    for (const task of activeTasks) {
      const engine = String(task.engine || '').trim().toLowerCase();
      const candidates = [task.modelId, task.model].map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
      const matches = endpoints.filter(e => engine
        ? String(e.id || '').toLowerCase() === engine
        : [e.modelId, e.model, e.modelName].some(v => v && candidates.includes(String(v).trim().toLowerCase())));
      // A saved engine owns a running task even after the endpoint's selection changes.
      // Legacy tasks without one can only be attributed when the model match is unique.
      if (matches.length === 1) assigned.get(matches[0]).push(task);
    }
    for (const e of endpoints) {
      const model = String(e.model || '').trim();
      const label = String(e.label || e.id || '未命名执行端');
      const assignedTasks = assigned.get(e);
      const active = assignedTasks.length > 0;
      const runningModels = [...new Set(assignedTasks.map(t => String(t.model || t.modelId || '').trim()).filter(Boolean))];
      const displayModel = active ? runningModels.slice(0, 2).join('、') + (runningModels.length > 2 ? ` 等 ${runningModels.length} 个模型` : '') : model;
      const node = add('div', 'conn-node', '');
      node.dataset.status = active ? 'running' : (e.status === 'error' ? 'error' : 'idle');
      const name = add('span', 'conn-name', displayModel ? `${label} · ${displayModel}` : label);
      if (active) name.title = runningModels.join('、');
      node.append(add('span', 'conn-level', '执行'), name, add('span', 'conn-dot', ''));
      node.append(add('small', 'conn-health', active ? '执行中' : e.ready === true ? '就绪' : e.ready === false ? '不可用' : '状态未确认'));
      rows.append(node);
    }
    if (!rows.children.length) rows.append(add('p', 'hint', '面板尚未报告可显示的执行端。'));
    graph.append(rows);
  }
  window.renderConnectionGraph = renderConnectionGraph;
})();
