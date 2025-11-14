// 简单的状态管理
let state = { type: 'all', keyword: '', onlyFavorites: false, list: [], active: null }
let pending = []
let scheduleId = null
let lastMove = null
let undoStack = []
let redoStack = []
let undoEnabled = false
let undoClosedShown = false

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
      <div class="text">${escapeHtml(previewText(item.text))}</div>
      <div class="actions">
        <button class="btn paste">一键粘贴</button>
        <button class="btn fav">${isFav(item.id) ? '取消收藏' : '收藏'}</button>
        <button class="btn del">删除</button>
      </div>
    `
    div.querySelector('.paste').onclick = () => window.clipfast.pasteToActive(item.text)
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
  const pre = document.createElement('pre')
  pre.textContent = item.text
  box.appendChild(pre)
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
      <div class="text">${escapeHtml(previewText(rec.text))}</div>
      <div class="actions">
        <button class="btn paste">一键粘贴</button>
        <button class="btn fav">收藏</button>
        <button class="btn del">删除</button>
      </div>
    `
    div.querySelector('.paste').onclick = () => window.clipfast.pasteToActive(rec.text)
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

function moveDomItemToTop(currentIndex) {
  const container = $('#list')
  const node = container.children[currentIndex]
  if (!node) return
  container.removeChild(node)
  container.insertBefore(node, container.firstChild)
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
