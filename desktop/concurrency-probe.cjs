// 并发探针：连续派两个本地模型任务，看时间是否重叠（切片 2 的第一问）。
//   node concurrency-probe.cjs          只打印说明
//   node concurrency-probe.cjs --real   真的派两个本地任务（本地推理，无云端费用）
const fs = require('node:fs');
const path = require('node:path');
const { buildTaskRequest, dispatchTask, listTasks, fetchTaskLog } = require('./task-dispatch.cjs');

const BT = String.fromCharCode(92);
const PROJECT = `E:${BT}fixture-workspace`;
const BASE = 'http://127.0.0.1:18765';
const MODEL = '5b0f8b9318c0'; // 本地 DeepSeek-R1 7B
const REAL = process.argv.includes('--real');

const PROMPTS = [
  { title: '并发探针 A', prompt: '请只回答一个数字：1。不要解释。' },
  { title: '并发探针 B', prompt: '请只回答一个数字：2。不要解释。' },
];

function ms(value) {
  const n = value ? Date.parse(value) : NaN;
  return Number.isNaN(n) ? null : n;
}

(async () => {
  if (!REAL) {
    console.log('将连续派发两个任务到本地模型：');
    for (const p of PROMPTS) console.log(' -', p.title, '|', p.prompt);
    console.log('\n加 --real 才会真的派发（本地模型，无云端费用）。');
    return;
  }

  const ids = [];
  const dispatchedAt = [];
  for (const item of PROMPTS) {
    const payload = buildTaskRequest({ prompt: item.prompt, modelId: MODEL, title: item.title, project: PROJECT });
    const sent = await dispatchTask({ baseUrl: BASE, payload, dryRun: false });
    ids.push(sent.id);
    dispatchedAt.push(Date.now());
    console.log('已派发', item.title, '→', sent.id, '|', sent.status);
  }

  console.log('等待两个任务结束（最长 9 分钟）…');
  const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'accepted']);
  const settledAt = ids.map(() => null);
  const snapshots = ids.map(() => null);
  const deadline = Date.now() + 540000;
  while (Date.now() < deadline && settledAt.some((value) => value === null)) {
    let tasks = [];
    try { tasks = await listTasks({ baseUrl: BASE, project: PROJECT }); } catch { tasks = []; }
    for (let index = 0; index < ids.length; index += 1) {
      const task = tasks.find((t) => t && t.id === ids[index]);
      if (!task) continue;
      snapshots[index] = task;
      const status = String(task.status || task.phase || '');
      if (settledAt[index] === null && TERMINAL.has(status)) settledAt[index] = Date.now();
    }
    if (settledAt.some((value) => value === null)) await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const rows = [];
  for (let index = 0; index < ids.length; index += 1) {
    const task = snapshots[index];
    const log = await fetchTaskLog({ baseUrl: BASE, taskId: ids[index], project: PROJECT });
    const startMs = task ? ms(task.started_at) : null;
    rows.push({
      title: PROMPTS[index].title,
      taskId: ids[index],
      status: task ? (task.status || task.phase) : 'unknown',
      dispatchedAt: new Date(dispatchedAt[index]).toISOString(),
      startedAt: task ? task.started_at : null,
      finishedAt: task ? task.finished_at : null,
      startMs,
      // 面板不返回 finished_at，只能记录轮询观察到终态的时间
      observedDoneAt: settledAt[index] === null ? null : new Date(settledAt[index]).toISOString(),
      runMs: startMs !== null && settledAt[index] !== null ? settledAt[index] - startMs : null,
      queueDelayMs: startMs === null ? null : startMs - dispatchedAt[index],
      usage: task ? task.usage : null,
      answer: log.answer,
    });
  }

  // 判定依据：两个任务几乎同时派发，若第二个明显晚开始，说明它在排队。
  const [a, b] = rows;
  const startGapMs = (a.startMs !== null && b.startMs !== null) ? b.startMs - a.startMs : null;
  const queueGapMs = (a.queueDelayMs !== null && b.queueDelayMs !== null) ? b.queueDelayMs - a.queueDelayMs : null;
  let verdict;
  if (startGapMs === null || queueGapMs === null) verdict = '无法判定（缺少开始时间）';
  else if (queueGapMs > 3000) verdict = `串行：第二个任务比第一个多等 ${Math.round(queueGapMs / 1000)} 秒才开跑`;
  else verdict = '并行：两个任务几乎同时开跑';

  const evidence = {
    recordedAt: new Date().toISOString(),
    baseUrl: BASE,
    model: '本地 DeepSeek-R1 7B（provider=local，无云端费用）',
    panelExecution: '面板 /api/state 自报：任务按顺序执行',
    tasks: rows,
    startGapMs,
    queueGapMs,
    verdict,
    caveat: '面板不返回 finished_at，重叠时长无法精确计算；这里用「派发时间差 vs 开始时间差」判断是否排队。',
  };
  fs.writeFileSync(path.join(__dirname, '..', 'docs', '验收证据-并发探针.json'), JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify({
    verdict, startGapMs, queueGapMs,
    tasks: rows.map((r) => ({ id: r.taskId, startedAt: r.startedAt, queueDelayMs: r.queueDelayMs, answer: r.answer })),
  }, null, 2));
})();
