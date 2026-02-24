// State Management
let state = { 
  type: 'all', 
  keyword: '', 
  onlyFavorites: false, 
  list: [], 
  active: null 
}
let pending = []
let scheduleId = null
let lastMove = null
let undoStack = []
let redoStack = []
let undoEnabled = false
let undoClosedShown = false
let shortcutDraft = null

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => Array.from(document.querySelectorAll(sel))

// Render the list of cards
function renderList() {
  const container = $('#list')
  container.innerHTML = ''
  
  if (!state.list.length) {
    container.innerHTML = '<div class="placeholder">暂无记录</div>'
    return
  }

  state.list.forEach(item => {
    const card = createCardElement(item)
    container.appendChild(card)
  })
}

// Create a single card element
function createCardElement(item) {
  const div = document.createElement('div')
  div.className = 'card'
  div.id = `item-${item.id}`
  
  // Type Badge Class
  const typeClass = item.type || 'text'
  
  // Content HTML
  let contentHtml = ''
  if (item.type === 'image') {
    contentHtml = `<img class="card-img" src="${item.imageData}" alt="Image Preview" />`
  } else {
    contentHtml = `<div class="card-text">${escapeHtml(previewText(item.text))}</div>`
  }

  // Fav Status
  const isFavorite = isFav(item.id)

  div.innerHTML = `
    <div class="card-header">
      <span class="card-type-badge ${typeClass}">${item.type.toUpperCase()}</span>
      <span class="card-time">${new Date(item.ts).toLocaleString()}</span>
    </div>
    <div class="card-content">
      ${contentHtml}
    </div>
    <div class="card-actions">
      <button class="card-btn paste" title="一键粘贴">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
        一键粘贴
      </button>
      <button class="card-btn fav ${isFavorite ? 'active' : ''}" title="${isFavorite ? '取消收藏' : '收藏'}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        ${isFavorite ? '已收藏' : '收藏'}
      </button>
      <button class="card-btn delete" title="删除">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path></svg>
        删除
      </button>
    </div>
  `

  // Event Listeners
  const pasteBtn = div.querySelector('.paste')
  pasteBtn.onclick = (e) => {
    e.stopPropagation()
    if (item.type === 'image') {
      window.clipfastImage.pasteToActive(item.imageData, item.id)
    } else if (item.type === 'video') {
      // Assuming video uses text path or specialized handler if available, fallback to text path
      window.clipfastUpload.video(item.text, item.id)
    } else {
      window.clipfast.pasteToActive(item.text, item.id)
    }
  }

  const favBtn = div.querySelector('.fav')
  favBtn.onclick = async (e) => {
    e.stopPropagation()
    const next = !isFav(item.id)
    await window.clipfast.favoriteRecord(item.id, next)
    await refresh()
  }

  const delBtn = div.querySelector('.delete')
  delBtn.onclick = async (e) => {
    e.stopPropagation()
    if (confirm('确定要删除这条记录吗？')) {
      await window.clipfast.deleteRecord(item.id)
      await refresh()
    }
  }

  return div
}

