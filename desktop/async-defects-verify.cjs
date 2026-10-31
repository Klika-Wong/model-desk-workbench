'use strict';
const {app, BrowserWindow} = require('electron');
const path = require('node:path');
const results = [];
app.on('window-all-closed', () => {});
async function check(name, code, predicate) {
  const win = new BrowserWindow({show:false, webPreferences:{preload:path.join(__dirname,'ui-verify-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await win.loadFile(path.join(__dirname,'index.html'));
  await new Promise(r=>setTimeout(r,150));
  try {
    const actual = await win.webContents.executeJavaScript(`(async()=>{${code}})()`);
    results.push({name,pass:predicate(actual),actual});
  } finally {win.destroy();}
}
app.whenReady().then(async()=>{
  await check('late advanced view cannot reclaim navigation', `
    window.__stubCalls.holdEmbed();
    const opening=window.__workbenchShell.openAdvanced();
    document.getElementById('nav-chat').click();
    window.__stubCalls.releaseEmbeds(); await opening;
    await new Promise(r=>setTimeout(r,20));
    return {shown:window.__workbenchShell.isPanelShown(), active:[...document.querySelectorAll('.nav-button.active')].map(n=>n.id), hides:window.__stubCalls.all().filter(c=>c.api==='panelEmbedHide').length};
  `, r=>!r.shown && r.active.join()==='nav-chat' && r.hides>0);
  await check('duplicate chat send before task ID is not dispatched twice', `
    document.getElementById('nav-chat').click();
    await window.__chatUi.selectModel('m-local');
    const input=document.getElementById('chat-input');input.value='测试';input.dispatchEvent(new Event('input'));
    document.getElementById('chat-consent').checked=true;
    window.__stubCalls.holdState();
    const first=window.__chatUi.send();const second=window.__chatUi.send();
    window.__stubCalls.releaseStates();await Promise.all([first,second]);
    return {sends:window.__stubCalls.all().filter(c=>c.api==='dispatchSend').length};
  `, r=>r.sends===1);
  await check('changed consent during preparation prevents dispatch', `
    document.getElementById('nav-chat').click();
    await window.__chatUi.selectModel('m-local');
    document.getElementById('chat-input').value='测试';
    const consent=document.getElementById('chat-consent');consent.checked=true;
    window.__stubCalls.holdState();const sending=window.__chatUi.send();
    consent.checked=false;consent.dispatchEvent(new Event('change'));
    window.__stubCalls.releaseStates();await sending;
    return {sends:window.__stubCalls.all().filter(c=>c.api==='dispatchSend').length};
  `, r=>r.sends===0);
  await check('advanced close and reopen serializes IPC and follows latest intent', `
    window.__stubCalls.holdEmbed();
    const first=window.__workbenchShell.openAdvanced();
    window.__workbenchShell.openAdvanced();
    const during=window.__stubCalls.all().filter(c=>c.api==='panelEmbed').length;
    window.__workbenchShell.hideAdvanced();
    const next=window.__workbenchShell.openAdvanced();
    window.__stubCalls.releaseEmbeds();await Promise.all([first,next]);
    return {during,total:window.__stubCalls.all().filter(c=>c.api==='panelEmbed').length,shown:window.__workbenchShell.isPanelShown(),locked:document.documentElement.classList.contains('panel-embedded')};
  `, r=>r.during===1 && r.total===2 && !r.shown && !r.locked);
  await check('crash invalidates pending advanced response', `
    window.__stubCalls.holdEmbed();const opening=window.__workbenchShell.openAdvanced();
    window.__workbenchShell.onPanelGone('fixture crash');
    window.__stubCalls.releaseEmbeds();await opening;
    return {shown:window.__workbenchShell.isPanelShown(),locked:document.documentElement.classList.contains('panel-embedded')};
  `, r=>!r.shown && !r.locked);
  await check('project change during preparation prevents dispatch', `
    await window.__chatUi.selectModel('m-local');
    document.getElementById('chat-input').value='测试';document.getElementById('chat-consent').checked=true;
    window.__stubCalls.holdState();const sending=window.__chatUi.send();
    window.__stubCalls.setProject('E:/different-fixture');window.dispatchEvent(new Event('workbench-project-changed'));
    window.__stubCalls.releaseStates();await sending;
    return {sends:window.__stubCalls.all().filter(c=>c.api==='dispatchSend').length};
  `, r=>r.sends===0);
  await check('clearing chat cannot detach an executing task', `
    await window.__chatUi.selectModel('m-local');window.__stubCalls.setSendOk(true);
    document.getElementById('chat-input').value='测试';document.getElementById('chat-consent').checked=true;
    await window.__chatUi.send();
    const clear=document.getElementById('chat-clear');clear.click();
    return {disabled:clear.disabled,pending:window.__chatUi.state().pendingTask,clears:window.__stubCalls.all().filter(c=>c.api==='chatClear').length};
  `, r=>r.disabled && r.pending==='task-1' && r.clears===0);
  process.stdout.write(JSON.stringify({ok:results.every(r=>r.pass),results})+'\n');
  app.exit(results.every(r=>r.pass)?0:1);
}).catch(error=>{process.stdout.write(JSON.stringify({ok:false,error:error.message})+'\n');app.exit(1);});
