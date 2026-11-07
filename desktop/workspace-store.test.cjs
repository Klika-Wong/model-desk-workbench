'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {WorkspaceStore}=require('./workspace-store.cjs');
function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-folders-'));for(const name of ['home','project','target'])fs.mkdirSync(path.join(root,name));return {root,home:path.join(root,'home'),project:path.join(root,'project'),target:path.join(root,'target')};}
test('project entries persist and changing/removing a reference never touches project files',()=>{
  const f=setup(), store=new WorkspaceStore(f.home);
  fs.writeFileSync(path.join(f.project,'keep.txt'),'unchanged');
  let state=store.remember(f.project);assert.equal(state.selectedProject,f.project);
  assert.equal(store.remember(f.project).projects.length,1);
  const id=state.projects[0].id;store.update(id,{name:'Renamed'});
  assert.equal(new WorkspaceStore(f.home).read().projects[0].name,'Renamed');
  store.update(id,{path:f.target});assert.equal(store.read().selectedProject,f.target);
  store.update(id,{remove:true});assert.equal(store.read().selectedProject,null);
  assert.equal(fs.readFileSync(path.join(f.project,'keep.txt'),'utf8'),'unchanged');
});
test('verified data migration survives restart and retains original data, excluding profile and credentials',()=>{
  const f=setup(), store=new WorkspaceStore(f.home);store.remember(f.project);
  fs.writeFileSync(path.join(f.home,'memory.json'),JSON.stringify({fixture:true}));
  fs.writeFileSync(path.join(f.home,'models.json'),'never copy');
  fs.mkdirSync(path.join(f.home,'chats'));fs.writeFileSync(path.join(f.home,'chats','a'.repeat(64)+'.json'),'[]');
  const plan=store.preview(f.target);assert.equal(plan.files.length,3);
  const moved=store.migrate(plan);assert.equal(moved.dataRoot,f.target);
  assert.equal(moved.sourceRetained,true);
  assert.equal(new WorkspaceStore(f.home).snapshot().selectedProject,f.project);
  assert.equal(fs.existsSync(path.join(f.home,'memory.json')),true);
  assert.equal(fs.existsSync(path.join(f.target,'models.json')),false);
});
test('stale preview, nonempty and nested destinations cannot change location',()=>{
  const f=setup(), store=new WorkspaceStore(f.home);store.remember(f.project);
  const plan=store.preview(f.target);store.preferences({quotaRefreshSeconds:120});
  assert.throws(()=>store.migrate(plan),/变化/);assert.equal(store.root,f.home);
  fs.mkdirSync(path.join(f.home,'child'));
  assert.throws(()=>store.preview(path.join(f.home,'child')),/包含/);
  assert.throws(()=>store.preview(f.root),/包含/);
  fs.writeFileSync(path.join(f.target,'keep'),'keep');assert.throws(()=>store.preview(f.target),/空文件夹/);
});
test('validation failure rolls back only newly copied files and keeps source and pointer',()=>{
  const f=setup(),store=new WorkspaceStore(f.home);store.remember(f.project);
  fs.mkdirSync(path.join(f.home,'chats'));fs.writeFileSync(path.join(f.home,'chats','b'.repeat(64)+'.json'),'[]');
  assert.throws(()=>store.migrate(store.preview(f.target),()=>{throw new Error('validation failure');}),/validation/);
  assert.equal(store.root,f.home);assert.equal(fs.existsSync(store.pointer),false);
  assert.deepEqual(fs.readdirSync(f.target),[]);assert.equal(store.read().projects.length,1);
});
test('corrupt files and unsupported settings are rejected without overwriting',()=>{
  const f=setup(),store=new WorkspaceStore(f.home);
  assert.throws(()=>store.preferences({quotaRefreshSeconds:1}));
  assert.throws(()=>store.preferences({paid_allowed:true}));
  fs.writeFileSync(path.join(f.home,'memory.json'),'{broken');
  assert.throws(()=>store.preview(f.target),/解析/);
  assert.equal(fs.readFileSync(path.join(f.home,'memory.json'),'utf8'),'{broken');
});
test('linked data cannot be copied into a new location',t=>{
  const f=setup(),store=new WorkspaceStore(f.home);
  try{fs.symlinkSync(f.project,path.join(f.home,'chats'),'junction');}catch{t.skip('symlink unavailable');return;}
  assert.throws(()=>store.preview(f.target),/链接/);
  assert.equal(store.root,f.home);
});
