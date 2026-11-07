// 任务派发命令行（默认只 dry-run，不调用模型）。
//   node dispatch-cli.cjs                  只看将要发送的请求
//   node dispatch-cli.cjs --real           真的派发一次（会调用模型）
//   node dispatch-cli.cjs --status <id>    只查已完成任务的状态与回答，不新建任务
const fs = require('node:fs');
const path = require('node:path');
const { buildTaskRequest, dispatchTask, waitForTask, fetchTaskLog } = require('./task-dispatch.cjs');

const BT = String.fromCharCode(92);
const PROJECT = `E:${BT}fixture-workspace`;
const BASE = 'http://127.0.0.1:18765';
const MODEL = '5b0f8b9318c0'; // 本地 DeepSeek-R1 7B（provider=local）

async function status(taskId) {
  const task = await waitForTask({ baseUrl: BASE, taskId, project: PROJECT, timeoutMs: 15000, intervalMs: 1000 });
  const log = await fetchTaskLog({ baseUrl: BASE, taskId, project: PROJECT });
  const evidence = {
    recordedAt: new Date().toISOString(),
    baseUrl: BASE,
    taskId,
    model: task ? (task.model_name || task.model_id) : null,
    engine: task ? task.engine : null,
    status: task ? (task.status || task.phase) : 'unknown',
    startedAt: task ? task.started_at : null,
    usage: task ? task.usage : null,
    cost: task ? (task.cost ?? null) : null,
    costNote: 'cost 为 null：本地模型（provider=local），无货币计费；token 用量是真实回报。',
    answer: log.answer,
    answerSource: '/api/tasks/<id>/log（任务 result 字段为空，输出只在日志事件流里）',
  };
  fs.writeFileSync(path.join(__dirname, '..', 'docs', '验收证据-真实派发.json'), JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
}

(async () => {
  const idArg = process.argv.indexOf('--status');
  if (idArg !== -1) return status(process.argv[idArg + 1]);

  const payload = buildTaskRequest({
    prompt: '请只回答一个数字：2+2 等于几？不要解释。',
    modelId: MODEL,
    kind: 'chat',
    title: '连通性检查 · 2+2',
    project: PROJECT,
  });
  const preview = await dispatchTask({ baseUrl: BASE, payload, dryRun: true });
  console.log('=== DRY RUN（未发出，不调用模型）===');
  console.log(JSON.stringify(preview, null, 2));
  if (!process.argv.includes('--real')) {
    console.log('\n加 --real 才会真的派发。');
    return;
  }
  console.log('\n=== 真实派发 ===');
  const sent = await dispatchTask({ baseUrl: BASE, payload, dryRun: false });
  console.log('task id:', sent.id, '| 初始状态:', sent.status);
  console.log('用 node dispatch-cli.cjs --status ' + sent.id + ' 查看结果');
})();
