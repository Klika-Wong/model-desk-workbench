const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('observer',Object.freeze({tasks:()=>ipcRenderer.invoke('mini:tasks')}));
