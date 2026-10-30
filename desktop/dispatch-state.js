/* 派发任务状态文案：纯函数，浏览器与 Node 测试共用同一份实现。
 * 只读输入，不触碰 DOM、网络、文件；返回 { terminal, tone, label }。 */
(function (global) {
  'use strict';

  const TERMINAL = new Set(['completed', 'accepted', 'failed', 'cancelled']);
  const ACTIVE = new Set(['queued', 'pending', 'dispatching', 'running', 'in_progress', 'executing']);
  const ACCEPTED_REVIEW = new Set(['accepted', 'final_accepted']);

  function normalizeStatus(status) {
    if (typeof status !== 'string') return '';
    return status.trim().toLowerCase();
  }

  function reviewOf(task) {
    const review = task && task.review;
    return review && typeof review === 'object' ? review : {};
  }

  function stateOf(review) {
    return typeof review.state === 'string' ? review.state.trim().toLowerCase() : '';
  }

  // 只有有限的非零数字才说明执行器异常退出；undefined/null/0/NaN/Infinity/字符串都不算。
  function isExecutorFailure(exitCode) {
    return typeof exitCode === 'number' && Number.isFinite(exitCode) && exitCode !== 0;
  }

  function result(terminal, tone, label) {
    return { terminal, tone, label };
  }

  function describeTask(task, exitCode) {
    const status = normalizeStatus(task && task.status);
    const review = reviewOf(task);
    const reviewState = stateOf(review);
    const acceptanceValid = review.acceptance_valid === true;
    const executorFailed = isExecutorFailure(exitCode);

    // 失败或被取消：退出码非零优先显示错误，取消保持中性。
    if (status === 'failed') {
      const label = executorFailed ? `执行失败 · 退出码 ${exitCode}` : '执行失败';
      return result(true, 'error', label);
    }
    if (status === 'cancelled') {
      return executorFailed
        ? result(true, 'error', `已取消 · 退出码 ${exitCode}`)
        : result(true, 'neutral', '已取消');
    }

    // 已有验收结论时（accepted/completed），非零退出码说明结果无效。
    if (executorFailed) {
      return result(true, 'error', `执行器异常退出 · 退出码 ${exitCode}`);
    }

    if (status === 'completed') {
      if (acceptanceValid && ACCEPTED_REVIEW.has(reviewState)) {
        return result(true, 'success', reviewState === 'final_accepted' ? '主脑接管 · 已验收' : '已验收');
      }
      return result(true, 'neutral', '执行结束 · 待验收');
    }

    if (status === 'accepted') {
      if (acceptanceValid && ACCEPTED_REVIEW.has(reviewState)) {
        return result(true, 'success', reviewState === 'final_accepted' ? '主脑接管 · 已验收' : '已验收');
      }
      return result(true, 'neutral', '执行结束 · 验收待核实');
    }

    if (ACTIVE.has(status)) {
      const label = status === 'queued' || status === 'pending' ? '排队中' : '执行中';
      return result(false, 'neutral', label);
    }

    // 未知或缺失状态：保持非终态、中性，并如实说明未知。
    return result(false, 'neutral', '状态未知');
  }

  const api = { describeTask, TERMINAL, ACTIVE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.DispatchState = api;
})(typeof window !== 'undefined' ? window : globalThis);
