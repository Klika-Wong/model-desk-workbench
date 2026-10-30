'use strict';

// 真实任务派发客户端（本机面板 127.0.0.1）。
// 分三步，任何一步都可单独验证：
//   1) buildTaskRequest  纯函数，构造并校验请求体（不联网）
//   2) dispatchTask      dryRun=true 只返回将要发送的内容；dryRun=false 才真的 POST
//   3) waitForTask       轮询 /api/state，按 task id 取最终状态
//
// 会真的调用模型并可能产生费用：只有显式传 dryRun:false 才发。

const http = require('node:http');

const MAX_PROMPT = 50000;
const KINDS = new Set(['chat', 'edit']);
// 面板枚举（model_router.CATEGORIES / LEVELS），写错会被 400 拒绝。
const CATEGORIES = new Set(['code_small', 'code_multi', 'debug', 'writing', 'extract', 'analysis', 'tests', 'other']);
const LEVELS = new Set(['simple', 'medium', 'complex']);

// 总任务时限（秒）：默认 0 表示不限；只有用户显式给的正数才启用。
// 不能静默回退成某个默认值，否则等于替用户改了预算。
function normalizeTimeout(value) {
  if (value === undefined) return 0;
  if (value === null) throw new Error('任务时限不能是 null；不限时请省略该参数或传 0。');
  if (typeof value === 'boolean' || Array.isArray(value) || typeof value === 'object') {
    throw new Error('任务时限必须是数字；不限时请省略该参数或传 0。');
  }
  let num;
  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string') {
    const raw = value.trim();
    if (raw === '') throw new Error('任务时限不能是空字符串；不限时请省略该参数或传 0。');
    if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`任务时限必须是有限的非负数字，收到：${value}`);
    num = Number(raw);
  } else {
    throw new Error('任务时限必须是数字；不限时请省略该参数或传 0。');
  }
  if (!Number.isFinite(num)) throw new Error(`任务时限必须是有限数字，收到：${value}`);
  if (num < 0) throw new Error(`任务时限不能是负数，收到：${value}`);
  return num;
}

function buildTaskRequest({ prompt, kind = 'chat', modelId, title = '', project = '', timeout, category = 'other', complexity = 'simple' } = {}) {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (!text) throw new Error('任务内容不能为空。');
  if (text.length > MAX_PROMPT) throw new Error(`任务内容最多 ${MAX_PROMPT} 个字符。`);
  if (!KINDS.has(kind)) throw new Error('任务类型只能是 chat 或 edit。');
  if (typeof modelId !== 'string' || modelId.trim() === '') throw new Error('必须指定 model_id。');
  if (project !== '' && !/^[A-Za-z]:[\\/]/.test(project)) throw new Error('项目必须是明确的绝对目录。');
  if (!CATEGORIES.has(category)) throw new Error(`任务类别无效：${category}`);
  if (!LEVELS.has(complexity)) throw new Error(`任务复杂度无效：${complexity}`);

  return {
    model_id: modelId.trim(),
    route_mode: 'manual',
    kind,
    title: String(title || text.slice(0, 24)).slice(0, 120),
    prompt: text,
    project,
    files: [],
    timeout: normalizeTimeout(timeout),
    request_output_tokens: null,
    routing: { category, complexity, input_tokens: 32, output_tokens: 64, expected_calls: 1 },
  };
}

function request(port, method, path, { headers = {}, payload } = {}) {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload), 'utf8');
    const allHeaders = { ...headers };
    if (body) { allHeaders['Content-Type'] = 'application/json'; allHeaders['Content-Length'] = body.length; }
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: allHeaders, timeout: 8000 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求超时。')));
    if (body) req.write(body);
    req.end();
  });
}

// 面板只接受本机回环地址。
function parsePort(baseUrl) {
  const url = new URL(String(baseUrl || 'http://127.0.0.1:8765'));
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('只支持本机 http://127.0.0.1 面板地址。');
  }
  return Number(url.port || 80);
}

