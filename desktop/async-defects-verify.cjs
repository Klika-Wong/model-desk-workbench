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
  await check('performance reads serialize and stop while hidden or closed', `
    Object.defineProperty(document,'hidden',{configurable:true,value:false});
    window.__stubCalls.holdPerformance();document.getElementById('open-performance').click();
    document.getElementById('refresh-performance').click();document.getElementById('refresh-performance').click();
    const before=window.__stubCalls.all().filter(c=>c.api==='performanceSample').length;
    Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
    window.__stubCalls.releasePerformance();await new Promise(r=>setTimeout(r,30));
    const stale=document.getElementById('performance-values').textContent;
    Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r=>setTimeout(r,30));
    const text=document.getElementById('performance-values').textContent;
    document.getElementById('close-performance').click();await new Promise(r=>setTimeout(r,30));
    document.getElementById('refresh-performance').click();
    return {before,reads:window.__stubCalls.all().filter(c=>c.api==='performanceSample').length,stale,text};
  `, r=>r.before===1 && r.reads===2 && !r.stale.includes('12.5%') && r.text.includes('12.5%') && r.text.includes('整机占用'));
  await check('temporary status failure retains task and cancellation control without redispatch', `
    await window.__chatUi.selectModel('m-local');window.__stubCalls.setSendOk(true);window.__stubCalls.failStatus(1);
    document.getElementById('chat-input').value='retry lookup';document.getElementById('chat-consent').checked=true;
    await window.__chatUi.send();await new Promise(r=>setTimeout(r,30));
    const pending=window.__chatUi.state().pendingTask;
    document.getElementById('chat-cancel').click();await new Promise(r=>setTimeout(r,30));
    const afterCancel=window.__chatUi.state().pendingTask;
    await new Promise(r=>setTimeout(r,4100));
    return {pending,afterCancel,ended:window.__chatUi.state().pendingTask,sends:window.__stubCalls.all().filter(c=>c.api==='dispatchSend').length,cancels:window.__stubCalls.all().filter(c=>c.api==='dispatchCancel').length};
  `, r=>r.pending==='task-1' && r.afterCancel==='task-1' && !r.ended && r.sends===1 && r.cancels===1);
  await check('accepted result is successful history, not failed answer', `
    await window.__chatUi.selectModel('m-local');window.__stubCalls.setSendOk(true);window.__stubCalls.terminalStatus('accepted');
    document.getElementById('chat-input').value='accepted';document.getElementById('chat-consent').checked=true;
    await window.__chatUi.send();await new Promise(r=>setTimeout(r,2100));
    return {messages:window.__chatUi.state().messages,text:document.getElementById('chat-log').textContent};
  `, r=>r.messages===3 && r.text.includes('已验收') && !r.text.includes('失败'));
  await check('failed clear keeps conversation and reports failure', `
    window.__stubCalls.failChatClear(true);document.getElementById('chat-clear').click();await new Promise(r=>setTimeout(r,30));
    return {messages:window.__chatUi.state().messages,status:document.getElementById('chat-status').textContent};
  `, r=>r.messages===1 && r.status.includes('清空失败'));
  await check('command search exposes current navigation without removed view switch', `
    window.__palette.clearRecent();window.__palette.open();
    const text=document.getElementById('palette-list').textContent;
    const search=document.getElementById('palette-input');search.value='对话';search.dispatchEvent(new Event('input'));
    document.querySelector('#palette-list [role=option]').click();
    return {text,chatVisible:!document.getElementById('chat-page').hidden};
  `, r=>r.chatVisible && r.text.includes('模型与额度') && r.text.includes('高级设置') && !r.text.includes('新版界面') && !r.text.includes('原版工作台'));
  await check('project switch clears prior conversation and outgoing consent', `
    await window.__chatUi.selectModel('m-local');
    document.getElementById('chat-input').value='private draft';
    document.getElementById('chat-consent').checked=true;
    document.getElementById('chat-use-history').checked=true;
    window.__stubCalls.setProject('E:/different-fixture');window.dispatchEvent(new Event('workbench-project-changed'));
    await new Promise(r=>setTimeout(r,80));
    return {messages:window.__chatUi.state().messages,draft:document.getElementById('chat-input').value,history:document.getElementById('chat-use-history').checked,text:document.getElementById('chat-log').textContent};
  `, r=>r.messages===0 && !r.draft && !r.history && !r.text.includes('上次的第一句'));
  await check('late task answer cannot enter another project conversation', `
    await window.__chatUi.selectModel('m-local');window.__stubCalls.setSendOk(true);
    document.getElementById('chat-input').value='project A';document.getElementById('chat-consent').checked=true;
    await window.__chatUi.send();
    window.__stubCalls.setProject('E:/different-fixture');window.dispatchEvent(new Event('workbench-project-changed'));
    await new Promise(r=>setTimeout(r,2200));
    return {messages:window.__chatUi.state().messages,text:document.getElementById('chat-log').textContent,saves:window.__stubCalls.all().filter(c=>c.api==='chatSave').map(c=>c.project)};
  `, r=>r.messages===0 && !r.text.includes('最终回答') && !r.saves.includes('E:/different-fixture'));
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
