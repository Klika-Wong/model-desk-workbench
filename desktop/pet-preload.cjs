// 独立桌宠窗口只暴露它真正需要的接口，不把主窗口的全部 IPC 能力带过去。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workbench', Object.freeze({
  getState: () => ipcRenderer.invoke('workbench:get-state'),
  dispatchModels: () => ipcRenderer.invoke('dispatch:models'),
  dispatchSend: (input) => ipcRenderer.invoke('dispatch:send', input),
  dispatchLog: (taskId) => ipcRenderer.invoke('dispatch:log', taskId),
  dispatchStatus: (taskId) => ipcRenderer.invoke('dispatch:status', taskId),
  petOpen: () => ipcRenderer.invoke('pet:open'),
  petState: () => ipcRenderer.invoke('pet:state'),
  petControl: (action, value) => ipcRenderer.invoke('pet:control', action, value),
}));
