'use strict';

// 小窗任务列表的组装规则（纯函数，便于测试）。
// 原则：只读当前项目的真实任务；拿不到就退回演示任务，并把原因写清楚，不假装是真实数据。

const STATUS_LABEL = {
  running: '运行中',
  in_progress: '执行中',
  executing: '执行中',
  queued: '排队中',
  pending: '等待中',
  completed: '已完成',
  accepted: '已验收',
  cancelled: '已取消',
  failed: '失败',
  blocked: '需要处理',
};

function labelOf(status) {
  return STATUS_LABEL[String(status || '').toLowerCase()] || '未知';
}

function mapPanelTasks(scope) {
  const rows = Array.isArray(scope && scope.taskList) ? scope.taskList : [];
  return rows.map((task) => {
    let state = task.status === 'completed' ? '执行结束 · 待验收' : labelOf(task.status);
    if (['accepted', 'final_accepted'].includes(task.reviewState)) {
      state = task.acceptanceValid === false ? '验收失效 · 待复核' : task.acceptanceValid !== true ? '验收待核实' : task.reviewState === 'final_accepted' ? '主脑接管 · 已验收' : '已验收';
    } else if (task.reviewState === 'returned') state = '已退回整改';
    else if (task.reviewState === 'blocked') state = '需要主脑处理';
    return {
      id: String(task.id || ''),
      label: String(task.title || task.id || '未命名任务'),
      status: String(task.status || 'unknown'),
      state,
    };
  });
}

// panel: probePanel 的结果；project: 当前选中项目；demo: 演示任务数组
function composeMiniPayload({ panel, project, demo } = {}) {
  const demoRows = Array.isArray(demo) ? demo.map((task) => ({
    id: String(task.id || ''),
    label: String(task.label || task.title || '演示任务'),
    status: String(task.status || 'unknown'),
    state: labelOf(task.status),
  })) : [];

  if (panel && panel.state === 'connected') {
    if (!project) return { tasks: [], source: 'real', note: '未绑定项目：请在主窗口选择项目' };
    return {
      tasks: mapPanelTasks(panel),
      source: 'real',
      note: `${panel.tasks ?? panel.taskList.length} 条任务${panel.truncated ? '（仅显示前 20 条）' : ''}`,
      project: String(project),
    };
  }
  const reason = panel && panel.state === 'unreachable' ? '未发现运行中的工作台' : (panel && panel.message) || '未连接工作台';
  return { tasks: demoRows, source: 'demo', note: `演示任务 · ${reason}` };
}

module.exports = { composeMiniPayload, mapPanelTasks, labelOf };
