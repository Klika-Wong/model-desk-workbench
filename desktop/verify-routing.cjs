'use strict';
// Cross-language contract check. Uses local source only; no server or model calls.
// Published layout defaults to ../.local-worker. Existing split installations may
// supply MODEL_DESK_SERVICE_ROOT and MODEL_DESK_PYTHON for their installed runtime.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildTaskRequest } = require('./task-dispatch.cjs');
const root = process.env.MODEL_DESK_SERVICE_ROOT || path.resolve(__dirname, '..');
const python = process.env.MODEL_DESK_PYTHON || path.join(root, '.local-worker', 'venv', 'Scripts', 'python.exe');
const inputs = [
  { prompt: 'short', kind: 'chat' },
  { prompt: '中文上下文'.repeat(2000), kind: 'chat' },
  { prompt: 'change one module', kind: 'edit' },
].map(value => buildTaskRequest({ ...value, modelId: 'fixture-model' }));
const run = spawnSync(python, ['-X', 'utf8', '-c',
  'import json, sys; sys.path.insert(0, sys.argv[1]); from model_router import requirements; print(json.dumps([requirements(body) for body in json.load(sys.stdin)]))',
  path.join(root, '.local-worker')], { input: JSON.stringify(inputs), encoding: 'utf8', windowsHide: true });
if (run.error || run.status !== 0) throw new Error('Routing contract check needs the configured Python/service dependencies; no model was called. ' + (run.error?.code || `exit ${run.status}`));
const result = JSON.parse(run.stdout);
assert.ok(result[1].estimated_input_tokens > result[0].estimated_input_tokens, '长中文提示词不能沿用短提示词估计');
assert.equal(result[1].estimated_input_tokens, Buffer.byteLength(inputs[1].prompt, 'utf8') + 2048);
assert.equal(result[0].output_tokens, 4096);
assert.equal(result[0].expected_calls, 1);
assert.equal(result[2].expected_calls, 3, '编辑任务采用服务端调用次数估计');
for (let i = 0; i < inputs.length; i++) {
  assert.equal(inputs[i].request_output_tokens, null);
  assert.equal(result[i].capacity.declared.input_tokens, null);
  assert.deepEqual(result[i].capacity.minimum, {}, '近似估计不能变成新增硬门禁');
}
console.log(JSON.stringify({ ok: true, checks: ['prompt-dependent-estimate', 'server-output-default', 'kind-dependent-calls', 'no-invented-capacity-minimum'], inputEstimates: result.map(r => r.estimated_input_tokens) }));
