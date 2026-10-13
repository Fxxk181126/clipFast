const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, nativeImage, safeStorage, Tray, Menu } = require('electron')
const { createClient } = require('@supabase/supabase-js')
const path = require('path')
const {
  DEFAULT_MAX_RECORDS,
  startClipboardWatcher,
  stopClipboardWatcher,
  moveRecordToTop,
  moveRecordTo,
  deleteRecord,
  clearRecords,
  notePastedImage,
  notePastedText
} = require('./src/clipboard')
const {
  AuthError,
  createAuthService,
  createSessionStorage
} = require('./src/auth')
const CH = require('./src/ipc-channels')
const { spawn } = require('child_process')
const fs = require('fs')

function resolveAuthConfig() {
  const proxyUrl = process.env.CLIPFAST_AUTH_PROXY_URL
  if (proxyUrl) {
    return { supabaseUrl: proxyUrl, supabaseAnonKey: 'proxy' }
  }
  return {
    supabaseUrl: process.env.CLIPFAST_SUPABASE_URL,
    supabaseAnonKey: process.env.CLIPFAST_SUPABASE_ANON_KEY
  }
}

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png')
const LIST_CAP = 500
try {
  process.loadEnvFile(path.join(__dirname, '.env'))
} catch {}
// 隐藏面板后给系统一次聚焦切换的时间，再发送粘贴键
const PASTE_FOCUS_DELAY_MS = 120

// 应用数据存储（持久化到用户目录）
let store = null
let authService = null
let currentUser = null
let clipboardWatcherActive = false

let mainWindow = null
let tray = null
let isQuitting = false
let pendingRecoveryUrl = null

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

function parseRecoveryUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'clipfast:') return null
    const accessToken = url.searchParams.get('access_token')
    const type = url.searchParams.get('type')
    if (accessToken && type === 'recovery') {
      return { accessToken, type }
    }
  } catch {}
  return null
}

function handleDeepLink(rawUrl) {
  const recovery = parseRecoveryUrl(rawUrl)
  if (!recovery) return
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(CH.EV_AUTH_RECOVERY, recovery)
  } else {
    pendingRecoveryUrl = recovery
  }
}

app.setAsDefaultProtocolClient('clipfast')

app.on('second-instance', (_event, argv) => {
  const url = argv.find(arg => arg.startsWith('clipfast://'))
  if (url) handleDeepLink(url)
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

function createWindow() {
  const { width, height } = store.get('settings.panel')
  mainWindow = new BrowserWindow({
    width,
    height,
    resizable: true,
    minWidth: 800,
    minHeight: 400,
    show: true,
    frame: true,
    icon: (process.platform === 'win32' || process.platform === 'linux') && fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'))

  // 叉号只隐藏托盘面板，保留窗口实例，避免销毁过程中快捷键误判可见状态。
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function togglePanel() {
  if (!mainWindow) createWindow()

  if (mainWindow.isVisible()) {
    mainWindow.hide()
  } else {
    mainWindow.show()
    mainWindow.focus()
  }
}

// 向所有渲染窗口广播主进程事件
function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach(w => {
    try { w.webContents.send(channel, payload) } catch (e) {}
  })
}

function startUserClipboardWatcher() {
  if (clipboardWatcherActive) return
  startClipboardWatcher(store, (evt) => {
    if (evt.kind === 'created') broadcast(CH.EV_NEW, evt.record)
    else if (evt.kind === 'moved') broadcast(CH.EV_MOVED, { id: evt.id, fromIndex: evt.fromIndex })
    else if (evt.kind === 'pruned') broadcast(CH.EV_PRUNED, { ids: evt.removedIds })
  })
  clipboardWatcherActive = true
}

function stopUserClipboardWatcher() {
  if (!clipboardWatcherActive) return
  stopClipboardWatcher()
  clipboardWatcherActive = false
}

function updateTrayMenu() {
  if (!tray) return
  const menu = [
    { label: currentUser ? `当前账号：${currentUser.email}` : '未登录', enabled: false }
  ]
  if (currentUser) {
    menu.push(
      { type: 'separator' },
      { label: '退出登录', click: () => authService.signOut() }
    )
  }
  menu.push(
    { type: 'separator' },
    { label: '显示/隐藏面板', click: () => togglePanel() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  )
  tray.setContextMenu(Menu.buildFromTemplate(menu))
}

function handleAuthChanged(payload) {
  currentUser = payload.user || null
  if (currentUser) startUserClipboardWatcher()
  else stopUserClipboardWatcher()
  updateTrayMenu()
  broadcast(CH.EV_AUTH_CHANGED, { user: currentUser })
}

// 受保护 IPC 只读内存态 currentUser（由 handleAuthChanged 维护），
// 避免每次调用都触发 session 的磁盘读取与解密。
function protectedHandler(handler) {
  return async (...args) => {
    if (!currentUser) {
      throw new AuthError('UNAUTHENTICATED', '请先登录后再使用剪贴板功能。')
    }
    return handler(...args)
  }
}

// 隐藏面板，回到之前的前台应用后发送 Cmd+V
async function pasteToForeground() {
  if (mainWindow && mainWindow.isVisible()) mainWindow.hide()
  if (process.platform !== 'darwin') return true // 其他平台：保留剪贴板，用户手动粘贴（可后续扩展）
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      const script = 'tell application "System Events" to keystroke "v" using {command down}'
      const p = spawn('osascript', ['-e', script])
      p.on('error', reject)
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('osascript exit ' + code))))
    }, PASTE_FOCUS_DELAY_MS)
  })
  return true
}

