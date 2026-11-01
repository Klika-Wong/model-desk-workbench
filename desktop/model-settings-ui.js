(() => {
  const $=id=>document.getElementById(id);
  const dialog=$('model-settings-dialog');
  if(!dialog)return;
  let target=null, base='', saving=false;
  const field=name=>$('model-setting-'+name);
  function message(text,error=false){$('model-settings-message').textContent=text;$('model-settings-message').classList.toggle('is-error',error);}
  function clearSecret(){field('key').value='';}
  function open(model,serviceBase){
    if(saving)return;
    if(!serviceBase){window.__modelsUi?.status('请先连接服务并读取模型列表。',true);return;}
    target=model;base=serviceBase;
    $('model-settings-form').reset();clearSecret();
    $('model-settings-advanced').open=false;
    $('model-settings-title').textContent=model ? `执行软件 · ${model.name}` : '添加模型连接';
    $('model-connection-fields').hidden=Boolean(model);
    $('model-connection-fields').disabled=Boolean(model);
    field('agent').value=model ? model.defaultAgent : 'follow_global';
    $('model-settings-save').disabled=false;
    $('model-settings-cancel').disabled=false;
    message(model ? '只影响后续新任务。现有任务、API 密钥和预算保持原配置。' : '连接在所有项目中可用。保存不会测试或调用模型；首个启用模型会成为服务默认。');
    dialog.showModal();
    window.__modelsUi?.invalidate();
    (model?field('agent'):field('name')).focus();
  }
  $('model-settings-cancel').addEventListener('click',()=>{if(!saving)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  dialog.addEventListener('close',()=>{clearSecret();target=null;base='';});
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
    event.preventDefault();if(saving)return;
    saving=true;$('model-settings-save').disabled=true;$('model-settings-cancel').disabled=true;
    const operation=target ? {action:'agent',id:target.id,defaultAgent:field('agent').value} : {action:'create',values:{
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
    if(operation.values)operation.values.api_key='';
    try {
      const reply=await request;
      if(!reply?.ok)throw new Error(reply?.error || '未确认保存结果，请重新读取列表确认。');
      dialog.close();
      const refreshed=await window.__modelsUi?.refresh();
      window.__modelsUi?.status(refreshed ? '设置已保存，未调用模型。默认执行软件仅影响后续新任务。' : '设置已保存，但列表尚未更新；请刷新列表确认。', !refreshed);
    } catch(error) {
      message(`${error.message} 如需重试，请重新输入密钥。`,true);
    } finally {
      saving=false;$('model-settings-save').disabled=false;$('model-settings-cancel').disabled=false;
      $('model-connection-fields').disabled=Boolean(target);field('agent').disabled=false;
    }
  });
  window.__modelSettingsUi={open};
})();
