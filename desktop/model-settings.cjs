'use strict';
const http = require('node:http');
const {createHash} = require('node:crypto');
const {normalizeBase} = require('./panel-connector.cjs');
const AGENTS = new Set(['follow_global', 'dsh', 'pi']);
function createPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('模型配置格式不正确。');
  const allowed = new Set(['name','provider','api_base','model','api_key','api_key_env','default_agent','max_input_tokens','max_output_tokens']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('模型配置包含不支持的字段。');
  const required = (key, max) => {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].trim().length > max) throw new Error('请检查名称、模型 ID 和接口地址。');
    return input[key].trim();
  };
  const payload = {name:required('name',100),provider:input.provider,model:required('model',200),api_base:required('api_base',2048)};
  if (!['local','custom','deepseek','glm'].includes(payload.provider)) throw new Error('请选择支持的 API 或本地服务类型。');
  let url;
  try { url = new URL(payload.api_base); } catch { throw new Error('请输入有效的 http(s) Base URL。'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('接口地址不能含账号、密码、查询参数或片段。');
  payload.api_base = payload.api_base.replace(/\/+$/, '');
  if (!AGENTS.has(input.default_agent)) throw new Error('请选择有效的执行软件。');
  payload.default_agent = input.default_agent;
  for (const [key,max] of [['max_input_tokens',1048576],['max_output_tokens',131072]]) {
    if (!Number.isSafeInteger(input[key]) || input[key] < 64 || input[key] > max) throw new Error('输入和输出上限需为范围内的整数。');
    payload[key] = input[key];
  }
  if (input.api_key !== undefined && (typeof input.api_key !== 'string' || input.api_key.length > 16384)) throw new Error('密钥格式不正确。');
  if (input.api_key_env !== undefined && (typeof input.api_key_env !== 'string' || input.api_key_env && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.api_key_env))) throw new Error('环境变量名格式不正确。');
  if (input.api_key && input.api_key_env) throw new Error('密钥与环境变量请选择一种填写。');
  if (input.api_key) payload.api_key = input.api_key;
  if (input.api_key_env) payload.api_key_env = input.api_key_env;
  payload.enabled = true;
  payload.bypass_proxy = payload.provider === 'local';
  return payload;
}
function request(base, method, route, token, payload) {
  return new Promise((resolve,reject) => {
    const bytes = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const headers = token ? {'X-Panel-Token':token} : {};
    if (bytes) {headers['Content-Type']='application/json';headers['Content-Length']=bytes.length;}
    const req = http.request(new URL(route,base),{method,headers,timeout:8000},res=>{
      let body='';
      res.setEncoding('utf8');
      res.on('data',chunk=>{body+=chunk;if(body.length>1024*1024)res.destroy(new Error('响应过大'));});
      res.on('error',()=>reject(new Error('服务响应中断，请重新读取模型列表确认保存结果。')));
      res.on('end',()=>{let data;try{data=JSON.parse(body);}catch{}resolve({status:res.statusCode,data});});
    });
    // Never return raw provider errors, headers, payloads or key material.
    req.on('error',()=>reject(new Error('无法确认保存结果，请检查服务并重新读取模型列表；不要连续重复添加。')));
    req.on('timeout',()=>req.destroy());
    if(bytes)req.write(bytes);req.end();
  });
}
function managementBase(baseUrl) {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('工作台地址格式不正确。');
  return normalizeBase(baseUrl);
}
function modelId(id) {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id || '')) throw new Error('模型编号无效。');
  return id;
}
function connectionSnapshot(row) {
  const checked = createPayload({name:row.name,provider:row.provider,api_base:row.api_base,model:row.model,
    default_agent:'follow_global',max_input_tokens:row.max_input_tokens,max_output_tokens:row.max_output_tokens});
  const values = Object.fromEntries(['name','provider','api_base','model','max_input_tokens','max_output_tokens'].map(key=>[key,checked[key]]));
  // These fields are mandatory in the old full-save API; never replace them with form defaults.
  if (typeof row.enabled !== 'boolean' || typeof row.bypass_proxy !== 'boolean' || typeof row.api_key_env !== 'string') throw new Error('模型配置不完整，请使用高级设置核对后重试。');
  const preserved = {enabled:row.enabled,bypass_proxy:row.bypass_proxy,api_key_env:row.api_key_env};
  const version = createHash('sha256').update(JSON.stringify({values,preserved})).digest('hex');
  return {values,preserved,version};
}
async function currentConnection(base, token, id) {
  const state = await request(base,'GET','/api/state',token);
  if (state.status!==200 || !Array.isArray(state.data?.models)) throw new Error('无法读取当前模型配置，请刷新后重试。');
  const row = state.data.models.find(row=>row?.id===id);
  if (!row) throw new Error('模型已不存在，请刷新列表。');
  return connectionSnapshot(row);
}
async function settingsSession(base) {
  const session = await request(base,'GET','/api/session');
  if(session.status!==200 || typeof session.data?.token!=='string')throw new Error('无法建立本机工作台会话。');
  return session.data.token;
}
async function loadModelSettings(baseUrl,id) {
  modelId(id);
  const base = managementBase(baseUrl), token = await settingsSession(base);
  const current = await currentConnection(base,token,id);
  // No credential values or environment-variable names cross this IPC boundary.
  return {id,values:current.values,version:current.version};
}
async function saveModelSettings(baseUrl, operation) {
  const base = managementBase(baseUrl);
  let route, payload;
  if (operation?.action === 'create') {route='/api/models';payload=createPayload(operation.values);}
  else if (operation?.action === 'edit') {
    modelId(operation.id);
    const fields=['name','provider','api_base','model','max_input_tokens','max_output_tokens'];
    if (!operation.values || Object.keys(operation.values).some(key=>!fields.includes(key)) || !/^[a-f0-9]{64}$/.test(operation.version || '')) throw new Error('编辑数据无效，请重新打开模型设置。');
    const checked=createPayload({...operation.values,default_agent:'follow_global'});
    payload=Object.fromEntries(fields.map(key=>[key,checked[key]]));
    route=`/api/models/${operation.id}/save`;
  }
  else if (operation?.action === 'agent') {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(operation.id || '') || !AGENTS.has(operation.defaultAgent)) throw new Error('模型或执行软件无效。');
    route=`/api/models/${operation.id}/agent-default`;payload={default_agent:operation.defaultAgent};
  } else throw new Error('不支持的模型设置操作。');
  const token=await settingsSession(base);
  if (operation.action==='edit') {
    const current=await currentConnection(base,token,operation.id);
    if (current.version!==operation.version) throw new Error('模型配置已被其他操作修改，请关闭后重新打开编辑。');
    if (payload.provider!==current.values.provider) throw new Error('不能在编辑连接时更改服务类型，请另行添加模型。');
    payload={...payload,...current.preserved};
  }
  const reply=await request(base,'POST',route,token,payload);
  if (![200,201].includes(reply.status)) throw new Error(`未确认模型设置保存成功（HTTP ${reply.status}）。请刷新配置核对结果，并检查字段、运行中任务或高级设置。`);
  if(typeof reply.data?.id!=='string' || !reply.data.id)throw new Error('保存响应不完整，请重新读取列表确认；不要重复添加。');
  return {id:reply.data.id,name:typeof reply.data.name==='string'?reply.data.name:'',saved:true};
}
module.exports={createPayload,saveModelSettings,loadModelSettings};
