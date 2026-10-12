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
let appInitialized = false
let authConfigured = true

// 列表最多保留的可见条数（须与 main.js 的 LIST_CAP 一致）
const MAX_VISIBLE = 500
const SEARCH_DEBOUNCE_MS = 250

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => Array.from(document.querySelectorAll(sel))

function showAuthMessage(notice = '', error = '') {
  const noticeEl = $('#authNotice')
  const errorEl = $('#authError')
  noticeEl.textContent = notice
  noticeEl.hidden = !notice
  errorEl.textContent = error
  errorEl.hidden = !error
}

function switchAuthMode(mode) {
  $('#showLogin').classList.toggle('active', mode === 'login')
  $('#showRegister').classList.toggle('active', mode === 'register')
  $('#loginForm').hidden = mode !== 'login'
  $('#registerForm').hidden = mode !== 'register'
  $('#resetForm').hidden = mode !== 'reset'
  const headings = {
    login: ['登录 ClipFast', '使用邮箱密码继续'],
    register: ['创建 ClipFast 账号', '注册后可在本机使用全部功能'],
    reset: ['重置密码', '输入注册邮箱，我们会发送重置链接']
  }
  const [title, description] = headings[mode] || headings.login
  $('#authTitle').textContent = title
  $('#authDescription').textContent = description
  // 配置错误必须跨登录/注册/重置页持续展示，否则用户会看到按钮禁用但找不到原因。
  if (authConfigured) showAuthMessage()
}

function setAuthConfigured(enabled, message = '') {
  authConfigured = enabled
  if (enabled) {
    showAuthMessage()
    return
  }
  showAuthMessage('', message)
  $$('.auth-form .auth-submit').forEach(button => { button.disabled = true })
}

function setAccountMenu(open) {
  $('#accountMenu').hidden = !open
  $('#accountButton').setAttribute('aria-expanded', String(open))
}

function updateAccountIdentity(email = '') {
  const normalizedEmail = String(email || '').trim()
  const identity = normalizedEmail || '未登录'
  const localName = normalizedEmail.split('@')[0] || ''
  const initials = localName.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase()

  $('#accountEmail').textContent = identity
  $('#accountMenuEmail').textContent = identity
  $('#accountAvatar').textContent = initials || 'C'
  $('#accountMenuAvatar').textContent = initials || 'C'
}

let confirmResolver = null

function closeConfirmDialog(result) {
  if (!confirmResolver) return
  const resolve = confirmResolver
  confirmResolver = null
  $('#confirmModal').classList.remove('show')
  resolve(result)
}

function confirmAction({ title, message, actionLabel = '删除' }) {
  closeConfirmDialog(false)
  $('#confirmTitle').textContent = title
  $('#confirmMessage').textContent = message
  $('#confirmAction').textContent = actionLabel
  $('#confirmModal').classList.add('show')
  return new Promise(resolve => {
    confirmResolver = resolve
    $('#confirmAction').focus()
  })
}

async function submitAuthAction(button, action) {
  const originalText = button.textContent
  button.disabled = true
  button.textContent = '处理中...'
  try {
    return await action()
  } finally {
    button.textContent = originalText
    button.disabled = false
  }
}

function showAuth() {
  $('#appRoot').hidden = true
  $('#authView').hidden = false
  updateAccountIdentity()
  setAccountMenu(false)
}

function enterApp(user) {
  $('#authView').hidden = true
  $('#appRoot').hidden = false
  updateAccountIdentity(user?.email)
  setAccountMenu(false)
  if (!appInitialized) {
    appInitialized = true
    init()
  }
}

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

