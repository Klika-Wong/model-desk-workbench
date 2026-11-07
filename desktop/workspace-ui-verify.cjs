'use strict';
const {app,BrowserWindow}=require('electron');
const path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
  const win=new BrowserWindow({show:false,width:1000,height:850,webPreferences:{offscreen:true,preload:path.join(__dirname,'ui-verify-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await win.loadFile(path.join(__dirname,'index.html'));await delay(150);
  const js=code=>win.webContents.executeJavaScript(code);
  const checks=await js(`(async()=>{
    const $=id=>document.getElementById(id), tick=()=>new Promise(r=>setTimeout(r,100)), result={};
    window.__workspaceUi.open();await tick();result.opens=$('workspace-dialog').open;
    result.sourceVisible=$('memory-source-list').textContent.includes('Fixture memory');
    document.querySelector('#memory-source-list button').click();await tick();result.importScoped=window.__stubCalls.all().some(c=>c.api==='memorySourceImport'&&c.id==='source-1');
    const input=document.querySelector('#workspace-projects input');input.value='Renamed';document.querySelectorAll('#workspace-projects button')[1].click();await tick();result.rename=window.__stubCalls.all().some(c=>c.api==='workspaceUpdate'&&c.changes.name==='Renamed');
    $('quota-auto-refresh').checked=false;$('quota-refresh-seconds').value='90';$('workspace-save-preferences').click();await tick();result.preferences=window.__stubCalls.all().some(c=>c.api==='workspacePreferences'&&c.values.quotaAutoRefresh===false&&c.values.quotaRefreshSeconds===90);
    $('workspace-move-preview').click();await tick();result.previewOnly=!$('workspace-move-plan').hidden&&!window.__stubCalls.all().some(c=>c.api==='workspaceMigrate');
    $('workspace-move-confirm').click();await tick();result.migrated=window.__stubCalls.all().filter(c=>c.api==='workspaceMigrate').length===1&&$('workspace-root').textContent==='E:/new-fixture-data';
    $('workspace-close').click();result.closed=!$('workspace-dialog').open;
    $('copy-ai-guide').click();await tick();result.guideCopied=window.__stubCalls.all().some(c=>c.api==='copyAiGuide');
    result.noInference=window.__stubCalls.all().every(c=>c.api!=='dispatchSend');return result;
  })()`);
  for(const [name,okay]of Object.entries(checks))if(!okay)throw new Error('Failed: '+name);
  for(const width of [600,1000])for(const theme of ['light','dark']){
    win.setContentSize(width,850);await js(`window.__workbenchShell.setTheme('${theme}');window.__workspaceUi.open()`);await delay(100);
    const okay=await js(`(()=>{const d=document.getElementById('workspace-dialog'),r=d.getBoundingClientRect(),s=getComputedStyle(d);return r.left>=0&&r.right<=innerWidth+1&&d.scrollWidth<=d.clientWidth+1&&s.color!==s.backgroundColor})()`);
    if(!okay)throw new Error('Workspace layout '+width+' '+theme);await js(`document.getElementById('workspace-close').click()`);
  }
  win.destroy();return {ok:true,checks:Object.keys(checks).length,layouts:4};
}
app.whenReady().then(run).then(result=>{process.stdout.write(JSON.stringify(result)+'\n');app.exit(0);}).catch(error=>{process.stdout.write(JSON.stringify({ok:false,error:error.message})+'\n');app.exit(1);});
