const { clipboard } = require('electron')
const crypto = require('crypto')

let timer = null
let lastText = ''

function classifyText(text) {
  const t = text.trim()
  if (/^(https?:\/\/|www\.)/.test(t)) return 'link'
  if (/\n|;|\{|\}/.test(t) && /(function|const|let|var|class|def|import|public|private)/i.test(t)) return 'code'
  return 'text'
}

function idOf(text) {
  return crypto.createHash('sha1').update(text).digest('hex')
}

function startClipboardWatcher(store) {
  // 轮询剪贴板变化（750ms），避免系统 API 事件差异
  timer = setInterval(() => {
    const text = clipboard.readText()
    if (!text) return
    if (text === lastText) return
    lastText = text

    const records = store.get('records')
    const rec = {
      id: idOf(text) + '-' + Date.now(), // 避免同内容重复ID冲突，附加时间戳
      type: classifyText(text),
      text,
      ts: Date.now(),
      tags: []
    }

    // 存储上限控制
    const max = store.get('settings.maxRecords') || 100000
    const next = [rec, ...records]
    if (next.length > max) next.length = max
    store.set('records', next)
  }, 750)
}

function stopClipboardWatcher() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { startClipboardWatcher, stopClipboardWatcher }
