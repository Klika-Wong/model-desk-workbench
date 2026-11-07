'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {MemorySources}=require('./memory-sources.cjs'),{MemoryStore}=require('./memory-store.cjs');
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-sources-')),folder=path.join(root,'source');fs.mkdirSync(folder);return {root,folder,store:new MemorySources(root),memory:new MemoryStore(path.join(root,'memory.json'))};}
test('imports only allowlisted root guides as candidates, ignores private folders and archives; repeat is idempotent',()=>{
  const f=fixture();fs.writeFileSync(path.join(f.folder,'README.md'),'fixture guide');fs.writeFileSync(path.join(f.folder,'private.md'),'do not import');fs.mkdirSync(path.join(f.folder,'.workbuddy'));fs.writeFileSync(path.join(f.folder,'.workbuddy','private.md'),'do not import');
  const source=f.store.add(f.folder,'memory')[0];assert.equal(source.files.length,2);
  assert.equal(f.store.importGuides(source.id,f.memory).imported,1);assert.equal(f.store.importGuides(source.id,f.memory).unchanged,1);
  const space=f.memory.snapshot().spaces.find(s=>s.name==='本机记忆说明');assert.equal(space.entries.length,1);assert.equal(space.entries[0].status,'candidate');assert.equal(space.entries[0].body,'fixture guide');
});
test('archive is metadata only; links and protected directory names rejected',()=>{
  const f=fixture();fs.writeFileSync(path.join(f.folder,'backup.zip'),'fixture');const source=f.store.add(f.folder,'archive')[0];assert.equal(source.files[0].canImport,false);assert.throws(()=>f.store.importGuides(source.id,f.memory));
  const link=path.join(f.root,'link');fs.symlinkSync(f.folder,link,process.platform==='win32'?'junction':'dir');assert.throws(()=>f.store.add(link,'memory'));
  const protectedDir=path.join(f.root,'加密');fs.mkdirSync(protectedDir);assert.throws(()=>f.store.add(protectedDir,'memory'));
});
test('refuses oversized or linked guide before any memory write',()=>{
  const f=fixture();fs.writeFileSync(path.join(f.folder,'README.md'),'okay');fs.writeFileSync(path.join(f.folder,'架构说明.md'),'a'.repeat(128*1024+1));const s=f.store.add(f.folder,'memory')[0],before=f.memory.snapshot();assert.throws(()=>f.store.importGuides(s.id,f.memory));assert.deepEqual(f.memory.snapshot(),before);
});
test('corrupt registry is not overwritten',()=>{const f=fixture();fs.writeFileSync(f.store.file,'broken');assert.throws(()=>f.store.add(f.folder,'memory'));assert.equal(fs.readFileSync(f.store.file,'utf8'),'broken');});
