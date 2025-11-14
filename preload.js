const { contextBridge, ipcRenderer, clipboard } = require('electron')

// 暴露安全 API 给渲染进程
contextBridge.exposeInMainWorld('clipfast', {
  listRecords: (query) => ipcRenderer.invoke('records:list', query),
  deleteRecord: (id) => ipcRenderer.invoke('records:delete', id),
  favoriteRecord: (id, fav) => ipcRenderer.invoke('records:favorite', id, fav),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setShortcut: (key) => ipcRenderer.invoke('settings:setShortcut', key),
  pasteText: (text) => clipboard.writeText(text),
  // 一键粘贴：写入剪贴板并触发到前台应用的粘贴
  pasteToActive: (text) => ipcRenderer.invoke('records:paste', text)
})
