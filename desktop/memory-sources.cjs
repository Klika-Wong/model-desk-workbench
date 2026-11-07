'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const GUIDES=['README.md','架构说明.md','使用手册.md'];
function ordinary(folder) {
  if(typeof folder!=='string'||!path.isAbsolute(folder)||/(?:^|[\\/])[^\\/]*(?:加密|encrypted)[^\\/]*(?:[\\/]|$)/i.test(folder))throw new Error('请选择未加密的普通记忆目录。');
  const full=path.resolve(folder), stat=fs.lstatSync(full), real=fs.realpathSync(full);
  if(!stat.isDirectory()||stat.isSymbolicLink()||real.toLowerCase()!==full.toLowerCase())throw new Error('请选择实际目录，不跟随文件夹链接。');
  return real;
}
class MemorySources {
  constructor(root){this.file=path.join(root,'memory-sources.json');}
  read(){
    if(!fs.existsSync(this.file))return [];
    if(fs.lstatSync(this.file).isSymbolicLink())throw new Error('记忆来源配置不能是链接。');
    let data;try{data=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{throw new Error('记忆来源配置无法读取，原文件未覆盖。');}
    if(data.version!==1||!Array.isArray(data.sources)||data.sources.length>30||data.sources.some(s=>!s||typeof s.id!=='string'||typeof s.path!=='string'||!path.isAbsolute(s.path)||!['memory','archive'].includes(s.kind)))throw new Error('记忆来源配置格式无效。');
    return data.sources;
  }
  add(folder,kind){
    if(!['memory','archive'].includes(kind))throw new Error('记忆来源类型无效。');
    const full=ordinary(folder), sources=this.read();
    const same=sources.find(s=>s.path.toLowerCase()===full.toLowerCase());
    if(same){if(same.kind!==kind)throw new Error('该目录已经登记为另一种来源。');return this.list();}
    if(sources.length>=30)throw new Error('记忆来源已达到30个，请整理已有来源。');
    sources.push({id:randomUUID(),path:full,kind,name:path.basename(full)});
    const temp=this.file+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temp,JSON.stringify({version:1,sources},null,2),{flag:'wx'});fs.renameSync(temp,this.file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    return this.list();
  }
  inventory(source){
    try{
      const root=ordinary(source.path), files=[];
      for(const item of fs.readdirSync(root,{withFileTypes:true})){
        if(!item.isFile()||item.isSymbolicLink()||item.name.startsWith('.')||!/\.(md|zip)$/i.test(item.name))continue;
        if(/人类专属|加密|encrypted/i.test(item.name))continue;
        const stat=fs.lstatSync(path.join(root,item.name));
        files.push({name:item.name,bytes:stat.size,canImport:source.kind==='memory'&&GUIDES.includes(item.name)&&stat.size<=128*1024});
      }
      return {...source,available:true,files};
    }catch{return {...source,available:false,files:[],error:'来源目录不可读或含链接，请核对实际位置。'};}
  }
  list(){return this.read().map(s=>this.inventory(s));}
  importGuides(id,memory){
    const source=this.read().find(s=>s.id===id);
    if(!source||source.kind!=='memory')throw new Error('快照只登记，不自动解压或导入。');
    const root=ordinary(source.path), documents=[];
    for(const name of GUIDES){
      const file=path.join(root,name);if(!fs.existsSync(file))continue;
      const stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024)throw new Error('说明文件是链接、特殊文件或超过128 KiB，未导入。');
      const body=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
      const frontmatter=body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]||'';
      if(/^\s*agent_read\s*:\s*['"]?forbidden['"]?\s*$/im.test(frontmatter))throw new Error('说明文件声明禁止 AI 读取，未导入。');
      if(body.trim())documents.push({name,body,source:file});
    }
    if(!documents.length)return {imported:0,unchanged:0};
    let state=memory.snapshot(), space=state.spaces.find(s=>s.kind==='special'&&s.name==='本机记忆说明');
    const existing=space?.entries||[];
    const additions=documents.filter(d=>!existing.some(e=>e.source===d.source&&e.body===d.body&&e.status!=='retracted'));
    const current=(space?.entries||[]).reduce((n,e)=>n+[...e.body].length,0);
    if(current+additions.reduce((n,d)=>n+[...d.body].length,0)>(space?.capacityChars||32000))throw new Error('说明内容超过空间容量，请先调整容量或精简导入内容。');
    if(!space){
      state=memory.execute({type:'createSpace',expectedRevision:state.revision,name:'本机记忆说明',kind:'special'});space=state.spaces.at(-1);
      state=memory.execute({type:'updateSpace',expectedRevision:state.revision,spaceId:space.id,patch:{capacityChars:32000}});
    }
    for(const doc of additions)state=memory.execute({type:'addEntry',expectedRevision:state.revision,spaceId:space.id,title:doc.name,body:doc.body,section:space.sections[0],source:doc.source});
    return {imported:additions.length,unchanged:documents.length-additions.length,spaceId:space.id,status:'candidate'};
  }
}
module.exports={MemorySources};
