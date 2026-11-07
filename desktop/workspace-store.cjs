'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash,randomUUID} = require('node:crypto');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = value => process.platform === 'win32' ? value.toLowerCase() : value;
const inside = (parent, child) => { const rel=path.relative(identity(parent),identity(child)); return !rel || (!rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel)); };
function atomic(file, value) {
  const temp=file+'.'+randomUUID()+'.tmp';
  try { fs.writeFileSync(temp,JSON.stringify(value,null,2),{flag:'wx'}); fs.renameSync(temp,file); }
  finally { if(fs.existsSync(temp))fs.unlinkSync(temp); }
}
function directory(value) {
  if(typeof value!=='string' || !path.isAbsolute(value))throw new Error('请选择明确的本机绝对目录。');
  const full=path.resolve(value);
  if(!fs.lstatSync(full).isDirectory() || fs.lstatSync(full).isSymbolicLink())throw new Error('请选择普通文件夹，不使用链接目录。');
  const real=fs.realpathSync(full);
  if(identity(real)!==identity(full))throw new Error('路径包含链接或别名，请选择实际目录。');
  return real;
}
class WorkspaceStore {
  constructor(bootstrap) {
    fs.mkdirSync(bootstrap,{recursive:true});
    this.bootstrap=directory(bootstrap);
    this.pointer=path.join(this.bootstrap,'data-location.json');
    this.root=this.bootstrap;
    if(fs.existsSync(this.pointer)) {
      let value;try{value=JSON.parse(fs.readFileSync(this.pointer,'utf8'));}catch{throw new Error('数据位置配置损坏，已停止加载，避免创建空库覆盖旧数据。');}
      this.root=directory(value.root);
    }
  }
  read() {
    const file=path.join(this.root,'workspace.json');
    let value={projects:[],selectedProject:null,quotaAutoRefresh:true,quotaRefreshSeconds:60};
    if(fs.existsSync(file)) {
      try{value={...value,...JSON.parse(fs.readFileSync(file,'utf8'))};}catch{throw new Error('项目设置无法读取，未覆盖原文件。');}
    }
    if(!Array.isArray(value.projects) || value.projects.length>100 || value.projects.some(p=>!p || typeof p.id!=='string' || typeof p.path!=='string' || !path.isAbsolute(p.path) || typeof p.name!=='string'))throw new Error('项目设置格式无效，未覆盖原文件。');
    if(typeof value.quotaAutoRefresh!=='boolean' || !Number.isInteger(value.quotaRefreshSeconds) || value.quotaRefreshSeconds<30 || value.quotaRefreshSeconds>600)throw new Error('自动刷新设置无效。');
    return {version:1,projects:value.projects,selectedProject:value.selectedProject || null,quotaAutoRefresh:value.quotaAutoRefresh,quotaRefreshSeconds:value.quotaRefreshSeconds};
  }
  write(value) { atomic(path.join(this.root,'workspace.json'),value); return this.snapshot(); }
  snapshot() { return {...this.read(),dataRoot:this.root,bootstrapRoot:this.bootstrap}; }
  remember(folder, select=true) {
    const full=directory(folder), data=this.read();
    const existing=data.projects.find(p=>identity(p.path)===identity(full));
    if(!existing) {
      if(data.projects.length>=100)throw new Error('项目列表已满，请先移除不需要的入口。');
      data.projects.push({id:randomUUID(),path:full,name:path.basename(full) || full});
    }
    if(select)data.selectedProject=full;
    return this.write(data);
  }
  update(id, changes) {
    const data=this.read(), row=data.projects.find(p=>p.id===id);
    if(!row)throw new Error('项目入口不存在，请刷新。');
    if(!changes || Object.keys(changes).some(key=>!['name','path','remove'].includes(key)))throw new Error('项目操作无效。');
    if(changes.remove===true) {
      data.projects=data.projects.filter(p=>p.id!==id);
      if(data.selectedProject===row.path)data.selectedProject=null;
    } else {
      if(changes.name!==undefined) {
        if(typeof changes.name!=='string' || !changes.name.trim() || changes.name.trim().length>100)throw new Error('名称需要1至100个字符。');
        row.name=changes.name.trim();
      }
      if(changes.path!==undefined) {
        const full=directory(changes.path);
        if(data.projects.some(p=>p.id!==id && identity(p.path)===identity(full)))throw new Error('该文件夹已经在项目列表中。');
        if(data.selectedProject===row.path)data.selectedProject=full;
        row.path=full;
      }
    }
    return this.write(data);
  }
  preferences(values) {
    if(!values || Object.keys(values).some(key=>!['quotaAutoRefresh','quotaRefreshSeconds'].includes(key)))throw new Error('不支持的设置项。');
    const data={...this.read(),...values};
    if(typeof data.quotaAutoRefresh!=='boolean' || !Number.isInteger(data.quotaRefreshSeconds) || data.quotaRefreshSeconds<30 || data.quotaRefreshSeconds>600)throw new Error('刷新间隔应为30至600秒。');
    return this.write(data);
  }
  files() {
    const names=['memory.json','memory.json.architecture.json','memory-sources.json','model-cache.json','chat.json','workspace.json'];
    const chats=path.join(this.root,'chats');
    if(fs.existsSync(chats)) {
      directory(chats);
      for(const name of fs.readdirSync(chats)) {
        if(!/^[a-f0-9]{64}\.json$/.test(name))throw new Error('对话目录存在未知文件，迁移已停止，请先核对。');
        names.push(path.join('chats',name));
      }
    }
    return names.filter(name=>fs.existsSync(path.join(this.root,name))).map(name=>{
      const file=path.join(this.root,name), stat=fs.lstatSync(file);
      if(!stat.isFile() || stat.isSymbolicLink())throw new Error('数据目录包含链接或特殊文件，迁移已停止。');
      if(stat.size>32*1024*1024)throw new Error('单个数据文件过大，暂不自动迁移。');
      const bytes=fs.readFileSync(file);
      try{JSON.parse(bytes.toString('utf8'));}catch{throw new Error('数据文件无法解析，迁移已停止，原文件保持不变。');}
      return {name,bytes:bytes.length,sha256:digest(bytes)};
    });
  }
  preview(target) {
    const destination=directory(target);
    if(inside(this.root,destination) || inside(destination,this.root))throw new Error('迁移目标不能与当前数据目录相同或相互包含。');
    if(fs.readdirSync(destination).length)throw new Error('请选择空文件夹，避免合并或覆盖已有数据。');
    const files=this.files(), bytes=files.reduce((n,f)=>n+f.bytes,0);
    const disk=fs.statfsSync(destination);
    if(disk.bavail*disk.bsize<bytes+1024*1024)throw new Error('目标磁盘可用空间不足。');
    return {source:this.root,target:destination,files,bytes,fingerprint:digest(JSON.stringify(files))};
  }
  migrate(preview, validate=()=>{}) {
    if(!preview || preview.source!==this.root)throw new Error('数据位置已改变，请重新预览迁移。');
    const current=this.preview(preview.target);
    if(current.fingerprint!==preview.fingerprint)throw new Error('数据在预览后已变化，请重新预览。');
    const created=[];
    let chatsCreated=false;
    try {
      for(const file of current.files) {
        const dest=path.join(current.target,file.name);
        if(file.name.startsWith('chats'+path.sep) && !chatsCreated){fs.mkdirSync(path.dirname(dest));chatsCreated=true;}
        fs.copyFileSync(path.join(this.root,file.name),dest,fs.constants.COPYFILE_EXCL);created.push(dest);
        if(digest(fs.readFileSync(dest))!==file.sha256)throw new Error('复制校验失败，未切换数据位置。');
      }
      if(digest(JSON.stringify(this.files()))!==current.fingerprint)throw new Error('迁移过程中源数据发生变化，未切换数据位置。');
      validate(current.target);
      const destinationState=new WorkspaceStore(current.target).snapshot();
      atomic(this.pointer,{version:1,root:current.target});
      this.root=current.target;
      return {...destinationState,bootstrapRoot:this.bootstrap,copiedFiles:created.length,sourceRetained:true};
    } catch(error) {
      // Only files created by this attempt inside the verified destination are removed.
      for(const file of created.reverse())if(inside(current.target,file))try{fs.unlinkSync(file);}catch{}
      if(chatsCreated)try{fs.rmdirSync(path.join(current.target,'chats'));}catch{}
      throw error;
    }
  }
}
module.exports={WorkspaceStore};
