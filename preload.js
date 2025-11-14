const { contextBridge, ipcRenderer, clipboard, nativeImage } = require('electron')

// 暴露安全 API 给渲染进程
contextBridge.exposeInMainWorld('clipfast', {
  listRecords: (query) => ipcRenderer.invoke('records:list', query),
  deleteRecord: (id) => ipcRenderer.invoke('records:delete', id),
  favoriteRecord: (id, fav) => ipcRenderer.invoke('records:favorite', id, fav),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setShortcut: (key) => ipcRenderer.invoke('settings:setShortcut', key),
  pasteText: (text) => clipboard.writeText(text),
  // 一键粘贴：写入剪贴板并触发到前台应用的粘贴
  pasteToActive: (text, id) => ipcRenderer.invoke('records:paste', text, id),
  undoMove: (id, toIndex) => ipcRenderer.invoke('records:undoMove', id, toIndex)
})

contextBridge.exposeInMainWorld('clipfastEvents', {
  onNewRecord: (cb) => ipcRenderer.on('records:new', (_e, rec) => cb && cb(rec)),
  onMovedRecord: (cb) => ipcRenderer.on('records:moved', (_e, payload) => cb && cb(payload)),
  onUndoed: (cb) => ipcRenderer.on('records:undoed', (_e, payload) => cb && cb(payload)),
  onPruned: (cb) => ipcRenderer.on('records:pruned', (_e, payload) => cb && cb(payload))
})

contextBridge.exposeInMainWorld('clipfastImage', {
  pasteToActive: (dataUrl, id) => ipcRenderer.invoke('records:pasteImage', dataUrl, id)
})
