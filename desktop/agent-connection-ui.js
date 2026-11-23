(() => {
  const form = document.querySelector('#agent-connection-form');
  const session = form.elements.session;
  const bound = form.elements.bound;
  const status = document.querySelector('#agent-connection-status');
  bound.addEventListener('change', () => {
    session.disabled = !bound.checked;
    session.required = bound.checked;
    if (!bound.checked) session.value = '';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const reply = await window.workbench.copyAgentConnection(form.elements.host.value.trim(),
        bound.checked ? session.value.trim() : '');
      status.textContent = reply.ok ? '已复制 ' + reply.data.project + ' 的配置。粘贴到该 Agent 的 MCP 设置，重新加载后调用 brain_connect。' : reply.error;
    } catch {
      status.textContent = '复制失败，请重新打开工作台后重试。';
    } finally {
      button.disabled = false;
    }
  });
})();
