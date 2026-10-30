'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { probePanel, normalizeBase, projectForHeader } = require('./panel-connector.cjs');

function stub(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('normalizeBase 只接受本机 http', () => {
  assert.equal(normalizeBase('http://localhost:8765/'), 'http://localhost:8765');
  assert.equal(normalizeBase('http://127.0.0.1:8765'), 'http://127.0.0.1:8765');
  assert.throws(() => normalizeBase('http://evil.example.com:8765'), /本机/);
  assert.throws(() => normalizeBase('https://127.0.0.1:8765'), /本机/);
});

test('未监听端口 → unreachable', async () => {
  const r = await probePanel('http://127.0.0.1:1');
  assert.equal(r.state, 'unreachable');
  assert.equal(r.executors.length, 0);
});

test('正常面板 → connected，并解析执行端状态与任务数', async () => {
  const stateViews = [];
  const { server, port } = await stub((req, res) => {
    if (req.url === '/api/session') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ token: 'TKN' })); return; }
    if (req.url === '/api/state') {
      stateViews.push(JSON.parse(Buffer.from(String(req.headers['x-model-desk-view'] || ''), 'base64url').toString('utf8')));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        agent: { name: 'Dsh' },
        models: [{id: 'local-fixture', name: 'Local', provider: 'local', secret: 'secret-fixture-do-not-forward'}],
        tasks: [{ id: 'a', project:'E:/x', status:'running',engine:'dsh',model_id:'7b',model_name:'本地模型' }, { id: 'b', project:'E:/x' }, {id:'foreign',project:'E:/other',title:'禁止混入'}],
        execution: '任务按顺序执行',
        workspace: 'E:/x',
        execution_endpoints: { rows: [
          { id: 'dsh', name: 'DSH', enabled: true, ready: true, current_model: 'fixture-local-model' },
          { id: 'workbuddy', name: 'WorkBuddy', enabled: true, ready: false, current_model: 'workbuddy-deepseek-flash' },
          { id: 'pi', name: 'Pi', enabled: false, ready: false, current_model: null },
          { id: 'unknown', name: 'Unknown' },
        ] },
      }));
      return;
    }
    res.statusCode = 404; res.end('{}');
  });
  try {
    const r = await probePanel(`http://127.0.0.1:${port}`, 'E:/x');
    assert.equal(r.state, 'connected');
    assert.equal(r.overview.models[0].name, 'Local');
    assert.doesNotMatch(JSON.stringify(r.overview), /secret-fixture-do-not-forward/);
    assert.equal(r.taskList.some(t=>t.id==='foreign'),false);
    const unbound=await probePanel(`http://127.0.0.1:${port}`);
    assert.equal(unbound.tasks,0);
    assert.deepEqual(unbound.taskList,[]);
    const all = await probePanel(`http://127.0.0.1:${port}`, null, 'all');
    assert.equal(all.scope, 'all');
    assert.equal(all.tasks, 3);
    assert.equal(all.taskList.some(t => t.id === 'foreign'), true);
    assert.deepEqual(all.projects, ['E:/x', 'E:/other']);
    assert.deepEqual(stateViews.map(v => v.mode), ['project', 'unbound', 'all']);
    assert.equal(r.tasks, 2);
    assert.equal(r.runningTasks.length, 1);
    assert.equal(r.runningTasks[0].modelId, '7b');
    assert.equal(r.runningTasks[0].engine, 'dsh');
    assert.equal(r.taskList[0].engine, 'dsh');
    assert.equal(r.hub, '主导身份未报告');
    assert.equal(r.executors.length, 4);
    assert.equal(r.executors.find(x=>x.id==='unknown').status,'unknown');
    assert.equal(r.executors.find((x) => x.id === 'dsh').status, 'ok');
    assert.equal(r.executors.find((x) => x.id === 'workbuddy').status, 'error');
    assert.equal(r.executors.find((x) => x.id === 'pi').status, 'idle');
    assert.equal(r.executors.find((x) => x.id === 'dsh').model, 'fixture-local-model');
  } finally { server.close(); }
});

test('会话接口异常 → error', async () => {
  const { server, port } = await stub((req, res) => { res.statusCode = 500; res.end('{}'); });
  try {
    const r = await probePanel(`http://127.0.0.1:${port}`);
    assert.equal(r.state, 'error');
  } finally { server.close(); }
});

test('HTTP200空对象不能当成面板连接成功',async()=>{const {server,port}=await stub((req,res)=>{res.end(JSON.stringify(req.url==='/api/session'?{token:'test-only'}:{}));});try{const r=await probePanel(`http://127.0.0.1:${port}`);assert.equal(r.state,'error');}finally{server.close();}});

test('发往面板的项目路径先规范化：折叠重复与尾部分隔符，保留大小写', () => {
  const BT = String.fromCharCode(92); // 反斜杠，避免多层转义出错
  const proj = `E:${BT}model-desk-fixture`;
  assert.equal(projectForHeader('E://model-desk-fixture'), proj, '双斜杠要折叠');
  assert.equal(projectForHeader('E:/model-desk-fixture'), proj, '正斜杠转反斜杠');
  assert.equal(projectForHeader(`${proj}${BT}`), proj, '尾部分隔符要去掉');
  assert.equal(projectForHeader(`E:${BT}MixedCase${BT}Sub`), `E:${BT}MixedCase${BT}Sub`, '不能改大小写');
  assert.equal(projectForHeader(`relative${BT}path`), null, '相对路径必须拒绝');
  assert.equal(projectForHeader(''), null);
});
