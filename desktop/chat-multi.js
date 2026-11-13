(function (global) {
'use strict';

// 多视角对比：同一问题分发给多个模型，各自独立跟踪。
// 纯逻辑放在这里，UI 只负责渲染与轮询。

const MAX_BRANCHES = 3;

// 从"可用模型"里挑出用户选中的分支，保持用户选择顺序，去重，最多 3 个。
function pickModels(available, selectedIds, limit = MAX_BRANCHES) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  const list = Array.isArray(available) ? available : [];
  const seen = new Set();
  const picked = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const model = list.find((item) => item && item.id === id);
    if (!model) continue;
    seen.add(id);
    picked.push(model);
    if (picked.length >= limit) break;
  }
  return picked;
}

// 一条分支的初始状态。
function createBranch(model, index) {
  return {
    key: `${index + 1}`,
    modelId: String((model && model.id) || ''),
    modelName: String((model && model.name) || (model && model.id) || '未命名模型'),
    local: Boolean(model && model.local),
    status: 'queued',
    taskId: null,
    answer: '',
    tokens: null,
    error: '',
    queue: null,
  };
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'accepted']);
// 上游执行器单线程，这几个状态是「在排队」而不是「在生成」。
// 分支卡片本来就有「排队中」标签，只是 applyStatus 把所有非终态都压成了 running。
const WAITING = new Set(['queued', 'pending', 'dispatching']);

// 把面板状态映射成分支状态；退出码非零一律算失败，不冒充完成。
function applyStatus(branch, { state, answer, exitCode, tokens, error, queue } = {}) {
  const raw = String(state || '');
  if (answer != null) branch.answer = String(answer);
  if (tokens != null) branch.tokens = tokens;
  // 每次都用本次快照覆盖：留着上一轮的位次会把已完成分支说成还在排队。
  branch.queue = queue && Number.isFinite(queue.ahead) && queue.ahead > 0 ? queue : null;
  if (exitCode != null && exitCode !== 0) {
    branch.status = 'failed';
    branch.error = `执行器异常退出（exit code ${exitCode}），结果无效`;
    branch.queue = null;
    return branch;
  }
  if (raw === 'completed' || raw === 'accepted') {
    branch.status = 'done';
    branch.queue = null;
  } else if (raw === 'failed' || raw === 'cancelled' || raw === 'blocked') {
    branch.status = 'failed';
    branch.queue = null;
    if (!branch.error) branch.error = error || (raw === 'cancelled' ? '已取消' : '执行失败');
  } else if (WAITING.has(raw)) branch.status = 'queued';
  else if (raw) branch.status = 'running';
  return branch;
}

function isSettled(branch) {
  return Boolean(branch) && (branch.status === 'done' || branch.status === 'failed');
}

// 本地等待上限，不是模型的执行时限，也不会去取消服务端任务。
// 协作视图的 runTurn 用的是同一个 3 分钟；这里保持一致，不另立一个数字。
// 没有它，面板掉线或任务卡在 running 时，轮询永远不收敛，整页发送会被永久禁用。
const WAIT_TIMEOUT_MS = 180000;

// 超时只说明「没等到终态」，不能冒充任务失败原因，也不能抹掉已经拿到的正文。
function markWaitTimeout(branch, waitMs = WAIT_TIMEOUT_MS) {
  if (!branch || isSettled(branch)) return branch;
  const minutes = Math.round(waitMs / 60000);
  branch.status = 'failed';
  branch.error = `等待超过 ${minutes} 分钟仍未拿到终态；任务可能还在执行，请到「运行与连接」页查看。`;
  branch.queue = null;
  return branch;
}

// 停止一组任务后的状态文案：确认多少、有几个没确认，都照实说。
function groupCancelMessage({ ok = 0, failed = 0, total = 0 } = {}) {
  if (!total) return '已停止这一组的本地等待；还没有派发出去的任务。';
  const tail = '本地等待已停止，任务状态请到「运行与连接」页查看。';
  return failed
    ? `已对 ${total} 个任务发出停止请求：${ok} 个确认、${failed} 个未确认。${tail}`
    : `已对 ${total} 个任务发出停止请求并全部确认。${tail}`;
}

// 汇总：给界面和"能否采纳"用，不猜结论。
function summarize(branches) {
  const list = Array.isArray(branches) ? branches : [];
  const done = list.filter((b) => b.status === 'done');
  const failed = list.filter((b) => b.status === 'failed');
  return {
    total: list.length,
    done: done.length,
    failed: failed.length,
    settled: list.filter(isSettled).length,
    allSettled: list.length > 0 && list.every(isSettled),
    // 只有拿到非空回答的分支才能被采纳
    adoptable: done.filter((b) => String(b.answer || '').trim().length > 0).map((b) => b.key),
    tokenTotal: list.reduce((sum, b) => sum + (Number(b.tokens) || 0), 0),
  };
}

const api = {
  MAX_BRANCHES, TERMINAL, WAITING, WAIT_TIMEOUT_MS,
  pickModels, createBranch, applyStatus, isSettled, summarize,
  markWaitTimeout, groupCancelMessage, buildDiscussionPrompt,
};

// 讨论模式：多个模型串行发言，每个能看到前面所有人的发言。
// 返回下一个发言者的 prompt（问题 + 此前发言 + 让其直接给观点）。
function buildDiscussionPrompt({ question, spoken }) {
  const q = String(question || '').trim();
  if (!q) throw new Error('讨论需要一个明确的问题');
  const lines = [
    '你在参与一个多模型讨论。请基于前面所有人的发言给出你的观点：可以赞同、补充或反驳，但不要重复别人已经说过的内容。',
    '',
    '问题：' + q,
  ];
  const history = Array.isArray(spoken) ? spoken : [];
  const readable = history.filter((turn) => turn && String(turn.text || '').trim());
  if (readable.length) {
    lines.push('', '此前发言：');
    for (const turn of readable) {
      lines.push(`【${String(turn.modelName || '模型')}】${String(turn.text).trim()}`);
    }
  }
  lines.push('', '你的发言（直接输出观点，不要复述问题或他人发言）：');
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.__chatMulti = api;
})(typeof window !== 'undefined' ? window : globalThis);
