const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, nativeImage, Tray, Menu } = require('electron')
const path = require('path')
const { startClipboardWatcher, stopClipboardWatcher } = require('./src/clipboard')
const { spawn } = require('child_process')
const fs = require('fs')

// 应用数据存储（持久化到用户目录）
let store = null

let mainWindow = null
let tray = null

function createWindow() {
  const panel = store.get('settings.panel')
  const width = Math.max(panel.width || 400, 900)
  const height = Math.max(panel.height || 600, 600)
  const iconPath = path.join(__dirname, 'assets', 'icon.png')
  mainWindow = new BrowserWindow({
    width,
    height,
    resizable: true,
    minWidth: 700,
    minHeight: 400,
    show: false,
    frame: true,
    icon: (process.platform === 'win32' || process.platform === 'linux') && fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function togglePanel() {
  if (!mainWindow) return
  if (mainWindow.isVisible()) {
    mainWindow.hide()
  } else {
    mainWindow.show()
    mainWindow.focus()
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
        maxRecords: 100000,
        panel: { width: 900, height: 600 },
        shortcut: 'CommandOrControl+Shift+V'
      }
    }
  })

  createWindow()

  const shortcut = store.get('settings.shortcut')
  globalShortcut.register(shortcut, () => {
    togglePanel()
  })

  // macOS Dock 图标设置（运行时覆盖默认 Electron 图标）
  if (process.platform === 'darwin') {
    const iconPng = path.join(__dirname, 'assets', 'icon.png')
    if (fs.existsSync(iconPng)) {
      const img = nativeImage.createFromPath(iconPng)
      try { app.dock.setIcon(img) } catch {}
    }
  }

  // 顶部状态栏图标（macOS 菜单栏 / Windows 系统托盘）
  let trayIconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayImg = nativeImage.createFromPath(trayIconPath)
  if (trayImg.isEmpty()) trayImg = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'))
  if (process.platform === 'darwin') {
    trayImg = trayImg.resize({ width: 18, height: 18 })
    trayImg.setTemplateImage(false)
  }
  if (tray) tray.destroy()
  tray = new Tray(trayImg)
  tray.setToolTip('clipFast')
  const menu = Menu.buildFromTemplate([
    { label: '显示/隐藏面板', click: () => togglePanel() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => togglePanel())

  startClipboardWatcher(store, (evt) => {
    BrowserWindow.getAllWindows().forEach(w => {
      try {
        if (evt.kind === 'created') w.webContents.send('records:new', evt.record)
        else if (evt.kind === 'moved') w.webContents.send('records:moved', { id: evt.id, fromIndex: evt.fromIndex })
        else if (evt.kind === 'pruned') w.webContents.send('records:pruned', { ids: evt.removedIds })
      } catch (e) {}
    })
  })
})

app.on('window-all-closed', () => {
  // macOS 保持应用常驻（符合桌面工具习惯）
  if (process.platform !== 'darwin') {
    app.quit()
  }
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
  stopClipboardWatcher()
  if (tray) tray.destroy()
})

// 渲染进程与主进程的桥接（检索/删除/收藏/粘贴）
ipcMain.handle('records:list', async (_evt, query) => {
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
  const sliced = records.slice(0, 500)
  // 注入收藏标记，便于前端无额外 IPC 显示收藏状态
  return sliced.map(r => ({ ...r, __fav: favoritesSet.has(r.id) }))
})

ipcMain.handle('records:delete', async (_evt, id) => {
  const records = store.get('records')
  const next = records.filter(r => r.id !== id)
  store.set('records', next)
  return true
})

ipcMain.handle('records:favorite', async (_evt, id, fav) => {
  const favorites = new Set(store.get('favorites'))
  if (fav) favorites.add(id)
  else favorites.delete(id)
  store.set('favorites', Array.from(favorites))
  return true
})

ipcMain.handle('settings:get', async () => store.get('settings'))
ipcMain.handle('settings:setShortcut', async (_evt, key) => {
  // 更新快捷键并重注册
  const settings = store.get('settings')
  settings.shortcut = key
  store.set('settings', settings)
  globalShortcut.unregisterAll()
  globalShortcut.register(key, () => togglePanel())
  return true
})

// 撤销移动：将顶部项移回指定索引位置
ipcMain.handle('records:undoMove', async (_evt, id, toIndex) => {
  const records = store.get('records')
  const curIndex = records.findIndex(r => r.id === id)
  if (curIndex < 0) return false
  const item = records[curIndex]
  const arr = [...records]
  arr.splice(curIndex, 1)
  const clampIndex = Math.max(0, Math.min(toIndex, arr.length))
  arr.splice(clampIndex, 0, item)
  store.set('records', arr)
  BrowserWindow.getAllWindows().forEach(w => {
    try { w.webContents.send('records:undoed', { id, toIndex: clampIndex }) } catch (e) {}
  })
  return true
})

// 一键粘贴：设置剪贴板并向前台应用发送粘贴快捷键
ipcMain.handle('records:paste', async (_evt, text) => {
  try {
    if (!text) return false
    // 写入剪贴板
    clipboard.writeText(text)
    // 隐藏面板，回到之前的前台应用窗口
    if (mainWindow && mainWindow.isVisible()) mainWindow.hide()

    // macOS：使用 AppleScript 触发 Command+V
    if (process.platform === 'darwin') {
      await new Promise((resolve, reject) => {
        // 给系统一次聚焦切换的时间
        setTimeout(() => {
          const script = 'tell application "System Events" to keystroke "v" using {command down}'
          const p = spawn('osascript', ['-e', script])
          p.on('error', reject)
          p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('osascript exit ' + code))))
        }, 120)
      })
    }
    // 其他平台：保留剪贴板，用户手动粘贴（可后续扩展）
    return true
  } catch (e) {
    return false
  }
})
