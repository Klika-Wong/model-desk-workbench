'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const chatStore = require('./chat-store.cjs');

test('actual IPC handlers isolate projects, preserve unassigned legacy history and reject unopened writes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-ipc-'));
  const legacy = path.join(directory, 'chat.json');
  fs.writeFileSync(legacy, JSON.stringify({messages:[{role:'user',text:'unassigned legacy'}]}));
  const before = fs.readFileSync(legacy, 'utf8');
  const handlers = new Map();
  let selected = 'E:/fixture-a';
  const code = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  const start = code.indexOf('const openedChatProjects = new Set();');
  const end = code.indexOf("ipcMain.handle('mini:tasks'", start);
  assert.ok(start > 0 && end > start);
  vm.runInNewContext(code.slice(start, end), {
    chatStore, path, smokeMode:false, app:{getPath:()=>directory},
    ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},
    assertTrustedSender:event=>{if(!event.trusted)throw new Error('untrusted');},
    requireSelectedProject:project=>{if(project!==selected)throw new Error('wrong project');return selected;},
    asyncReply:async action=>{try{return {ok:true,data:await action()};}catch{return {ok:false};}},
  });
  const call = (name,...args)=>handlers.get(`chat:${name}`)({trusted:true},...args);
  assert.equal((await call('save', [{role:'user',text:'no'}], selected)).ok, false);
  assert.equal((await call('load', 'E:/fixture-b')).ok, false);
  assert.equal((await call('load', selected)).data.messages.length, 0);
  await call('save', [{role:'user',text:'A'}], selected);
  selected = 'E:/fixture-b';
  assert.equal((await call('load', selected)).data.messages.length, 0);
  await call('save', [{role:'user',text:'B'}], selected);
  // An already-open project may finish a queued save after navigation, to its own file only.
  await call('save', [{role:'user',text:'A latest'}], 'E:/fixture-a');
  assert.equal((await call('load', selected)).data.messages[0].text, 'B');
  await call('clear', selected);
  selected = 'E:/fixture-a';
  assert.equal((await call('load', selected)).data.messages[0].text, 'A latest');
  assert.equal((await call('clear', 'E:/unopened')).ok, false);
  assert.equal(fs.readFileSync(legacy, 'utf8'), before);
  assert.throws(()=>handlers.get('chat:load')({trusted:false},selected));
});