// 按记录类型写入剪贴板，并抑制轮询器对自身粘贴的重捕获
function writeRecordToClipboard(record) {
  if (record.type === 'image') {
    clipboard.writeImage(nativeImage.createFromDataURL(record.imageData))
    notePastedImage(record.imageData)
  } else if (record.type === 'video') {
    clipboard.write({ files: [record.text] })
  } else {
    clipboard.writeText(record.text)
    notePastedText(record.text)
  }
}

app.whenReady().then(async () => {
  // 动态引入 ESM 的 electron-store
  const StoreModule = await import('electron-store')
  const Store = StoreModule.default || StoreModule
  store = new Store({
    name: 'clipfast',
    defaults: {
      records: [],
      favorites: [],
      settings: {
        maxRecords: DEFAULT_MAX_RECORDS,
        panel: { width: 900, height: 600 },
        shortcut: 'CommandOrControl+Shift+V'
      }
    }
  })

  const authStore = new Store({ name: 'clipfast-auth' })
  const authConfig = resolveAuthConfig()
  authService = createAuthService({
    supabaseUrl: authConfig.supabaseUrl,
    supabaseAnonKey: authConfig.supabaseAnonKey,
    createClient,
    storage: createSessionStorage({ safeStorage, persistentStore: authStore }),
    onAuthChanged: handleAuthChanged
  })

  createWindow()

  const shortcut = store.get('settings.shortcut')
  globalShortcut.register(shortcut, () => {
    togglePanel()
  })

  // macOS Dock 图标设置（运行时覆盖默认 Electron 图标）
  if (process.platform === 'darwin') {
    if (fs.existsSync(ICON_PATH)) {
      const img = nativeImage.createFromPath(ICON_PATH)
      try { app.dock.setIcon(img) } catch {}
    }
  }

  // 顶部状态栏图标（macOS 菜单栏 / Windows 系统托盘）
  let trayImg = nativeImage.createFromPath(ICON_PATH)
  if (process.platform === 'darwin') {
    trayImg = trayImg.resize({ width: 18, height: 18 })
    trayImg.setTemplateImage(false)
  }
  tray = new Tray(trayImg)
  tray.setToolTip('clipFast')
  updateTrayMenu()
  tray.on('click', () => togglePanel())

  // 会话恢复可能触发网络令牌刷新，放在最后异步执行，避免阻塞快捷键与托盘注册；
  // 状态迁移统一走 handleAuthChanged，与登录/登出保持同一入口。
  authService.getSession().then((session) => {
    handleAuthChanged({ user: session.user })
    if (pendingRecoveryUrl) {
      mainWindow?.webContents?.send(CH.EV_AUTH_RECOVERY, pendingRecoveryUrl)
      pendingRecoveryUrl = null
    }
  })
})

