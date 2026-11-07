'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cache=require('./model-cache.cjs');
test('offline cache persists only display fields and never infers readiness or quota',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-cache-'));assert.equal(cache.read(root),null);
  cache.save(root,{models:[{id:'m1',name:'local',enabled:true,executorReady:true,api_key:'synthetic-private',api_base:'https://private.invalid',capability:'private-notes'}],accounts:[{remaining:50}]});
  const raw=fs.readFileSync(path.join(root,'model-cache.json'),'utf8');assert.ok(!raw.includes('private'));assert.ok(!raw.includes('remaining'));
  const result=cache.read(root);assert.equal(result.cached,true);assert.equal(result.models[0].executorReady,null);assert.equal(result.accounts[0].windows.length,0);
});
