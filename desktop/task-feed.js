(() => {
  const STATUS = {
    completed: '执行结束 · 待验收',
    accepted: '已验收',
    running: '执行中',
    in_progress: '执行中',
    queued: '排队中',
    pending: '等待中',
    blocked: '需要处理',
    failed: '执行失败',
    cancelled: '已取消',
  };

  function field(label, value) {
    const row = document.createElement('div');
    row.className = 'feed-field';
    const name = document.createElement('dt');
    name.textContent = label;
    const content = document.createElement('dd');
    content.textContent = value || '未提供';
    row.append(name, content);
    return row;
  }

  function renderTaskFeed(box, list) {
    if (!box) return;
    const expanded = new Set([...box.querySelectorAll('.feed-item')].filter(item => item.querySelector('details[open]')).map(item => item.dataset.taskId));
    box.replaceChildren();
    if (!Array.isArray(list) || !list.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '当前项目还没有可显示的任务记录。';
      box.append(empty);
      return;
    }

    const caption = document.createElement('p');
    caption.className = 'feed-caption';
    caption.textContent = '以下是任务状态快照；点开详情可核对来源字段。';
    box.append(caption);
    for (const task of list) {
      const model = String(task.model || '').trim() || '未标明模型';
      const status = String(task.status || 'unknown');
      const reviewState = String(task.reviewState || '');
      let statusLabel = STATUS[status.toLowerCase()] || status;
      if (['accepted', 'final_accepted'].includes(reviewState)) statusLabel = task.acceptanceValid === false ? '验收失效 · 待复核' : task.acceptanceValid !== true ? '验收待核实' : reviewState === 'final_accepted' ? '主脑接管 · 已验收' : '已验收';
      else if (reviewState === 'returned') statusLabel = '已退回整改';
      else if (reviewState === 'blocked') statusLabel = '需要主脑处理';
      const item = document.createElement('article');
      item.className = 'feed-item';
      item.dataset.taskId = String(task.id || '');
      item.dataset.status = reviewState === 'returned' ? 'blocked' : status;

      const avatar = document.createElement('span');
      avatar.className = 'feed-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = model.slice(0, 1).toUpperCase();

      const body = document.createElement('div');
      body.className = 'feed-body';
      const head = document.createElement('div');
      head.className = 'feed-head';
      const name = document.createElement('strong');
      name.textContent = model;
      const badge = document.createElement('span');
      badge.className = 'feed-status';
      badge.textContent = statusLabel;
      head.append(name, badge);
      const projectName = String(task.project || '').split(/[\\/]/).filter(Boolean).pop();
      if (projectName) {
        const project = document.createElement('span');
        project.className = 'feed-project';
        project.textContent = projectName;
        project.title = String(task.project);
        head.append(project);
      }

      const bubble = document.createElement('div');
      bubble.className = 'feed-bubble';
      const title = document.createElement('p');
      title.textContent = task.title || '未命名任务';
      bubble.append(title);

      const details = document.createElement('details');
      details.className = 'feed-details';
      details.open = expanded.has(item.dataset.taskId);
      const summary = document.createElement('summary');
      summary.textContent = '查看任务详情';
      const data = document.createElement('dl');
      data.append(
        field('任务 ID', String(task.id || '')),
        field('当前状态', status),
        field('独立验收', task.reviewLabel || reviewState || '尚未记录'),
        field('模型', model),
        field('所属项目', String(task.project || '')),
      );
      details.append(summary, data);
      bubble.append(details);
      body.append(head, bubble);
      item.append(avatar, body);
      box.append(item);
    }
  }

  window.renderTaskFeed = renderTaskFeed;
})();