function timeAgo(timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value)) return ''

  const diff = Date.now() - value
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < day * 2) return '昨天'

  const date = new Date(value)
  const now = new Date()
  const format = date.getFullYear() === now.getFullYear() ? 'MM-DD HH:mm' : 'YYYY-MM-DD HH:mm'
  const pad = (n) => String(n).padStart(2, '0')
  if (format === 'MM-DD HH:mm') {
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function setIcon(svg, size) {
  return svg.replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`)
}

const TYPE_LABELS = {
  text: '文本',
  link: '链接',
  code: '代码',
  image: '图片',
  video: '视频'
}

// Create a single card element
function createCardElement(item) {
  const div = document.createElement('article')
  div.className = 'clip-row'
  div.id = `item-${item.id}`
  div.tabIndex = 0

  const preview = document.createElement('div')
  preview.className = 'row-preview'
  if (item.type === 'image') {
    const img = document.createElement('img')
    img.className = 'row-image'
    img.alt = '剪贴板图片预览'
    img.src = item.imageData || ''
    preview.appendChild(img)
  } else {
    preview.classList.add(item.type === 'code' ? 'mono' : 'text')
    preview.textContent = previewText(item.text)
  }

  // Fav Status（新捕获的记录必然不是收藏，refresh 时由主进程注入 __fav）
  const isFavorite = !!item.__fav
  const recordType = item.type || 'text'

  const meta = document.createElement('div')
  meta.className = 'row-meta'

  const badge = document.createElement('span')
  badge.className = `type-badge ${recordType}`
  badge.textContent = TYPE_LABELS[recordType] || recordType

  const time = document.createElement('span')
  time.className = 'row-time'
  time.textContent = timeAgo(item.ts)

  meta.append(badge, time)

  const main = document.createElement('div')
  main.className = 'row-main'
  main.append(meta, preview)
  div.appendChild(main)

  const actions = document.createElement('div')
  actions.className = 'row-actions'

  const pasteButton = document.createElement('button')
  pasteButton.className = 'icon-action paste'
  pasteButton.title = '一键粘贴'
  pasteButton.innerHTML = setIcon(ICONS.paste, 15)

  const favButton = document.createElement('button')
  favButton.className = `icon-action fav ${isFavorite ? 'active' : ''}`
  favButton.title = isFavorite ? '取消收藏' : '收藏'
  favButton.innerHTML = setIcon(ICONS.star, 15)

  const deleteButton = document.createElement('button')
  deleteButton.className = 'icon-action delete'
  deleteButton.title = '删除'
  deleteButton.innerHTML = setIcon(ICONS.trash, 15)

  actions.append(pasteButton, favButton, deleteButton)
  div.appendChild(actions)

  // Event Listeners
  pasteButton.onclick = (e) => {
    e.stopPropagation()
    window.clipfast.pasteToActive(item.id)
  }

  favButton.onclick = async (e) => {
    e.stopPropagation()
    await window.clipfast.favoriteRecord(item.id, !item.__fav)
    await refresh()
  }

  deleteButton.onclick = async (e) => {
    e.stopPropagation()
    const confirmed = await confirmAction({
      title: '删除这条记录？',
      message: '删除后无法恢复。'
    })
    if (confirmed) {
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
    const confirmed = await confirmAction({
      title: '清空所有记录？',
      message: '本地保存的全部剪贴板记录都会被删除，此操作不可恢复。',
      actionLabel: '清空'
    })
    if (confirmed) {
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

async function initAuth() {
  // 先展示登录骨架，避免会话恢复请求卡住时窗口保持空白。
  showAuth()

  const modeButtons = [
    ['#showLogin', () => switchAuthMode('login')],
    ['#showRegister', () => switchAuthMode('register')],
    ['#showReset', () => switchAuthMode('reset')],
    ['#showLoginFromRegister', () => switchAuthMode('login')],
    ['#showLoginFromReset', () => switchAuthMode('login')]
  ]
  modeButtons.forEach(([selector, onClick]) => { $(selector).onclick = onClick })

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault()
    showAuthMessage()
    const result = await submitAuthAction(event.submitter, () => window.clipfastAuth.signIn(
      $('#loginEmail').value,
      $('#loginPassword').value
    ))
    if (!result.ok) {
      showAuthMessage('', result.error.message)
      return
    }
    enterApp(result.user)
  })

  $('#registerForm').addEventListener('submit', async (event) => {
    event.preventDefault()
    showAuthMessage()
    if ($('#registerPassword').value !== $('#registerConfirmPassword').value) {
      showAuthMessage('', '两次输入的密码不一致。')
      return
    }
    const result = await submitAuthAction(event.submitter, () => window.clipfastAuth.signUp(
      $('#registerEmail').value,
      $('#registerPassword').value
    ))
    if (!result.ok) {
      showAuthMessage('', result.error.message)
      return
    }
    if (result.status === 'confirmation_required') {
      switchAuthMode('login')
      showAuthMessage('确认邮件已发送，请确认邮箱后再登录。')
      return
    }
    enterApp(result.user)
  })

  $('#resetForm').addEventListener('submit', async (event) => {
    event.preventDefault()
    showAuthMessage()
    const result = await submitAuthAction(event.submitter, () => window.clipfastAuth.requestPasswordReset(
      $('#resetEmail').value
    ))
    if (!result.ok) {
      showAuthMessage('', result.error.message)
      return
    }
    switchAuthMode('login')
    showAuthMessage('重置邮件已发送，请按邮件指引设置新密码。')
  })

  $('#accountButton').onclick = () => {
    setAccountMenu($('#accountMenu').hidden)
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.account-wrap')) setAccountMenu(false)
  })

  $('#signOutButton').onclick = async () => {
    setAccountMenu(false)
    await window.clipfastAuth.signOut()
  }

  $('#confirmCancel').onclick = () => closeConfirmDialog(false)
  $('#confirmAction').onclick = () => closeConfirmDialog(true)
  $('#confirmModal').onclick = (event) => {
    if (event.target === $('#confirmModal')) closeConfirmDialog(false)
  }

  if (!window.clipfastAuth) {
    setAuthConfigured(false, '认证服务初始化失败，请重启应用。')
    return
  }

  let session
  try {
    session = await window.clipfastAuth.getSession()
  } catch {
    setAuthConfigured(false, '无法读取登录状态，请重启应用。')
    return
  }
  if (!session.configured) {
    setAuthConfigured(false, session.error?.message || '认证服务未配置，请设置 CLIPFAST_SUPABASE_URL 和 CLIPFAST_SUPABASE_ANON_KEY。')
    return
  }

  window.clipfastAuth.onAuthChanged(({ user }) => {
    if (user) enterApp(user)
    else showAuth()
  })

  if (session.authenticated) enterApp(session.user)
  else showAuth()
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

document.addEventListener('DOMContentLoaded', initAuth)