function isFav(id) {
  return !!state.list.find(x => x.id === id && x.__fav)
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

function previewText(s) {
  const trimmed = (s || '').trim()
  return trimmed.length > 300 ? trimmed.slice(0, 300) + '…' : trimmed
}

async function refresh() {
  const list = await window.clipfast.listRecords({ 
    type: state.type, 
    keyword: state.keyword, 
    onlyFavorites: state.onlyFavorites 
  })
  state.list = list
  renderList()
}

// Incremental updates for new records
function applyIncremental(items) {
  const container = $('#list')
  if (!items.length) return
  
  if (!state.list.length && container.innerHTML.includes('暂无记录')) {
    container.innerHTML = ''
  }

  for (const rec of items) {
    if (!matches(rec)) continue
    
    // Check if exists
    const exists = state.list.find(x => x.id === rec.id)
    if (exists) continue

    state.list.unshift({ ...rec, __fav: false })
    if (state.list.length > 500) state.list.length = 500
    
    const card = createCardElement(rec)
    card.classList.add('flash')
    setTimeout(() => card.classList.remove('flash'), 1000)

    if (container.firstChild) {
      container.insertBefore(card, container.firstChild)
    } else {
      container.appendChild(card)
    }

    if (container.children.length > 500) {
      container.removeChild(container.lastChild)
    }
  }
}

function matches(r) {
  if (state.type !== 'all' && r.type !== state.type) return false
  if (state.onlyFavorites) return false
  const kw = state.keyword.trim().toLowerCase()
  if (!kw) return true
  const t = (r.text || '').toLowerCase()
  const tags = (r.tags || []).join(' ').toLowerCase()
  return t.includes(kw) || tags.includes(kw)
}

// Message / Toast Logic
function showMsg(s, persistent = false) {
  // Use a toast element or just log for now if UI element missing
  // Since we removed #msg, let's inject a toast if needed
  let toast = $('#toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'toast'
    toast.className = 'undo-msg' // Reuse undo-msg style or create new
    toast.style.position = 'fixed'
    toast.style.top = '20px'
    toast.style.right = '20px'
    toast.style.zIndex = '2000'
    toast.style.display = 'none'
    document.body.appendChild(toast)
  }
  
  toast.textContent = s
  if (!s) {
    toast.style.display = 'none'
    return
  }
  
  toast.style.display = 'block'
  if (!persistent) {
    setTimeout(() => {
      toast.style.display = 'none'
    }, 2000)
  }
}

function showUndoBanner() {
  const banner = $('#undoMsg')
  if (banner) {
    banner.style.display = 'flex'
    const btn = $('#undoBtn')
    if (btn) {
      btn.onclick = async (e) => {
        e.preventDefault()
        const top = undoStack[0]
        if (!top) return
        const ok = await window.clipfast.undoMove(top.id, top.fromIndex)
        if (!ok) showMsg('撤销失败')
        else closeUndoPanel()
      }
    }
  }
}

function closeUndoPanel() {
  const banner = $('#undoMsg')
  if (banner) banner.style.display = 'none'
}

function resetUndo() {
  lastMove = null
  undoStack.length = 0
  redoStack.length = 0
  undoEnabled = false
  closeUndoPanel()
}

function moveDomItemToTop(currentIndex) {
  const container = $('#list')
  const prevScroll = container.scrollTop
  const node = container.children[currentIndex]
  if (!node) return
  
  container.removeChild(node)
  container.insertBefore(node, container.firstChild)
  
  node.classList.add('flash')
  setTimeout(() => node.classList.remove('flash'), 1000)
  
  container.scrollTop = prevScroll
}

// Initialization
async function init() {
  const settings = await window.clipfast.getSettings()
  undoClosedShown = localStorage.getItem('undoClosedShown') === '1'

  // Header Actions
  $('#openShortcut').onclick = openShortcutModal
  
  $('#search').oninput = async (e) => { 
    state.keyword = e.target.value
    await refresh() 
  }
  
  // Toggle Favorites
  $('#toggleFav').onclick = async () => {
    state.onlyFavorites = !state.onlyFavorites
    const btn = $('#toggleFav')
    if (state.onlyFavorites) {
      btn.classList.add('active')
    } else {
      btn.classList.remove('active')
    }
    await refresh()
  }

  // Clear All
  $('#clearAll').onclick = async () => {
    if (confirm('确定要清空所有记录吗？此操作不可恢复。')) {
      await window.clipfast.clearRecords()
      await refresh()
      showMsg('所有记录已清空')
    }
  }

  // Sidebar Navigation
  $$('.nav-item').forEach(btn => {
    btn.onclick = async () => {
      $$('.nav-item').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      state.type = btn.dataset.type
      await refresh()
    }
  })

  // Events
  window.clipfastEvents.onNewRecord((rec) => {
    pending.push(rec)
    if (scheduleId) return
    scheduleId = setTimeout(() => {
      scheduleId = null
      try {
        const items = pending.splice(0)
        applyIncremental(items)
      } catch { showMsg('更新失败') }
    }, 250)
  })

  window.clipfastEvents.onNewRecord(() => {
    if (undoEnabled && !undoClosedShown) {
      showMsg('撤销已关闭', true)
      undoClosedShown = true
      localStorage.setItem('undoClosedShown', '1')
    }
    resetUndo()
  })

  window.clipfastEvents.onMovedRecord(({ id, fromIndex }) => {
    const idx = state.list.findIndex(x => x.id === id)
    if (idx >= 0) {
      const item = state.list[idx]
      state.list.splice(idx, 1)
      state.list.unshift(item)
      moveDomItemToTop(idx)
      
      lastMove = { id, fromIndex, toIndex: 0 }
      undoStack.unshift(lastMove)
      redoStack.length = 0
      undoEnabled = true
      undoClosedShown = false
      localStorage.removeItem('undoClosedShown')
      showUndoBanner()
    }
  })

  window.clipfastEvents.onUndoed(({ id, toIndex }) => {
    const u = undoStack.shift()
    if (u) redoStack.unshift({ id: u.id, fromIndex: u.toIndex, toIndex: u.fromIndex })
    
    refresh().then(() => showMsg('已撤销移动'))
    lastMove = null
    undoEnabled = false
    closeUndoPanel()
  })

  window.clipfastEvents.onPruned(({ ids }) => {
    if (Array.isArray(ids) && ids.length) {
      refresh().then(() => showMsg('已清理过期记录'))
    }
  })

  await refresh()
}

// Shortcut Modal Logic (Keep mostly as is)
function openShortcutModal() {
  const m = $('#shortcutModal')
  shortcutDraft = null
  renderKeys('—', 'shortcutPreviewKeys')
  window.clipfast.getSettings().then(s => { 
    const cur = s?.shortcut || '—'
    const el = document.getElementById('shortcutCurrentKeys')
    if (el) el.textContent = cur 
  })
  
  m.classList.add('show')
  m.tabIndex = -1
  m.focus()
  
  const onKey = (e) => {
    e.preventDefault()
    const parts = []
    if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')
    
    let key = e.key
    const map = { Escape: 'Escape', Enter: 'Enter', ' ': 'Space', Space: 'Space', Backspace: 'Backspace', Tab: 'Tab' }
    if (map[key]) key = map[key]
    else if (/^[a-z]$/.test(key)) key = key.toUpperCase()
    else if (/^[A-Z]$/.test(key)) { /* already upper */ }
    else if (/^F\d{1,2}$/i.test(key)) key = key.toUpperCase()
    else if (/^Arrow(Up|Down|Left|Right)$/.test(key)) key = key.replace('Arrow', '')
    else if (['Shift','Alt','Control','Meta'].includes(key)) {
      const preview = parts.join('+') || '—'
      document.getElementById('saveShortcut').disabled = true
      renderKeys(preview, 'shortcutPreviewKeys')
      return
    } else { return }
    
    parts.push(key)
    if (parts.length <= ((e.ctrlKey||e.metaKey?1:0)+(e.altKey?1:0)+(e.shiftKey?1:0))) return
    
    shortcutDraft = parts.join('+')
    renderKeys(shortcutDraft, 'shortcutPreviewKeys')
    document.getElementById('saveShortcut').disabled = false
  }
  
  window.addEventListener('keydown', onKey, { once: false })
  
  $('#saveShortcut').onclick = async () => {
    if (!shortcutDraft) { showMsg('请按下快捷键后再保存'); return }
    const ok = await window.clipfast.setShortcut(shortcutDraft)
    if (ok) {
      showMsg('快捷键已更新')
      m.classList.remove('show')
    } else {
      showMsg('快捷键设置失败')
    }
    window.removeEventListener('keydown', onKey)
  }
  
  $('#cancelShortcut').onclick = () => { 
    m.classList.remove('show')
    window.removeEventListener('keydown', onKey) 
  }
}

function renderKeys(acc, elId) {
  const el = document.getElementById(elId)
  if (!el) return
  el.innerHTML = ''
  const parts = String(acc || '—').split('+').filter(Boolean)
  if (!parts.length) parts.push('—')
  
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const map = { CommandOrControl: isMac ? '⌘' : 'Ctrl', Alt: isMac ? '⌥' : 'Alt', Shift: isMac ? '⇧' : 'Shift', Escape: 'Esc' }
  
  parts.forEach(p => {
    const chip = document.createElement('span')
    chip.className = 'key-chip'
    chip.textContent = map[p] || p
    el.appendChild(chip)
  })
}

document.addEventListener('DOMContentLoaded', init)
