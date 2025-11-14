const { clipboard, nativeImage } = require('electron')
const crypto = require('crypto')

let timer = null
let lastText = ''
let lastImageHash = ''
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
    if (r.type === 'image') {
      if (r.hash) hashIndex.set(r.hash, r.id)
      if (r.thumbHash) hashIndex.set(r.thumbHash, r.id)
    } else {
      const h = r.hash || idOf(r.text)
      hashIndex.set(h, r.id)
    }
  }
}

function startClipboardWatcher(store, onEvent) {
  // 初始化索引，便于快速去重判断
  buildIndex(store.get('records') || [])

  timer = setInterval(() => {
    const img = clipboard.readImage()
    if (!img.isEmpty()) {
      const png = img.toPNG()
      const ihash = crypto.createHash('sha1').update(png).digest('hex')
      if (ihash !== lastImageHash) {
        lastImageHash = ihash
        const records = store.get('records')
        const existedId = hashIndex.get(ihash)
        if (existedId) {
          const idx = records.findIndex(r => r.id === existedId)
          if (idx > 0) {
            const target = records[idx]
            const next = [target, ...records.slice(0, idx), ...records.slice(idx + 1)]
            store.set('records', next)
            if (typeof onEvent === 'function') onEvent({ kind: 'moved', id: target.id, fromIndex: idx, record: target })
          }
        } else {
          const thumb = img.resize({ width: 256 })
          const thash = crypto.createHash('sha1').update(thumb.toPNG()).digest('hex')
          const rec = {
            id: ihash + '-' + Date.now(),
            hash: ihash,       // 原图hash
            thumbHash: thash,  // 缩略图hash（用于粘贴后移动）
            type: 'image',
            imageData: thumb.toDataURL(),
            ts: Date.now(),
            tags: []
          }
          const max = store.get('settings.maxRecords') || 100000
          const next = [rec, ...records]
          if (next.length > max) next.length = max
          store.set('records', next)
          hashIndex.set(ihash, rec.id)
          hashIndex.set(thash, rec.id)
          if (typeof onEvent === 'function') onEvent({ kind: 'created', record: rec })
        }
      }
    } else {
      const text = clipboard.readText()
      if (!text) return
      if (text === lastText) return
      lastText = text

      const records = store.get('records')
      const hash = idOf(text)
      const existedId = hashIndex.get(hash)

      if (existedId) {
        const idx = records.findIndex(r => r.id === existedId)
        if (idx > 0) {
          const target = records[idx]
          const next = [target, ...records.slice(0, idx), ...records.slice(idx + 1)]
          store.set('records', next)
          if (typeof onEvent === 'function') onEvent({ kind: 'moved', id: target.id, fromIndex: idx, record: target })
        }
      } else {
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
    }

    const prune = pruneByAge(store, 3)
    if (prune.removedIds.length && typeof onEvent === 'function') onEvent({ kind: 'pruned', removedIds: prune.removedIds })
  }, 750)
}

function pruneByAge(store, days = 3) {
  const now = Date.now()
  const threshold = now - days * 86400000
  const favorites = new Set(store.get('favorites') || [])
  const records = store.get('records') || []
  const keep = []
  const removedIds = []
  for (const r of records) {
    if (favorites.has(r.id) || r.ts >= threshold) keep.push(r)
    else removedIds.push(r.id)
  }
  if (removedIds.length) {
    store.set('records', keep)
    for (const id of removedIds) {
      const item = records.find(x => x.id === id)
      const h = item?.hash || (item?.text ? idOf(item.text) : null)
      if (h) hashIndex.delete(h)
    }
  }
  return { removedIds }
}

function stopClipboardWatcher() {
  if (timer) clearInterval(timer)
  timer = null
}

function notePastedImageHash(hash) {
  lastImageHash = hash || ''
}

function notePastedText(text) {
  lastText = text || ''
}

module.exports = { startClipboardWatcher, stopClipboardWatcher, pruneByAge, notePastedImageHash, notePastedText }
