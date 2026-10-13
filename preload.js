const { contextBridge, ipcRenderer } = require('electron')

// 注意：沙箱化 preload 不能 require 本地文件，以下通道名只能内联；
// 单一真身在 src/ipc-channels.js，两处需同步修改。
const CH = {
  RECORDS_LIST: 'records:list',
  RECORDS_DELETE: 'records:delete',
  RECORDS_FAVORITE: 'records:favorite',
  RECORDS_PASTE: 'records:paste',
  RECORDS_UNDO_MOVE: 'records:undoMove',
  RECORDS_CLEAR: 'records:clear',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET_SHORTCUT: 'settings:setShortcut',
  AUTH_SIGN_UP: 'auth:signUp',
  AUTH_SIGN_IN: 'auth:signIn',
  AUTH_SIGN_OUT: 'auth:signOut',
  AUTH_GET_SESSION: 'auth:getSession',
  AUTH_REQUEST_PASSWORD_RESET: 'auth:requestPasswordReset',
  AUTH_UPDATE_PASSWORD: 'auth:updatePassword',
  EV_NEW: 'records:new',
  EV_MOVED: 'records:moved',
  EV_UNDOED: 'records:undoed',
  EV_PRUNED: 'records:pruned',
  EV_AUTH_CHANGED: 'auth:changed',
  EV_AUTH_RECOVERY: 'auth:recovery'
}

// 暴露安全 API 给渲染进程
contextBridge.exposeInMainWorld('clipfast', {
  listRecords: (query) => ipcRenderer.invoke(CH.RECORDS_LIST, query),
  deleteRecord: (id) => ipcRenderer.invoke(CH.RECORDS_DELETE, id),
  favoriteRecord: (id, fav) => ipcRenderer.invoke(CH.RECORDS_FAVORITE, id, fav),
  getSettings: () => ipcRenderer.invoke(CH.SETTINGS_GET),
  setShortcut: (key) => ipcRenderer.invoke(CH.SETTINGS_SET_SHORTCUT, key),
  // 一键粘贴：写入剪贴板并触发到前台应用的粘贴（类型分派在主进程，只传记录 id）
  pasteToActive: (id) => ipcRenderer.invoke(CH.RECORDS_PASTE, id),
  undoMove: (id, toIndex) => ipcRenderer.invoke(CH.RECORDS_UNDO_MOVE, id, toIndex),
  clearRecords: () => ipcRenderer.invoke(CH.RECORDS_CLEAR)
})

contextBridge.exposeInMainWorld('clipfastEvents', {
  onNewRecord: (cb) => ipcRenderer.on(CH.EV_NEW, (_e, rec) => cb && cb(rec)),
  onMovedRecord: (cb) => ipcRenderer.on(CH.EV_MOVED, (_e, payload) => cb && cb(payload)),
  onUndoed: (cb) => ipcRenderer.on(CH.EV_UNDOED, (_e, payload) => cb && cb(payload)),
  onPruned: (cb) => ipcRenderer.on(CH.EV_PRUNED, (_e, payload) => cb && cb(payload))
})

// 认证 API 只传递脱敏用户和操作结果，session/token 始终留在主进程。
contextBridge.exposeInMainWorld('clipfastAuth', {
  signUp: (email, password) => ipcRenderer.invoke(CH.AUTH_SIGN_UP, email, password),
  signIn: (email, password) => ipcRenderer.invoke(CH.AUTH_SIGN_IN, email, password),
  signOut: () => ipcRenderer.invoke(CH.AUTH_SIGN_OUT),
  getSession: () => ipcRenderer.invoke(CH.AUTH_GET_SESSION),
  requestPasswordReset: (email) => ipcRenderer.invoke(CH.AUTH_REQUEST_PASSWORD_RESET, email),
  updatePassword: (newPassword) => ipcRenderer.invoke(CH.AUTH_UPDATE_PASSWORD, newPassword),
  onAuthChanged: (cb) => ipcRenderer.on(CH.EV_AUTH_CHANGED, (_e, payload) => cb && cb(payload)),
  onRecovery: (cb) => ipcRenderer.on(CH.EV_AUTH_RECOVERY, (_e, payload) => cb && cb(payload))
})
