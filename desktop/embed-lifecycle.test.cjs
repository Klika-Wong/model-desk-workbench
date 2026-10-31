'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, 'main.cjs'), 'utf8');
const start = source.indexOf('let panelEmbedGeneration = 0;');
const end = source.indexOf('// ---- 真实任务派发', start);
assert.ok(start > 0 && end > start);
function deferred() { let resolve; const promise = new Promise(r => {resolve = r;}); return {resolve,promise}; }
function fixture({discover, load} = {}) {
  const calls = {attach:0, focus:0};
  const context = vm.createContext({
    panelView:null, panelAttached:false, panelAppearanceKey:null,
    discoverPanel: () => discover || Promise.resolve({state:'connected',baseUrl:'http://127.0.0.1:8765'}),
    safeBounds: value => value, applyPanelAppearance: async()=>{},
    mainWindow:{isDestroyed:()=>false,contentView:{addChildView:()=>calls.attach++,removeChildView:()=>{}},webContents:{executeJavaScript:async()=>{}}},
    WebContentsView:class {constructor(){this.webContents={setWindowOpenHandler:()=>{},on:()=>{},loadURL:()=>load||Promise.resolve(),focus:()=>calls.focus++};}setBounds(){}},
  });
  vm.runInContext(source.slice(start,end),context);
  return {context,calls};
}
test('main process does not attach after cancellation during discovery', async()=>{
  const wait=deferred();const {context,calls}=fixture({discover:wait.promise});
  const opening=context.embedPanel({width:100,height:100});
  context.hideEmbeddedPanel();wait.resolve({state:'connected',baseUrl:'http://127.0.0.1:8765'});
  await assert.rejects(opening,/取消/);assert.equal(calls.attach,0);assert.equal(calls.focus,0);
});
test('main process does not attach after cancellation during loading; later open works', async()=>{
  const wait=deferred();const {context,calls}=fixture({load:wait.promise});
  const opening=context.embedPanel({width:100,height:100});
  await Promise.resolve();context.hideEmbeddedPanel();wait.resolve();
  await assert.rejects(opening,/取消/);assert.equal(calls.attach,0);
  await context.embedPanel({width:100,height:100});assert.equal(calls.attach,1);assert.equal(calls.focus,1);
});
