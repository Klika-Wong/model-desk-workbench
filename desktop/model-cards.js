(() => {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const time = value => value ? new Date(value).toLocaleString() : '';
  function renderModels(container, models, onSelect, onConfigure) {
    container.replaceChildren();
    if (!models.length) container.append(el('p', 'models-empty', '没有匹配的模型。可调整筛选，或在高级设置中添加模型。'));
    for (const model of models) {
      const row = el('article', 'model-row');
      const content = el('div', 'model-info');
      const heading = el('div', 'model-heading');
      heading.append(el('h3', '', model.name), el('span', 'model-badge', model.providerLabel));
      const state = model.unavailable ? '连接中断 · 上次数据' : !model.enabled ? '已停用' : model.executorReady === true ? '执行端就绪' : model.executorReady === false ? '执行端未就绪' : '连接待确认';
      content.append(heading, el('p', 'model-meta', `${model.executorLabel} · ${state}`),
        el('p', 'model-meta', `${model.checkLabel}${model.checkedAt ? ' · ' + time(model.checkedAt) : ''}`));
      if (model.selectionBlocked) content.append(el('p', 'model-meta', '需先在高级设置中选择为执行端当前模型'));
      if (model.capability) {
        const details = el('details', 'model-capability');
        details.append(el('summary', '', '能力说明 · 配置声明'), el('p', '', model.capability), el('small', '', '声明用于选型参考，不是实测能力分数。'));
        content.append(details);
      }
      const button = el('button', '', '用于对话');
      button.type = 'button'; button.disabled = model.unavailable === true || !model.enabled || model.executorReady === false || model.selectionBlocked === true;
      button.title = button.disabled ? '请先在高级设置启用模型并恢复执行端连接' : '选择模型，不会自动发送消息';
      button.addEventListener('click', () => onSelect(model.id));
      const actions = el('div', 'model-actions');
      actions.append(button);
      if (model.canChooseAgent && onConfigure) {
        const settings = el('button', '', '执行软件');
        settings.type = 'button'; settings.disabled = model.unavailable === true;
        settings.title = '选择后续新任务使用的执行软件';
        settings.addEventListener('click', () => onConfigure(model));
        actions.append(settings);
      }
      row.append(content, actions); container.append(row);
    }
  }
  function renderAccounts(container, accounts) {
    container.replaceChildren();
    for (const account of accounts) {
      const card = el('article', 'model-account');
      card.append(el('h3', '', account.label), el('strong', 'account-state', account.stateLabel));
      for (const window of account.windows || []) {
        const valid = typeof window.remaining === 'number' && Number.isFinite(window.remaining) && window.remaining >= 0 && window.remaining <= 100;
        card.append(el('p', 'account-window', `${window.label} · ${valid ? '剩余 ' + window.remaining + '%' : '未知'}`));
        if (valid) {
          const bar = el('progress'); bar.max = 100; bar.value = window.remaining;
          bar.setAttribute('aria-label', `${window.label}剩余 ${window.remaining}%`); card.append(bar);
        }
        if (window.resetLabel) card.append(el('small', 'model-meta', `重置：${time(window.resetLabel)}`));
      }
      card.append(el('p', 'model-meta', account.detail));
      if (account.updatedAt) card.append(el('small', 'model-meta', `数据时间：${time(account.updatedAt)}`));
      container.append(card);
    }
  }
  window.ModelCards = {renderModels, renderAccounts};
})();
