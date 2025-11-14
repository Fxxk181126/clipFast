const { clipboard } = require('electron')
const crypto = require('crypto')

let timer = null
let lastText = ''
let hashIndex = new Map()

function classifyText(text) {
  const t = text.trim()
  if (/^(https?:\/\/|www\.)/.test(t)) return 'link'
  if (/\n|;|\{|\}/.test(t) && /(function|const|let|var|class|def|import|public|private)/i.test(t)) return 'code'
  return 'text'
}

function idOf(text) {
  return crypto.createHash('sha1').update(text).digest('hex')
}

function buildIndex(records) {
  hashIndex.clear()
  for (const r of records) {
    const h = r.hash || idOf(r.text)
    hashIndex.set(h, r.id)
  }
}

function startClipboardWatcher(store, onEvent) {
  // 初始化索引，便于快速去重判断
  buildIndex(store.get('records') || [])

  timer = setInterval(() => {
    const text = clipboard.readText()
    if (!text) return
    if (text === lastText) return
    lastText = text

    const records = store.get('records')
    const hash = idOf(text)
    const existedId = hashIndex.get(hash)

    if (existedId) {
      // 已存在：将旧记录移动到顶部，保持原元数据不变
      const idx = records.findIndex(r => r.id === existedId)
      if (idx > 0) {
        const target = records[idx]
        const next = [target, ...records.slice(0, idx), ...records.slice(idx + 1)]
        store.set('records', next)
        // 触发事件，便于前端增量更新与提示/撤销
        if (typeof onEvent === 'function') onEvent({ kind: 'moved', id: target.id, fromIndex: idx, record: target })
      } else if (idx === 0) {
        // 已在顶部，无需动作
      }
    } else {
      // 新记录：创建并添加到顶部
      const rec = {
        id: hash + '-' + Date.now(),
        hash,
        type: classifyText(text),
        text,
        ts: Date.now(),
        tags: []
      }
      const max = store.get('settings.maxRecords') || 100000
      const next = [rec, ...records]
      if (next.length > max) next.length = max
      store.set('records', next)
      hashIndex.set(hash, rec.id)
      if (typeof onEvent === 'function') onEvent({ kind: 'created', record: rec })
    }
  }, 750)
}

function stopClipboardWatcher() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { startClipboardWatcher, stopClipboardWatcher }
