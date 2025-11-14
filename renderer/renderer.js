// 简单的状态管理
let state = { type: 'all', keyword: '', onlyFavorites: false, list: [], active: null }

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
  $('#search').oninput = async (e) => { state.keyword = e.target.value; await refresh() }
  $('#type').onchange = async (e) => { state.type = e.target.value; await refresh() }
  $('#onlyFav').onchange = async (e) => { state.onlyFavorites = e.target.checked; await refresh() }
  $$('.cat').forEach(btn => {
    btn.onclick = async () => {
      $$('.cat').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      state.type = btn.dataset.type
      await refresh()
    }
  })
  await refresh()
}

document.addEventListener('DOMContentLoaded', init)
