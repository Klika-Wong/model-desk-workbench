'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createPayload,saveModelSettings,loadModelSettings}=require('./model-settings.cjs');
const values=()=>({name:'Example',provider:'local',api_base:'http://127.0.0.1:11434/v1',model:'example:7b',default_agent:'dsh',max_input_tokens:32768,max_output_tokens:4096});
async function serverTest(run, respond) {
  const calls=[];
  const server=http.createServer((req,res)=>{
    let raw='';req.setEncoding('utf8');req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
      calls.push({method:req.method,path:req.url,token:req.headers['x-panel-token'],body:raw?JSON.parse(raw):null});
      res.setHeader('Content-Type','application/json');
      if(req.url==='/api/session')return res.end(JSON.stringify({token:'test-session-only'}));
      if(respond)return respond(res,req,calls);
      res.end(JSON.stringify({id:'m1',name:'Example',api_key:'fixture-secret-response',secret:'fixture-encrypted-response'}));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run(`http://127.0.0.1:${server.address().port}`,calls);}finally{await new Promise(resolve=>server.close(resolve));}
}
test('create validates fields and never enables budget bypass, default switching or inference',()=>{
  const body=createPayload(values());assert.equal(body.bypass_proxy,true);assert.equal(body.enabled,true);
  assert.equal(body.make_default,undefined);assert.equal(body.api_key,undefined);
  for(const key of ['make_default','paid_allowed','clear_key','subagent'])assert.throws(()=>createPayload({...values(),[key]:true}));
});

test('editing keeps authentication source, disabled/proxy flags and omits unrelated fields',async()=>{
  const row={id:'m1',...values(),enabled:false,bypass_proxy:true,api_key_env:'EXAMPLE_MODEL_KEY',secret:'fixture-secret',api_key:'fixture-plain',default_agent:'pi'};
  await serverTest(async(base,calls)=>{
    const loaded=await loadModelSettings(base,'m1');
    assert.deepEqual(Object.keys(loaded).sort(),['id','values','version']);
    assert.equal(JSON.stringify(loaded).includes('fixture-secret'),false);
    assert.equal(JSON.stringify(loaded).includes('EXAMPLE_MODEL_KEY'),false);
    await saveModelSettings(base,{action:'edit',id:'m1',version:loaded.version,values:{...loaded.values,name:'Renamed'}});
    const post=calls.find(c=>c.method==='POST');
    assert.equal(post.path,'/api/models/m1/save');
    assert.deepEqual(post.body,{...loaded.values,name:'Renamed',enabled:false,bypass_proxy:true,api_key_env:'EXAMPLE_MODEL_KEY'});
    assert.equal(calls.filter(c=>c.method==='POST').length,1);
    assert.equal(calls.some(c=>c.path.includes('/test')),false);
  },(res,req)=>res.end(JSON.stringify(req.url==='/api/state'?{models:[row]}:{id:'m1'})));
});

test('stale edits, native models and secret injection fail before a write',async()=>{
  const row={id:'m1',...values(),enabled:true,bypass_proxy:true,api_key_env:''};
  await serverTest(async(base,calls)=>{
    const loaded=await loadModelSettings(base,'m1');
    const edit={action:'edit',id:'m1',version:loaded.version,values:loaded.values};
    await assert.rejects(saveModelSettings(base,{...edit,values:{...edit.values,api_key:'fixture'}}),/无效/);
    await assert.rejects(saveModelSettings(base,{...edit,values:{...edit.values,provider:'custom'}}),/服务类型/);
    row.enabled=false;
    await assert.rejects(saveModelSettings(base,edit),/其他操作修改/);
    row.provider='workbuddy';
    await assert.rejects(loadModelSettings(base,'m1'),/API 或本地/);
    assert.equal(calls.some(c=>c.method==='POST'),false);
  },res=>res.end(JSON.stringify({models:[row]})));
});
test('invalid provider, URL and numeric limits are rejected without echoing values',()=>{
  for(const value of ['workbuddy','zcode','invalid'])assert.throws(()=>createPayload({...values(),provider:value}));
  for(const api_base of ['file:///test','https://user:fixture-private@api.example/v1','https://api.example/v1?key=fixture-private']) {
    assert.throws(()=>createPayload({...values(),api_base}),e=>!e.message.includes('fixture-private'));
  }
  for(const n of [null,true,NaN,Infinity,0,63,1.5,1048577])assert.throws(()=>createPayload({...values(),max_input_tokens:n}));
});
test('keys are write-only and mutually exclusive with environment names',()=>{
  assert.throws(()=>createPayload({...values(),api_key:'fixture',api_key_env:'MODEL_API_KEY'}));
  assert.throws(()=>createPayload({...values(),api_key_env:'bad name'}));
  const body=createPayload({...values(),provider:'custom',api_base:'https://api.example/v1',api_key_env:'MODEL_API_KEY'});
  assert.equal(body.api_key_env,'MODEL_API_KEY');assert.equal(body.bypass_proxy,false);
});
test('create makes only authenticated session and create calls; response cannot expose secrets',async()=>{
  await serverTest(async(base,calls)=>{
    const saved=await saveModelSettings(base,{action:'create',values:{...values(),api_key:'fixture-write-only'}});
    assert.deepEqual(saved,{id:'m1',name:'Example',saved:true});
    assert.deepEqual(calls.map(c=>[c.method,c.path]),[['GET','/api/session'],['POST','/api/models']]);
    assert.equal(calls[1].token,'test-session-only');assert.equal(calls[1].body.api_key,'fixture-write-only');
  });
});
test('agent change sends only default_agent, preserving connection, credentials and budgets',async()=>{
  await serverTest(async(base,calls)=>{
    await saveModelSettings(base,{action:'agent',id:'m1',defaultAgent:'pi'});
    assert.equal(calls[1].path,'/api/models/m1/agent-default');
    assert.deepEqual(calls[1].body,{default_agent:'pi'});
  });
});
test('server errors and incomplete results cannot leak key material or claim success',async()=>{
  await serverTest(async base=>{
    await assert.rejects(saveModelSettings(base,{action:'create',values:values()}),e=>/HTTP 400/.test(e.message)&&!e.message.includes('fixture-private'));
  },res=>{res.statusCode=400;res.end(JSON.stringify({error:'fixture-private'}));});
  await serverTest(async base=>{
    await assert.rejects(saveModelSettings(base,{action:'create',values:values()}),/响应不完整/);
  },res=>res.end('{}'));
});
test('only loopback management endpoints and safe model IDs are accepted',async()=>{
  for(const base of ['https://example.com','http://example.com','http://127.0.0.1/?private=1','http://user:password@127.0.0.1'])await assert.rejects(saveModelSettings(base,{action:'agent',id:'m1',defaultAgent:'dsh'}));
  await assert.rejects(saveModelSettings('http://127.0.0.1:1',{action:'agent',id:'../other',defaultAgent:'dsh'}),/无效/);
});