function projectHeader(project) {
  // 面板用带填充的 base64url 解码（`base64.urlsafe_b64decode`），
  // 所以只替换 +/ 为 -_，**必须保留 '=' 填充**，否则报 Incorrect padding。
  const json = JSON.stringify(project ? { mode: 'project', project } : { mode: 'unbound', project: null });
  return Buffer.from(json, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

async function sessionToken(port) {
  const res = await request(port, 'GET', '/api/session');
  const token = res.json && res.json.token;
  if (res.status !== 200 || typeof token !== 'string') throw new Error(`取会话令牌失败（HTTP ${res.status}）。`);
  return token;
}

async function dispatchTask({ baseUrl = 'http://127.0.0.1:18765', payload, dryRun = true, token = null } = {}) {
  const port = parsePort(baseUrl);
  if (!payload || typeof payload !== 'object') throw new Error('缺少任务请求体。');
  if (dryRun) {
    return {
      dryRun: true,
      method: 'POST',
      url: `http://127.0.0.1:${port}/api/tasks`,
      headers: { 'X-Panel-Token': '<运行期会话令牌，不打印>', 'X-Model-Desk-View': projectHeader(payload.project) },
      body: payload,
      note: '未发出任何网络请求，也没有调用模型。',
    };
  }
  const realToken = token || await sessionToken(port);
  const res = await request(port, 'POST', '/api/tasks', {
    headers: { 'X-Panel-Token': realToken, 'X-Model-Desk-View': projectHeader(payload.project) },
    payload,
  });
  if (res.status !== 202 && res.status !== 200) {
    const reason = res.json && (res.json.error || res.json.message);
    throw new Error(`派发被拒绝（HTTP ${res.status}）${reason ? '：' + reason : ''}`);
  }
  const id = res.json && (res.json.id || (res.json.task && res.json.task.id));
  if (!id) throw new Error('派发返回里没有 task id，不能当作成功。');
  return { dryRun: false, id, status: (res.json.status || 'unknown'), raw: res.json };
}

// 轮询任务状态。必须带项目视图头，否则 /api/state 在未绑定视图下返回 0 条任务，
// 会被误判成“任务不存在”。
async function waitForTask({ baseUrl = 'http://127.0.0.1:18765', taskId, token = null, project = '', timeoutMs = 180000, intervalMs = 2000 } = {}) {
  const port = parsePort(baseUrl);
  const realToken = token || await sessionToken(port);
  const headers = { 'X-Panel-Token': realToken, 'X-Model-Desk-View': projectHeader(project) };
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await request(port, 'GET', '/api/state', { headers });
    const tasks = (res.json && res.json.tasks) || [];
    const task = tasks.find((t) => t && t.id === taskId);
    if (task) {
      last = task;
      const status = String(task.status || task.phase || '');
      if (['completed', 'failed', 'cancelled', 'accepted'].includes(status)) return task;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last;
}

// 事件流里真正的回答是普通文本行（其余是 JSON 事件）。
function extractAnswer(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('{'))
    .join('\n')
    .trim();
}

// 任务的 `result` 字段常为空，真正的输出在 /api/tasks/<id>/log 里（acpx 事件流）。
async function fetchTaskLog({ baseUrl = 'http://127.0.0.1:18765', taskId, token = null, project = '' } = {}) {
  const port = parsePort(baseUrl);
  const realToken = token || await sessionToken(port);
  const headers = { 'X-Panel-Token': realToken, 'X-Model-Desk-View': projectHeader(project) };
  const res = await request(port, 'GET', `/api/tasks/${encodeURIComponent(taskId)}/log`, { headers });
  if (res.status !== 200) throw new Error(`取任务日志失败（HTTP ${res.status}）。`);
  const text = (res.json && res.json.text) || '';
  return { text, answer: extractAnswer(text) };
}

// 上游执行器是单线程（ThreadPoolExecutor(max_workers=1)），所以只能排队。
// 这里如实算出「我正在排第几位」，不给用户假象。
function queuePosition(tasks, taskId) {
  if (!Array.isArray(tasks)) return null;
  const mine = tasks.find((t) => t && t.id === taskId);
  if (!mine) return null;
  const status = String(mine.status || mine.phase || '');
  if (!['queued', 'dispatching', 'pending'].includes(status)) return null;
  const waiting = tasks
    .filter((t) => t && ['queued', 'dispatching', 'pending'].includes(String(t.status || t.phase || '')))
    .map((t) => String(t.id))
    .sort();
  const index = waiting.indexOf(String(taskId));
  return index === -1 ? null : { position: index + 1, ahead: index };
}

// 面板会把执行器的 `*exit code: 1*` 照样记成 completed。
// 这里只做识别，不篡改状态：调用方需要自己把这种情况当失败显示。
// 只认“独占一行”的标记——正文里顺口提到退出码不算失败。
function exitCodeFailure(answer) {
  const lines = String(answer || '').split('\n');
  for (const line of lines) {
    const match = /^\*exit code:\s*(-?\d+)\*$/.exec(line.trim());
    if (!match) continue;
    const code = Number(match[1]);
    if (Number.isInteger(code) && code !== 0) return code;
  }
  return null;
}

// 一次取回当前项目下的任务列表（用于同时观察多个任务）。
async function listTasks({ baseUrl = 'http://127.0.0.1:18765', project = '', token = null } = {}) {
  const port = parsePort(baseUrl);
  const realToken = token || await sessionToken(port);
  const res = await request(port, 'GET', '/api/state', {
    headers: { 'X-Panel-Token': realToken, 'X-Model-Desk-View': projectHeader(project) },
  });
  if (res.status !== 200 || !res.json) throw new Error(`读取任务列表失败（HTTP ${res.status}）。`);
  return Array.isArray(res.json.tasks) ? res.json.tasks : [];
}

// 只读：可用模型清单（含 provider，用于提示本地/云端）。
async function listModels({ baseUrl = 'http://127.0.0.1:18765', token = null } = {}) {
  const port = parsePort(baseUrl);
  const realToken = token || await sessionToken(port);
  const res = await request(port, 'GET', '/api/state', { headers: { 'X-Panel-Token': realToken } });
  if (res.status !== 200 || !res.json) throw new Error(`读取模型清单失败（HTTP ${res.status}）。`);
  const models = (Array.isArray(res.json.models) ? res.json.models : [])
    .filter((m) => m && m.enabled !== false)
    .map((m) => ({ id: m.id, name: m.name || m.id, provider: m.provider || 'unknown', local: (m.provider || '') === 'local' }));
  return { defaultModel: res.json.default_model || null, models };
}

// 取消任务。已结束的任务面板会返回错误，这里原样透出，不假装成功。
async function cancelTask({ baseUrl = 'http://127.0.0.1:18765', taskId, project = '', token = null } = {}) {
  const port = parsePort(baseUrl);
  const realToken = token || await sessionToken(port);
  const res = await request(port, 'POST', `/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
    headers: { 'X-Panel-Token': realToken, 'X-Model-Desk-View': projectHeader(project) },
    payload: {},
  });
  if (res.status !== 200) {
    const reason = res.json && (res.json.error || res.json.message);
    throw new Error(`取消失败（HTTP ${res.status}）${reason ? '：' + reason : ''}`);
  }
  return res.json || {};
}

module.exports = { buildTaskRequest, dispatchTask, waitForTask, fetchTaskLog, extractAnswer, exitCodeFailure, queuePosition, listTasks, listModels, cancelTask, parsePort, projectHeader };
