'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const fields=['id','name','local','providerLabel','executorLabel','enabled','selectionBlocked','checkLabel','checkedAt','canChooseAgent','defaultAgent'];
function clean(models){
  if(!Array.isArray(models)||models.length>500)throw new Error('模型缓存格式无效。');
  return models.filter(m=>m&&typeof m.id==='string').map(m=>Object.fromEntries(fields.filter(k=>typeof m[k]==='boolean'||typeof m[k]==='string').map(k=>[k,typeof m[k]==='string'?m[k].slice(0,200):m[k]])));
}
function save(root,overview){
  const file=path.join(root,'model-cache.json'),temp=file+'.'+randomUUID()+'.tmp';
  const value={version:1,savedAt:new Date().toISOString(),models:clean(overview.models)};
  try{fs.writeFileSync(temp,JSON.stringify(value),{flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function read(root){
  const file=path.join(root,'model-cache.json');if(!fs.existsSync(file))return null;
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw new Error('模型缓存不可读。');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.version!==1)throw new Error('模型缓存版本无效。');
  return {cached:true,savedAt:typeof data.savedAt==='string'?data.savedAt:'',models:clean(data.models).map(m=>({...m,executorReady:null})),accounts:[{id:'offline',label:'账户额度',stateLabel:'服务未连接 · 额度未知',detail:'这里只展示本机保存的模型清单，无法证明账户登录、连接或剩余额度。',windows:[]}]};
}
module.exports={save,read};
