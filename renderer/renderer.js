// 简单的状态管理
let state = { type: 'all', keyword: '', onlyFavorites: false, list: [], active: null }
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

function renderList() {
  const container = $('#list')
  container.innerHTML = ''
  if (!state.list.length) {
    container.innerHTML = '<div class="placeholder">暂无记录</div>'
    return
  }
  state.list.forEach(item => {
    const div = document.createElement('div')
    div.className = 'item'
    div.innerHTML = `
      <div class="meta">
        <span>${item.type.toUpperCase()}</span>
        <span>${new Date(item.ts).toLocaleString()}</span>
      </div>
      ${item.type === 'image' ? `<img class="img" src="${item.imageData}" />` : `<div class="text">${escapeHtml(previewText(item.text))}</div>`}
      <div class="actions">
        <button class="btn paste">一键粘贴</button>
        <button class="btn fav">${isFav(item.id) ? '取消收藏' : '收藏'}</button>
        <button class="btn del">删除</button>
      </div>
    `
    div.querySelector('.paste').onclick = () => {
      if (item.type === 'image') window.clipfastImage.pasteToActive(item.imageData, item.id)
      else window.clipfast.pasteToActive(item.text, item.id)
    }
    div.querySelector('.fav').onclick = async () => {
      const next = !isFav(item.id)
      await window.clipfast.favoriteRecord(item.id, next)
      await refresh()
    }
    div.querySelector('.del').onclick = async () => {
      await window.clipfast.deleteRecord(item.id)
      await refresh()
    }
    div.onclick = () => {
      state.active = item
      renderPreview()
    }
    container.appendChild(div)
  })
}

function renderPreview() {
  const box = $('#preview')
  box.innerHTML = ''
  if (!state.active) {
    box.innerHTML = '<div class="placeholder">选择一条记录查看预览</div>'
    return
  }
  const item = state.active
  if (item.type === 'image') {
    const img = document.createElement('img')
    img.src = item.imageData
    img.style.maxWidth = '100%'
    box.appendChild(img)
  } else {
    const pre = document.createElement('pre')
    pre.textContent = item.text
    box.appendChild(pre)
  }
}