app.on('window-all-closed', () => {
  // macOS 保持应用常驻（符合桌面工具习惯）
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  } else if (mainWindow) {
    mainWindow.show()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopUserClipboardWatcher()
  if (tray) tray.destroy()
})

// 认证操作不要求已有会话；其余 IPC 与剪贴板监控都只对已登录用户开放。
ipcMain.handle(CH.AUTH_SIGN_UP, async (_evt, email, password) => authService.signUp(email, password))
ipcMain.handle(CH.AUTH_SIGN_IN, async (_evt, email, password) => authService.signIn(email, password))
ipcMain.handle(CH.AUTH_SIGN_OUT, async () => authService.signOut())
ipcMain.handle(CH.AUTH_GET_SESSION, async () => authService.getSession())
ipcMain.handle(CH.AUTH_REQUEST_PASSWORD_RESET, async (_evt, email) => authService.requestPasswordReset(email))
ipcMain.handle(CH.AUTH_UPDATE_PASSWORD, async (_evt, newPassword) => authService.updatePassword(newPassword))

// 渲染进程与主进程的桥接（检索/删除/收藏/粘贴）
ipcMain.handle(CH.RECORDS_LIST, protectedHandler(async (_evt, query) => {
  const keyword = (query?.keyword || '').trim().toLowerCase()
  const type = query?.type || 'all'
  const onlyFavorites = !!query?.onlyFavorites
  const favoritesSet = new Set(store.get('favorites'))
  let records = store.get('records')

  if (type !== 'all') records = records.filter(r => r.type === type)
  if (onlyFavorites) records = records.filter(r => favoritesSet.has(r.id))
  if (keyword) {
    records = records.filter(r => {
      const t = (r.text || '').toLowerCase()
      const tags = (r.tags || []).join(' ').toLowerCase()
      return t.includes(keyword) || tags.includes(keyword)
    })
  }

  records.sort((a, b) => b.ts - a.ts)
  // 注入收藏标记，便于前端无额外 IPC 显示收藏状态
  return records.slice(0, LIST_CAP).map(r => ({ ...r, __fav: favoritesSet.has(r.id) }))
}))

ipcMain.handle(CH.RECORDS_DELETE, protectedHandler(async (_evt, id) => deleteRecord(store, id)))

ipcMain.handle(CH.RECORDS_FAVORITE, protectedHandler(async (_evt, id, fav) => {
  const favorites = new Set(store.get('favorites'))
  if (fav) favorites.add(id)
  else favorites.delete(id)
  store.set('favorites', Array.from(favorites))
  return true
}))

ipcMain.handle(CH.SETTINGS_GET, protectedHandler(async () => store.get('settings')))
ipcMain.handle(CH.SETTINGS_SET_SHORTCUT, protectedHandler(async (_evt, key) => {
  // 更新快捷键并重注册
  const settings = store.get('settings')
  settings.shortcut = key
  store.set('settings', settings)
  try {
    globalShortcut.unregisterAll()
    const ok = globalShortcut.register(key, () => togglePanel())
    return !!ok
  } catch (e) {
    return false
  }
}))

// 撤销移动：将顶部项移回指定索引位置
ipcMain.handle(CH.RECORDS_UNDO_MOVE, protectedHandler(async (_evt, id, toIndex) => {
  const clampIndex = moveRecordTo(store, id, toIndex)
  if (clampIndex < 0) return false
  broadcast(CH.EV_UNDOED, { id, toIndex: clampIndex })
  return true
}))

// 一键粘贴：写入剪贴板、置顶记录并向前台应用发送粘贴快捷键（类型分派在此处，渲染层只传 id）
ipcMain.handle(CH.RECORDS_PASTE, protectedHandler(async (_evt, id) => {
  try {
    const record = store.get('records').find(r => r.id === id)
    if (!record) return false

    writeRecordToClipboard(record)

    const moved = moveRecordToTop(store, id)
    if (moved) broadcast(CH.EV_MOVED, moved)

    return await pasteToForeground()
  } catch (e) {
    return false
  }
}))

ipcMain.handle(CH.RECORDS_CLEAR, protectedHandler(async () => {
  clearRecords(store)
  return true
}))
