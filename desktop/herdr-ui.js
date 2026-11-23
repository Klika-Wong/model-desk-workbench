/* Herdr agent runtime: read-only status panel.
 *
 * This module only calls window.workbench.herdrStatus(), a read-only IPC that
 * reads `hc ls --json` on the local machine.  It never dispatches a task, never
 * sends text to an agent, and never changes an execution endpoint.  Agent
 * statuses shown here are observation only: a "done" from herdr is not an
 * accepted task in this workbench.
 */
(function () {
  'use strict';
  var panel = document.querySelector('#herdr-details');
  if (!panel || !window.workbench || typeof window.workbench.herdrStatus !== 'function') return;

  var statusEl = document.querySelector('#herdr-status');
  var agentsEl = document.querySelector('#herdr-agents');
  var refreshBtn = document.querySelector('#herdr-refresh');
  var timer = null;
  var lastSignature = '';
  var loading = false;

  function text(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function stateLabel(row) {
    if (row.live_state === 'finished') return '已结束';
    if (row.agent_state === 'working') return '工作中';
    if (row.agent_state === 'blocked') return '等待你';
    if (row.agent_state === 'idle') return '空闲';
    if (row.live_state === 'live') return '运行中（未上报状态）';
    return '状态未知';
  }

  function render(data) {
    if (!data) return;
    if (!data.ready) {
      statusEl.textContent = (data.message || 'herdr 未就绪') + '（只读观测，未派发任何任务）';
      statusEl.dataset.health = 'error';
      agentsEl.replaceChildren();
      lastSignature = '';
      return;
    }
    var counts = data.counts || {};
    statusEl.textContent = 'herdr-core ' + (data.version || '') + ' · 终端 ' + (counts.total || 0) +
      ' · 工作 ' + (counts.working || 0) + ' · 等待你 ' + (counts.needs_you || 0) +
      ' · 只读观测，未派发任何任务';
    statusEl.dataset.health = 'ok';

    var rows = data.terminals || [];
    var signature = JSON.stringify(rows);
    if (signature === lastSignature) return;
    lastSignature = signature;

    var nodes = rows.map(function (row) {
      var item = document.createElement('div');
      item.className = 'herdr-agent';
      item.dataset.state = row.live_state === 'finished' ? 'finished' : (row.agent_state || row.live_state || 'unknown');
      item.appendChild(text('span', 'herdr-agent-address', row.address));
      item.appendChild(text('span', 'herdr-agent-name', row.agent || row.title || '终端'));
      item.appendChild(text('span', 'herdr-agent-state', stateLabel(row)));
      if (row.cwd) item.appendChild(text('span', 'herdr-agent-cwd', row.cwd));
      return item;
    });
    if (!nodes.length) nodes.push(text('p', 'hint', 'herdr-core 可连接，当前没有运行中的终端。'));
    agentsEl.replaceChildren.apply(agentsEl, nodes);
  }

  async function load() {
    if (document.hidden || loading) return;
    loading = true;
    try {
      var reply = await window.workbench.herdrStatus();
      render(reply.ok ? reply.data : {ready: false, message: reply.error});
    } catch (error) {
      render({ready: false, message: 'herdr 状态读取失败'});
    } finally {
      loading = false;
    }
  }

  function ensureTimer() {
    if (panel.open && !timer) {
      load();
      timer = window.setInterval(load, 5000);
    } else if (!panel.open && timer) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  if (refreshBtn) refreshBtn.addEventListener('click', load);
  panel.addEventListener('toggle', ensureTimer);
  ensureTimer();
})();
