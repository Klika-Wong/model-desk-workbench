'use strict';

// Real probe for the local workbench panel service (default 127.0.0.1:8765).
// Loopback only. GET /api/session returns a token; GET /api/state returns the
// snapshot (models, tasks, execution_endpoints.rows...). Mutations need
// X-Panel-Token, but the probe below only reads.

const http = require('node:http');
const path = require('node:path');
const { normalizeOverview } = require('./model-overview.cjs');
function projectKey(value) { return typeof value === 'string' && path.win32.isAbsolute(value) ? path.win32.normalize(value).replace(/[\\/]+$/, '').toLowerCase() : null; }
// 发给面板的路径必须先规范化：`E://a` 这类写法面板会直接 400，报错又难懂。
// 保留原始大小写，只折叠重复分隔符与尾部分隔符。
function projectForHeader(value) {
  if (projectKey(value) === null) return null;
  return path.win32.normalize(value).replace(/[\\/]+$/, '');
}
function viewHeader(project, scope) { return Buffer.from(JSON.stringify(scope === 'all' ? {mode:'all',project:null} : project ? {mode:'project',project} : {mode:'unbound',project:null})).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'); }

const DEFAULT_BASE = 'http://127.0.0.1:8765';

function normalizeBase(baseUrl) {
  const raw = String(baseUrl || DEFAULT_BASE).trim() || DEFAULT_BASE;
  let url;
  try { url = new URL(raw); } catch { throw new Error('面板地址无效。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('面板地址只能是本机 http://127.0.0.1 或 http://localhost。');
  }
  return url.origin;
}

function isUnreachable(error) {
  const code = error && error.code;
  return code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND' || code === 'ECONNRESET';
}

function getJson(url, { headers = {}, timeout = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers, timeout }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* non-JSON */ }
        resolve({ status: response.statusCode, json });
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('面板响应超时。'), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
  });
}

function normalizeExecutors(data) {
  const ep = data && data.execution_endpoints;
  const rows = ep && Array.isArray(ep.rows) ? ep.rows : (Array.isArray(ep) ? ep : []);
  return rows.filter(row => row && typeof row === 'object').map((row) => {
    const enabled = row.enabled !== false;
    const ready = typeof row.ready === 'boolean' ? row.ready : null;
    return {
      id: String(row.id),
      label: row.name || String(row.id),
      enabled,
      ready,
      model: row.current_model || (row.model && (row.model.name || row.model.id)) || null,
      modelId: row.current_model || row.model?.id || null,
      modelName: row.model?.name || null,
      status: !enabled ? 'idle' : (ready === null ? 'unknown' : (ready ? 'ok' : 'error')),
      evidence: 'panel-reported',
    };
  });
}

function hubLabel(data) {
  // data.agent reports the selected execution engine, not the project's lead AI.
  return '主导身份未报告';
}

async function probePanel(baseUrl = DEFAULT_BASE, project = null, scope = 'project') {
  if (!['project', 'all'].includes(scope)) return {state:'error',message:'无效的项目视图。',executors:[]};
  if (project !== null && !projectKey(project)) return {state:"error",message:"项目必须是明确的绝对目录。",executors:[]};
  const projectHeader = scope === 'all' || project === null ? null : projectForHeader(project);
  let base;
  try { base = normalizeBase(baseUrl); } catch (error) { return { state: 'error', baseUrl: String(baseUrl || ''), message: error.message, hub: '本机主脑', executors: [] }; }

  let session;
  try { session = await getJson(`${base}/api/session`, { timeout: 1500 }); }
  catch (error) { return { state: isUnreachable(error) ? 'unreachable' : 'error', baseUrl: base, message: error.message, hub: '本机主脑', executors: [] }; }
  if (session.status !== 200 || !session.json || typeof session.json.token !== 'string') {
    return { state: 'error', baseUrl: base, message: `面板会话异常（HTTP ${session.status}）`, hub: '本机主脑', executors: [] };
  }

  let snapshot;
  try { snapshot = await getJson(`${base}/api/state`, { headers: { 'X-Panel-Token': session.json.token, 'X-Model-Desk-View': viewHeader(projectHeader, scope) }, timeout: 4000 }); }
  catch (error) { return { state: isUnreachable(error) ? 'unreachable' : 'error', baseUrl: base, message: error.message, hub: '本机主脑', executors: [] }; }
  if (snapshot.status !== 200 || !snapshot.json) {
    return { state: 'error', baseUrl: base, message: `面板状态异常（HTTP ${snapshot.status}）`, hub: '本机主脑', executors: [] };
  }

  const data = snapshot.json;
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.tasks) || !data.execution_endpoints || !Array.isArray(data.execution_endpoints.rows ?? data.execution_endpoints)) return {state:'error',baseUrl:base,message:'面板状态结构不匹配，未确认连接。',hub:'本机主脑',executors:[]};
  const tasksRaw = scope === 'all' ? data.tasks.filter(t => t && projectKey(t.project)) : project ? data.tasks.filter(t => t && projectKey(t.project) === projectKey(project)) : [];
  const projects = [...new Set(tasksRaw.map(t => t.project).filter(Boolean))];
  const taskList = tasksRaw.slice(0, 20).map((t) => ({
    id: String(t.id || ''),
    title: String(t.title || t.id || '未命名任务').slice(0, 120),
    status: String(t.status || t.phase || 'unknown'),
    model: t.model_name || t.model_id || (t.model && (t.model.name || t.model.id)) || '',
    modelId: String(t.model_id || (t.model && t.model.id) || ''),
    engine: typeof t.engine === 'string' ? t.engine : '',
    project: typeof t.project === 'string' ? t.project : '',
    reviewState: typeof t.review?.state === 'string' ? t.review.state : '',
    reviewLabel: typeof t.review?.label === 'string' ? t.review.label : '',
    acceptanceValid: typeof t.review?.acceptance_valid === 'boolean' ? t.review.acceptance_valid : null,
  }));
  return {
    project: projectHeader,
    scope,
    state: 'connected',
    baseUrl: base,
    message: '已连接本机工作台',
    hub: hubLabel(data),
    executors: normalizeExecutors(data),
    overview: normalizeOverview(data),
    tasks: tasksRaw.length,
    projects,
    runningTasks: tasksRaw.filter(t => t.status === 'running').map(t => ({status:'running',engine:typeof t.engine === 'string' ? t.engine : '',modelId:String(t.model_id || ''),model:String(t.model_name || t.model_id || ''),project:t.project})),
    truncated: tasksRaw.length > taskList.length,
    taskList,
    execution: typeof data.execution === 'string' ? data.execution : '',
    workspace: typeof data.workspace === 'string' ? data.workspace : '',
  };
}

// Try a list of loopback endpoints and return the first that is really running.
async function discoverPanel(candidates = ['http://127.0.0.1:8765', 'http://127.0.0.1:18765']) {
  let last = null;
  for (const base of candidates) {
    const result = await probePanel(base);
    if (result.state === 'connected') return result;
    if (!last || last.state !== 'error' || result.state === 'error') last = result;
  }
  return last || { state: 'unreachable', baseUrl: candidates[0], message: '未发现运行中的工作台', hub: '本机主脑', executors: [] };
}

module.exports = { probePanel, discoverPanel, normalizeBase, projectForHeader, DEFAULT_BASE };