function isFav(id) {
  // 渲染时通过列表判断是否处于收藏过滤，简单保持一致
  // 为避免额外 IPC，改为重刷列表后由主进程返回最新收藏状态
  return !!state.list.find(x => x.id === id && x.__fav)
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

function previewText(s) {
  const trimmed = s.trim()
  return trimmed.length > 300 ? trimmed.slice(0, 300) + '…' : trimmed
}

async function refresh() {
  const list = await window.clipfast.listRecords({ type: state.type, keyword: state.keyword, onlyFavorites: state.onlyFavorites })
  state.list = list
  renderList()
}

async function init() {
  const settings = await window.clipfast.getSettings()
  undoClosedShown = localStorage.getItem('undoClosedShown') === '1'
  $('#openShortcut').onclick = openShortcutModal
  $('#search').oninput = async (e) => { state.keyword = e.target.value; await refresh() }
  $('#type').onchange = async (e) => { state.type = e.target.value; await refresh() }
  $('#onlyFav').onchange = async (e) => { state.onlyFavorites = e.target.checked; await refresh() }
  $('#refresh').onclick = async () => { try { await refresh(); showMsg('已刷新') } catch { showMsg('刷新失败') } }
  $$('.cat').forEach(btn => {
    btn.onclick = async () => {
      $$('.cat').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      state.type = btn.dataset.type
      await refresh()
    }
  })
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
  // 复制操作发生后关闭撤销面板并重置堆栈
  window.clipfastEvents.onNewRecord(() => {
    // 仅在撤销功能从开启变为关闭的瞬间提示一次
    if (undoEnabled && !undoClosedShown) {
      showMsg('撤销已关闭', true)
      undoClosedShown = true
      localStorage.setItem('undoClosedShown', '1')
    }
    resetUndo()
  })
  window.clipfastEvents.onMovedRecord(({ id, fromIndex }) => {
    // 若当前筛选能看到该记录，则将其移动到顶部，并提示可撤销
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
    } else {
      // 不在当前筛选结果中，仅提示
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
    // 撤销完成后推入重做栈，并清空当前 lastMove
    const u = undoStack.shift()
    if (u) redoStack.unshift({ id: u.id, fromIndex: u.toIndex, toIndex: u.fromIndex })
    refresh().then(() => showMsg('已撤销移动'))
    lastMove = null
    undoEnabled = false
    removeUndoLink()
  })
  window.clipfastEvents.onPruned(({ ids }) => {
    if (Array.isArray(ids) && ids.length) {
      refresh().then(() => showMsg('已清理过期记录'))
    }
  })
  await refresh()
}

function applyIncremental(items) {
  const container = $('#list')
  if (!items.length) return
  if (!state.list.length && container.innerHTML.includes('暂无记录')) container.innerHTML = ''
  for (const rec of items) {
    if (!matches(rec)) continue
    const exists = state.list.find(x => x.id === rec.id)
    if (exists) continue
    state.list.unshift({ ...rec, __fav: false })
    if (state.list.length > 500) state.list.length = 500
    const div = document.createElement('div')
    div.className = 'item'
    div.innerHTML = `
      <div class="meta">
        <span>${rec.type.toUpperCase()}</span>
        <span>${new Date(rec.ts).toLocaleString()}</span>
      </div>
      ${rec.type === 'image' ? `<img class="img" src="${rec.imageData}" />` : `<div class="text">${escapeHtml(previewText(rec.text))}</div>`}
      <div class="actions">
        <button class="btn paste">一键粘贴</button>
        <button class="btn fav">收藏</button>
        <button class="btn del">删除</button>
      </div>
    `
    div.querySelector('.paste').onclick = () => {
      if (rec.type === 'image') window.clipfastImage.pasteToActive(rec.imageData, rec.id)
      else window.clipfast.pasteToActive(rec.text, rec.id)
    }
    div.querySelector('.fav').onclick = async () => { await window.clipfast.favoriteRecord(rec.id, true); await refresh() }
    div.querySelector('.del').onclick = async () => { await window.clipfast.deleteRecord(rec.id); await refresh() }
    div.onclick = () => { state.active = rec; renderPreview() }
    if (container.firstChild) container.insertBefore(div, container.firstChild)
    else container.appendChild(div)
    if (container.children.length > 500) container.removeChild(container.lastChild)
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

function showMsg(s, persistent = false) {
  const el = $('#msg'); if (!el) return
  el.textContent = s
  if (!s) { el.classList.remove('show'); return }
  el.classList.add('show')
  clearTimeout(el.__t)
  if (persistent || lastMove) return
  el.__t = setTimeout(() => { if (!lastMove) { el.textContent = ''; el.classList.remove('show') } }, 1800)
}

function showUndoBanner() {
  showMsg('已将重复内容移动到顶部', true)
  addUndoLink()
}

function addUndoLink() {
  const el = $('#msg'); if (!el) return
  const link = document.createElement('a')
  link.href = 'javascript:void(0)'
  link.style.marginLeft = '6px'
  link.textContent = '撤销'
  link.onclick = async () => {
    const top = undoStack[0]
    if (!top) return
    const ok = await window.clipfast.undoMove(top.id, top.fromIndex)
    if (!ok) showMsg('撤销失败')
    else closeUndoPanel()
  }
  removeUndoLink()
  el.appendChild(link)
  el.__undo = link
}

function removeUndoLink() { const el = $('#msg'); if (el && el.__undo) { try { el.removeChild(el.__undo) } catch {} el.__undo = null; if (!el.textContent) el.classList.remove('show') } }

function closeUndoPanel() { removeUndoLink(); showMsg('', false) }
function resetUndo() { lastMove = null; undoStack.length = 0; redoStack.length = 0; undoEnabled = false; removeUndoLink() }

function openShortcutModal() {
  const m = $('#shortcutModal')
  shortcutDraft = null
  renderKeys('—', 'shortcutPreviewKeys')
  window.clipfast.getSettings().then(s => { const cur = s?.shortcut || '—'; const el = document.getElementById('shortcutCurrentKeys'); if (el) el.textContent = cur })
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
    // 统一常见按键名称到 Electron Accelerator
    const map = { Escape: 'Escape', Enter: 'Enter', ' ': 'Space', Space: 'Space', Backspace: 'Backspace', Tab: 'Tab' }
    if (map[key]) key = map[key]
    else if (/^[a-z]$/.test(key)) key = key.toUpperCase()
    else if (/^[A-Z]$/.test(key)) {
      // 已是大写字母
    } else if (/^F\d{1,2}$/i.test(key)) key = key.toUpperCase()
    else if (/^Arrow(Up|Down|Left|Right)$/.test(key)) key = key.replace('Arrow', '')
    else if (/^\d$/.test(key)) {
      // 数字键
    } else if (['Shift','Alt','Control','Meta'].includes(key)) {
      // 仅修饰键：实时预览组合，但不生成可保存的快捷键
      const preview = parts.join('+') || '—'
      document.getElementById('saveShortcut').disabled = true
      renderKeys(preview, 'shortcutPreviewKeys')
      return
    } else {
      return
    }
    parts.push(key)
    // 至少包含一个非修饰键
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
  $('#cancelShortcut').onclick = () => { m.classList.remove('show'); window.removeEventListener('keydown', onKey) }
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

function moveDomItemToTop(currentIndex) {
  const container = $('#list')
  const prevScroll = container.scrollTop
  const node = container.children[currentIndex]
  if (!node) return
  container.removeChild(node)
  container.insertBefore(node, container.firstChild)
  node.classList.add('flash')
  setTimeout(() => node.classList.remove('flash'), 600)
  container.scrollTop = prevScroll
}

function moveDomItem(from, to) {
  const container = $('#list')
  const node = container.children[from]
  if (!node) return
  container.removeChild(node)
  const ref = container.children[to] || null
  container.insertBefore(node, ref)
}

document.addEventListener('DOMContentLoaded', init)
