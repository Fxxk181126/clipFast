// State Management
let state = {
  type: 'all',
  keyword: '',
  onlyFavorites: false,
  list: []
}
let pending = []
let scheduleId = null
let searchTimer = null
let toastTimer = null
let undoStack = [] // 元素为 { id, fromIndex }，栈顶为最近一次置顶
let undoClosedShown = false
let shortcutDraft = null

// 列表最多保留的可见条数（须与 main.js 的 LIST_CAP 一致）
const MAX_VISIBLE = 500
const SEARCH_DEBOUNCE_MS = 250

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => Array.from(document.querySelectorAll(sel))

// 卡片操作按钮图标（与 index.html 顶栏图标保持一致）
const ICONS = {
  paste: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>',
  star: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
  trash: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>'
}

function flash(card) {
  card.classList.add('flash')
  setTimeout(() => card.classList.remove('flash'), 1000)
}

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

  // Content HTML
  let contentHtml = ''
  if (item.type === 'image') {
    contentHtml = `<img class="card-img" src="${item.imageData}" alt="Image Preview" />`
  } else {
    contentHtml = `<div class="card-text">${escapeHtml(previewText(item.text))}</div>`
  }

  // Fav Status（新捕获的记录必然不是收藏，refresh 时由主进程注入 __fav）
  const isFavorite = !!item.__fav

  div.innerHTML = `
    <div class="card-header">
      <span class="card-type-badge ${item.type || 'text'}">${item.type.toUpperCase()}</span>
      <span class="card-time">${new Date(item.ts).toLocaleString()}</span>
    </div>
    <div class="card-content">
      ${contentHtml}
    </div>
    <div class="card-actions">
      <button class="card-btn paste" title="一键粘贴">
        ${ICONS.paste}
        一键粘贴
      </button>
      <button class="card-btn fav ${isFavorite ? 'active' : ''}" title="${isFavorite ? '取消收藏' : '收藏'}">
        ${ICONS.star}
        ${isFavorite ? '已收藏' : '收藏'}
      </button>
      <button class="card-btn delete" title="删除">
        ${ICONS.trash}
        删除
      </button>
    </div>
  `

  // Event Listeners
  div.querySelector('.paste').onclick = (e) => {
    e.stopPropagation()
    window.clipfast.pasteToActive(item.id)
  }

  div.querySelector('.fav').onclick = async (e) => {
    e.stopPropagation()
    await window.clipfast.favoriteRecord(item.id, !item.__fav)
    await refresh()
  }

  div.querySelector('.delete').onclick = async (e) => {
    e.stopPropagation()
    if (confirm('确定要删除这条记录吗？')) {
      await window.clipfast.deleteRecord(item.id)
      await refresh()
    }
  }

  return div
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

  if (container.querySelector('.placeholder')) {
    container.innerHTML = ''
  }

  for (const rec of items) {
    if (!matches(rec)) continue

    // Check if exists
    if (state.list.some(x => x.id === rec.id)) continue

    state.list.unshift({ ...rec, __fav: false })
    if (state.list.length > MAX_VISIBLE) state.list.length = MAX_VISIBLE

    const card = createCardElement({ ...rec, __fav: false })
    flash(card)
    container.insertBefore(card, container.firstChild)

    while (container.children.length > MAX_VISIBLE) {
      container.removeChild(container.lastChild)
    }
  }
}

// 须与 main.js records:list 的过滤规则保持一致（增量插入用；全量刷新走主进程过滤）
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
  const toast = $('#toast')
  toast.textContent = s
  toast.classList.toggle('show', !!s)
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
  if (s && !persistent) {
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2000)
  }
}

function resetUndo() {
  undoStack.length = 0
  $('#undoMsg').style.display = 'none'
}

function moveDomItemToTop(currentIndex) {
  const container = $('#list')
  const prevScroll = container.scrollTop
  const node = container.children[currentIndex]
  if (!node) return

  container.removeChild(node)
  container.insertBefore(node, container.firstChild)
  flash(node)
  container.scrollTop = prevScroll
}

// Initialization
async function init() {
  undoClosedShown = localStorage.getItem('undoClosedShown') === '1'

  // Header Actions
  $('#openShortcut').onclick = openShortcutModal

  $('#search').oninput = (e) => {
    state.keyword = e.target.value
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { searchTimer = null; refresh() }, SEARCH_DEBOUNCE_MS)
  }

  // Toggle Favorites
  $('#toggleFav').onclick = async () => {
    state.onlyFavorites = !state.onlyFavorites
    $('#toggleFav').classList.toggle('active', state.onlyFavorites)
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

  // 撤销按钮只绑定一次
  $('#undoBtn').onclick = async (e) => {
    e.preventDefault()
    const top = undoStack[0]
    if (!top) return
    const ok = await window.clipfast.undoMove(top.id, top.fromIndex)
    if (!ok) showMsg('撤销失败')
    else resetUndo()
  }

  // Events
  window.clipfastEvents.onNewRecord((rec) => {
    pending.push(rec)
    if (undoStack.length && !undoClosedShown) {
      showMsg('撤销已关闭', true)
      undoClosedShown = true
      localStorage.setItem('undoClosedShown', '1')
    }
    resetUndo()
    if (scheduleId) return
    scheduleId = setTimeout(() => {
      scheduleId = null
      try {
        applyIncremental(pending.splice(0))
      } catch { showMsg('更新失败') }
    }, 250)
  })

  window.clipfastEvents.onMovedRecord(({ id, fromIndex }) => {
    const idx = state.list.findIndex(x => x.id === id)
    if (idx >= 0) {
      const item = state.list[idx]
      state.list.splice(idx, 1)
      state.list.unshift(item)
      moveDomItemToTop(idx)

      undoStack.unshift({ id, fromIndex })
      undoClosedShown = false
      localStorage.removeItem('undoClosedShown')
      $('#undoMsg').style.display = 'flex'
    }
  })

  window.clipfastEvents.onUndoed(() => {
    refresh().then(() => showMsg('已撤销移动'))
    resetUndo()
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
    $('#shortcutCurrentKeys').textContent = s?.shortcut || '—'
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
    const map = { ' ': 'Space' }
    if (map[key]) key = map[key]
    else if (/^[a-z]$/.test(key)) key = key.toUpperCase()
    else if (/^F\d{1,2}$/i.test(key)) key = key.toUpperCase()
    else if (/^Arrow(Up|Down|Left|Right)$/.test(key)) key = key.replace('Arrow', '')
    else if (['Shift','Alt','Control','Meta'].includes(key)) {
      renderKeys(parts.join('+') || '—', 'shortcutPreviewKeys')
      $('#saveShortcut').disabled = true
      return
    } else { return }

    parts.push(key)
    if (parts.length <= ((e.ctrlKey||e.metaKey?1:0)+(e.altKey?1:0)+(e.shiftKey?1:0))) return

    shortcutDraft = parts.join('+')
    renderKeys(shortcutDraft, 'shortcutPreviewKeys')
    $('#saveShortcut').disabled = false
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
