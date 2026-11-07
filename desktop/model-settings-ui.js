(() => {
  const $=id=>document.getElementById(id);
  const dialog=$('model-settings-dialog');
  if(!dialog)return;
  let target=null, base='', saving=false, loading=false, mode='create', version='', revision=0;
  const field=name=>$('model-setting-'+name);
  function message(text,error=false){$('model-settings-message').textContent=text;$('model-settings-message').classList.toggle('is-error',error);}
  function clearSecret(){field('key').value='';}
  async function open(model,serviceBase,action='agent'){
    if(saving)return;
    if(!serviceBase){window.__modelsUi?.status('请先连接服务并读取模型列表。',true);return;}
    const request=++revision;
    target=model;base=serviceBase;mode=model?action:'create';version='';loading=mode==='edit';
    $('model-settings-form').reset();clearSecret();
    $('model-settings-advanced').open=false;
    $('model-settings-title').textContent=mode==='edit' ? `编辑连接 · ${model.name}` : model ? `执行软件 · ${model.name}` : '添加模型连接';
    $('model-connection-fields').hidden=mode==='agent';
    $('model-connection-fields').disabled=mode==='agent' || loading;
    $('model-settings-auth').hidden=mode==='edit';
    field('provider').disabled=mode==='edit';
    field('agent').disabled=mode==='edit';
    field('agent').value=model ? model.defaultAgent : 'follow_global';
    $('model-settings-save').disabled=loading;
    $('model-settings-cancel').disabled=false;
    message(mode==='edit' ? '正在读取当前连接…' : model ? '只影响后续新任务。现有任务、API 密钥和预算保持原配置。' : '连接在所有项目中可用。保存不会测试或调用模型；首个启用模型会成为服务默认。');
    dialog.showModal();
    window.__modelsUi?.invalidate();
    (model?field('agent'):field('name')).focus();
    if (loading) {
      try {
        const reply=await window.workbench.modelSettingsLoad(serviceBase,model.id);
        if (request!==revision || !dialog.open) return;
        if (!reply?.ok || !reply.data?.version) throw new Error(reply?.error || '无法读取连接，请重新打开编辑。');
        const values=reply.data.values;
        for(const [fieldName,key] of [['name','name'],['provider','provider'],['base','api_base'],['model','model'],['input','max_input_tokens'],['output','max_output_tokens']])field(fieldName).value=values[key];
        version=reply.data.version;loading=false;
        $('model-connection-fields').disabled=false;$('model-settings-save').disabled=false;
        message('编辑名称、接口、模型 ID 和输入/输出限制。现有认证、启用状态、代理和执行软件保持原配置；有运行中任务时服务会拒绝保存。认证修改仍在高级设置。');
        field('name').focus();
      } catch(error) { if(request===revision && dialog.open){loading=false;message(error.message,true);} }
    }
  }
  $('model-settings-cancel').addEventListener('click',()=>{if(!saving)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  dialog.addEventListener('close',()=>{revision++;clearSecret();target=null;base='';loading=false;});
  field('provider').addEventListener('change',()=>{
    const bases={local:'http://127.0.0.1:11434/v1',deepseek:'https://api.deepseek.com',glm:'',custom:''};
    field('base').value=bases[field('provider').value]||'';
    clearSecret();field('env').value='';
    $('model-settings-advanced').open=field('provider').value!=='local';
  });
  $('model-settings-form').addEventListener('invalid',event=>{
    if($('model-settings-advanced').contains(event.target))$('model-settings-advanced').open=true;
  },true);
  $('model-settings-form').addEventListener('submit',async event=>{
    event.preventDefault();if(saving || loading || mode==='edit' && !version)return;
    saving=true;$('model-settings-save').disabled=true;$('model-settings-cancel').disabled=true;
    const operation=mode==='edit' ? {action:'edit',id:target.id,version,values:{
      name:field('name').value,provider:field('provider').value,api_base:field('base').value,model:field('model').value,
      max_input_tokens:Number(field('input').value),max_output_tokens:Number(field('output').value),
    }} : target ? {action:'agent',id:target.id,defaultAgent:field('agent').value} : {action:'create',values:{
      name:field('name').value,provider:field('provider').value,api_base:field('base').value,model:field('model').value,
      api_key:field('key').value,api_key_env:field('env').value.trim(),default_agent:field('agent').value,
      max_input_tokens:Number(field('input').value),max_output_tokens:Number(field('output').value),
    }};
    $('model-connection-fields').disabled=true;field('agent').disabled=true;
    clearSecret();message('正在保存，请勿重复提交…');
    // Wipe the transient form object after IPC serialization as well as the input.
    let request;
    try {request=window.workbench.modelSettingsSave(base,operation);}
    catch {request=Promise.reject(new Error('模型设置接口不可用，请重开桌面后再试。'));}
    if(operation.action==='create')operation.values.api_key='';
    try {
      const reply=await request;
      if(!reply?.ok)throw new Error(reply?.error || '未确认保存结果，请重新读取列表确认。');
      dialog.close();
      const refreshed=await window.__modelsUi?.refresh();
      const savedMessage=operation.action==='edit' ? '连接设置已保存，未调用模型。后续新任务使用更新后的连接。' : '设置已保存，未调用模型。默认执行软件仅影响后续新任务。';
      window.__modelsUi?.status(refreshed ? savedMessage : '设置已保存，但列表尚未更新；请刷新列表确认。', !refreshed);
    } catch(error) {
      message(`${error.message}${mode==='create' ? ' 如需重试，请重新输入密钥。' : ''}`,true);
    } finally {
      saving=false;$('model-settings-save').disabled=false;$('model-settings-cancel').disabled=false;
      $('model-connection-fields').disabled=mode==='agent';field('agent').disabled=mode==='edit';
    }
  });
  window.__modelSettingsUi={open};
})();
