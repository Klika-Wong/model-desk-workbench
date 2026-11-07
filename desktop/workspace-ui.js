(() => {
  const $=id=>document.getElementById(id);
  const settings=$('settings-dialog');if(!settings)return;
  let state=null, busy=false, migration=null;
  const section=document.createElement('details');section.className='project-folders';section.open=true;
  const summary=document.createElement('summary');summary.textContent='项目文件夹';section.append(summary);
  const shortcuts=document.createElement('div');shortcuts.id='project-shortcuts';section.append(shortcuts);
  $('sidebar-search').after(section);
  const open=document.createElement('button');open.type='button';open.id='open-workspace-settings';open.textContent='项目文件夹与数据位置';settings.append(open);
  const modal=document.createElement('dialog');modal.id='workspace-dialog';modal.className='wide-dialog';
  modal.innerHTML='<div class="dialog-heading"><h2>文件夹与自动更新</h2><button id="workspace-close" type="button">关闭</button></div><p id="workspace-message" class="hint" role="status"></p><h3>项目文件夹</h3><p class="hint">登记、改名和更换路径只管理入口，不移动或删除项目源文件。启动时尝试恢复上次项目。</p><button id="workspace-add" type="button">＋ 添加项目文件夹</button><div id="workspace-projects"></div><h3>工作台数据位置</h3><p id="workspace-root" class="hint"></p><p class="hint">迁移记忆库、画布、项目对话及本页设置。项目源码、协作服务账户/任务记录、浏览器外观缓存不在此迁移范围。原数据保留。</p><button id="workspace-move-preview" type="button">选择目标并预览迁移</button><div id="workspace-move-plan" hidden><p id="workspace-move-description"></p><button id="workspace-move-confirm" type="button">确认校验并迁移</button></div><h3>额度自动更新</h3><label><input id="quota-auto-refresh" type="checkbox">窗口可见时自动读取账户快照</label><label>刷新间隔（秒，30–600）<input id="quota-refresh-seconds" type="number" min="30" max="600" step="1" value="60"></label><p class="hint">复用服务缓存，不发起模型推理；没有支持接口的额度显示未知。软件隐藏到托盘时暂停读取。</p><button id="workspace-save-preferences" type="button">保存自动更新设置</button>';
  document.body.append(modal);
  const sourceSection=document.createElement('section');sourceSection.id='memory-source-section';
  sourceSection.innerHTML='<h3>本机记忆文件夹</h3><p class="hint">原文保存在本机。只导入根目录的 README、架构说明、使用手册为待确认条目；不读取隐藏目录或人类专属文件，不解压快照，也不自动发送给模型。</p><button id="memory-source-add" type="button">添加记忆目录</button><button id="memory-archive-add" type="button">添加快照目录</button><button id="memory-source-refresh" type="button">重新读取目录</button><div id="memory-source-list"></div>';
  $('workspace-move-plan').after(sourceSection);
  const say=(text,error=false)=>{$('workspace-message').textContent=text;$('workspace-message').classList.toggle('is-error',error);};
  function button(text,run){const el=document.createElement('button');el.type='button';el.textContent=text;el.addEventListener('click',run);return el;}
  async function act(run) {
    if(busy)return;busy=true;
    modal.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {const reply=await run();if(reply?.ok===false)throw new Error(reply.error||'操作失败');await refresh();await window.__projectUi?.refresh();}
    catch(error){say(error.message||'操作失败，请重试。',true);}
    finally{busy=false;modal.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  async function refresh() {
    const reply=await window.workbench.workspaceRead();
    if(!reply?.ok)throw new Error(reply?.error||'无法读取项目设置。');
    state=reply.data;
    $('workspace-root').textContent=state.dataRoot;
    $('quota-auto-refresh').checked=state.quotaAutoRefresh;
    $('quota-refresh-seconds').value=state.quotaRefreshSeconds;
    shortcuts.replaceChildren();$('workspace-projects').replaceChildren();
    for(const item of state.projects) {
      const select=()=>act(async()=>{const result=await window.workbench.workspaceSelect(item.id);if(result.ok)say('已切换项目。');return result;});
      const quick=button((state.activeProject===item.path?'● ':'')+item.name,select);quick.title=item.path;quick.className='project-shortcut';shortcuts.append(quick);
      const row=document.createElement('section');row.className='workspace-project-row';
      const name=document.createElement('input');name.value=item.name;name.maxLength=100;name.setAttribute('aria-label','项目名称');
      const location=document.createElement('p');location.className='hint';location.textContent=item.path;
      row.append(name,location,button('打开',select),button('保存名称',()=>act(()=>window.workbench.workspaceUpdate(item.id,{name:name.value}))),
        button('更换路径',()=>act(()=>window.workbench.workspaceUpdate(item.id,{pickPath:true}))),
        button('移除入口',()=>act(()=>window.workbench.workspaceUpdate(item.id,{remove:true}))));
      $('workspace-projects').append(row);
    }
    if(!state.projects.length){const hint=document.createElement('p');hint.className='hint';hint.textContent='尚未添加项目';shortcuts.append(hint);}
    window.dispatchEvent(new CustomEvent('workbench-preferences-changed',{detail:{quotaAutoRefresh:state.quotaAutoRefresh,quotaRefreshSeconds:state.quotaRefreshSeconds}}));
    const sources=await window.workbench.memorySources();
    if(!sources?.ok)throw new Error(sources?.error||'记忆来源暂不可读。');
    $('memory-source-list').replaceChildren();
    for(const source of sources.data){
      const row=document.createElement('section');row.className='workspace-project-row';
      const title=document.createElement('strong');title.textContent=(source.kind==='archive'?'快照 · ':'记忆 · ')+source.name;
      const location=document.createElement('p');location.className='hint';location.textContent=source.path;
      const info=document.createElement('p');info.className='hint';info.textContent=source.available?`已读取顶层目录：${source.files.length} 个说明或归档文件。`:source.error;
      row.append(title,location,info);
      if(source.kind==='memory'&&source.available)row.append(button('导入说明为待确认记忆',()=>act(async()=>{
        const result=await window.workbench.memorySourceImport(source.id);
        if(result.ok){say(`已导入 ${result.data.imported} 条，已有相同内容 ${result.data.unchanged} 条。请在「本机记忆说明」空间查看并确认。`);$('reload-memory')?.click();}
        return result;
      })));
      $('memory-source-list').append(row);
    }
    if(!sources.data.length)$('memory-source-list').textContent='尚未登记本机记忆目录。';
  }
  open.onclick=()=>{settings.close();modal.showModal();refresh().catch(e=>say(e.message,true));};
  $('workspace-close').onclick=()=>{if(!busy)modal.close();};
  modal.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('workspace-add').onclick=()=>act(async()=>{await window.workbench.chooseProject();say('项目入口已更新。');});
  $('memory-source-add').onclick=()=>act(()=>window.workbench.memorySourceAdd('memory'));
  $('memory-archive-add').onclick=()=>act(()=>window.workbench.memorySourceAdd('archive'));
  $('memory-source-refresh').onclick=()=>act(async()=>{say('已重新读取来源目录。');});
  $('workspace-save-preferences').onclick=()=>act(async()=>{
    const result=await window.workbench.workspacePreferences({quotaAutoRefresh:$('quota-auto-refresh').checked,quotaRefreshSeconds:Number($('quota-refresh-seconds').value)});
    if(result.ok)say('自动更新设置已保存。');return result;
  });
  $('workspace-move-preview').onclick=()=>act(async()=>{
    migration=null;$('workspace-move-plan').hidden=true;
    const result=await window.workbench.workspaceMigrationPreview();
    if(result.ok && !result.data.cancelled){migration=result.data;$('workspace-move-description').textContent=`从 ${migration.source} 迁入 ${migration.target}；${migration.files} 个数据文件，约 ${(migration.bytes/1024).toFixed(1)} KiB。将逐文件校验，原目录保留。`;$('workspace-move-plan').hidden=false;}
    return result;
  });
  $('workspace-move-confirm').onclick=()=>act(async()=>{
    if(!migration)throw new Error('请重新预览迁移。');
    const token=migration.token;migration=null;$('workspace-move-plan').hidden=true;
    const result=await window.workbench.workspaceMigrate(token);
    if(result.ok){say('迁移并校验完成，新目录已生效；原数据保留。');$('reload-memory')?.click();}
    return result;
  });
  window.addEventListener('workbench-project-changed',()=>refresh().catch(e=>say(e.message,true)));
  refresh().catch(e=>{shortcuts.textContent='项目设置暂不可读';say(e.message,true);});
  window.__workspaceUi={refresh,open:()=>open.click()};
})();
