'use strict';
const {app,BrowserWindow}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const win=new BrowserWindow({show:false,width:1000,height:900,webPreferences:{offscreen:true,preload:path.join(__dirname,'ui-verify-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await win.loadFile(path.join(__dirname,'index.html'));
  const js=code=>win.webContents.executeJavaScript(code);
  await js(`window.__stubCalls.enablePanelFixture();document.getElementById('nav-panel').click()`);
  await delay(150);
  const result=await js(`(async()=>{
    const $=id=>document.getElementById(id), tick=()=>new Promise(r=>setTimeout(r,50));
    const out={};
    $('models-add').click();out.createOpened=$('model-settings-dialog').open;
    $('model-setting-key').value='fixture-only';$('model-settings-cancel').click();await tick();
    out.closeClearsKey=$('model-setting-key').value==='';
    $('models-add').click();
    $('model-setting-name').value='Example';$('model-setting-model').value='fixture:7b';$('model-setting-key').value='fixture-only';
    $('model-settings-form').requestSubmit();$('model-settings-form').requestSubmit();
    out.oneRequest=window.__stubCalls.all().filter(c=>c.api==='modelSettingsSave').length===1;
    out.keyCleared=$('model-setting-key').value==='';out.locked=$('model-connection-fields').disabled && $('model-setting-agent').disabled;
    const cancellation=new Event('cancel',{cancelable:true});$('model-settings-dialog').dispatchEvent(cancellation);out.cancelPrevented=cancellation.defaultPrevented;
    window.__stubCalls.releaseSettings();await tick();
    out.closedAfterSave=!$('model-settings-dialog').open;
    const create=window.__stubCalls.all().find(c=>c.api==='modelSettingsSave');
    out.keyProvided=create.keyProvided;out.targetBase=create.base;out.noInference=window.__stubCalls.all().every(c=>c.api!=='dispatchSend');
    document.querySelector('.model-row .model-actions button:nth-child(2)').click();
    out.agentOnly=$('model-connection-fields').hidden && $('model-setting-agent').value==='dsh';
    $('model-setting-agent').value='pi';$('model-settings-form').requestSubmit();window.__stubCalls.releaseSettings();await tick();
    out.agentPayload=window.__stubCalls.all().filter(c=>c.api==='modelSettingsSave').at(-1).operation;
    $('models-add').click();$('model-setting-name').value='Failure';$('model-setting-model').value='fixture';$('model-setting-key').value='fixture-only';
    window.__stubCalls.failSettings(true);$('model-settings-form').requestSubmit();window.__stubCalls.releaseSettings();await tick();
    out.failureKeepsForm=$('model-settings-dialog').open && !$('model-settings-save').disabled;
    out.failureClearsKey=$('model-setting-key').value==='';
    $('model-settings-cancel').click();await tick();
    return out;
  })()`);
  const expected=['createOpened','closeClearsKey','oneRequest','keyCleared','locked','cancelPrevented','closedAfterSave','keyProvided','noInference','agentOnly','failureKeepsForm','failureClearsKey'];
  for(const key of expected)if(result[key]!==true)throw new Error(`${key}: ${JSON.stringify(result)}`);
  if(JSON.stringify(result.agentPayload)!==JSON.stringify({action:'agent',id:'m-local',defaultAgent:'pi'}))throw new Error('Agent update widened its payload');
  if(result.targetBase!=='http://127.0.0.1:8765')throw new Error('Settings did not bind to the displayed service');
  const layouts=[];
  for(const width of [600,1000])for(const theme of ['light','dark']){
    win.setContentSize(width,850);
    await js(`window.__workbenchShell.setTheme('${theme}');document.getElementById('models-add').click()`);
    await delay(100);
    const layout=await js(`(()=>{const d=document.getElementById('model-settings-dialog');const r=d.getBoundingClientRect();const b=getComputedStyle(d);return {open:d.open,left:r.left,right:r.right,width:innerWidth,overflow:d.scrollWidth>d.clientWidth+1,bg:b.backgroundColor,fg:b.color};})()`);
    if(!layout.open||layout.left<0||layout.right>width+1||layout.overflow||layout.bg===layout.fg)throw new Error('Dialog layout: '+JSON.stringify(layout));
    layouts.push({width,theme,...layout});
    if(process.env.MODEL_DESK_SCREENSHOTS){fs.mkdirSync(process.env.MODEL_DESK_SCREENSHOTS,{recursive:true});fs.writeFileSync(path.join(process.env.MODEL_DESK_SCREENSHOTS,`settings-${width}-${theme}.png`),(await win.webContents.capturePage()).toPNG());}
    await js(`document.getElementById('model-settings-cancel').click()`);await delay(20);
  }
  win.destroy();return {ok:true,checks:expected.length+2,result,layouts};
}
app.whenReady().then(main).then(result=>{process.stdout.write(JSON.stringify(result)+'\n');app.exit(0);}).catch(error=>{process.stdout.write(JSON.stringify({ok:false,error:error.message})+'\n');app.exit(1);});
