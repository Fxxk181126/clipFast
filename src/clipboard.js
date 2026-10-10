const { clipboard, nativeImage } = require('electron')
const crypto = require('crypto')

const DEFAULT_MAX_RECORDS = 100000
const POLL_MS = 750
const PRUNE_DAYS = 3
const PRUNE_INTERVAL_MS = 30 * 60 * 1000

let timer = null
let pruneTimer = null
let lastText = ''
let lastImageFp = ''
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

// 图片变更检测指纹：降采样后编码哈希，避免每个轮询 tick 对全分辨率图做 PNG 编码
function imageFingerprint(img) {
  return idOf(img.resize({ width: 32 }).toPNG())
}

function recordHashes(r) {
  if (r.type === 'image') return [r.hash, r.thumbHash]
  return [r.hash || idOf(r.text)]
}

function buildIndex(records) {
  hashIndex.clear()
  for (const r of records) {
    for (const h of recordHashes(r)) {
      if (h) hashIndex.set(h, r.id)
    }
  }
}

// 记录数组是排序不变量的唯一权威：所有增/删/移都收敛到下面四个函数，hashIndex 随之同步维护

// 将已有记录移到顶部；返回 { id, fromIndex }（无需移动时返回 null）
function moveRecordToTop(store, id) {
  const records = store.get('records')
  const idx = records.findIndex(r => r.id === id)
  if (idx <= 0) return null
  const target = records[idx]
  store.set('records', [target, ...records.slice(0, idx), ...records.slice(idx + 1)])
  return { id: target.id, fromIndex: idx }
}

// 将记录移回指定索引（撤销置顶用）；返回实际落位索引（找不到记录返回 -1）
function moveRecordTo(store, id, toIndex) {
  const records = store.get('records')
  const curIndex = records.findIndex(r => r.id === id)
  if (curIndex < 0) return -1
  const item = records[curIndex]
  const arr = [...records]
  arr.splice(curIndex, 1)
  const clampIndex = Math.max(0, Math.min(toIndex, arr.length))
  arr.splice(clampIndex, 0, item)
  store.set('records', arr)
  return clampIndex
}

function deleteRecord(store, id) {
  const records = store.get('records')
  const target = records.find(r => r.id === id)
  if (!target) return false
  store.set('records', records.filter(r => r.id !== id))
  removeFromIndex(target)
  return true
}

function clearRecords(store) {
  store.set('records', [])
  hashIndex.clear()
}

function removeFromIndex(record) {
  for (const h of recordHashes(record)) {
    if (h && hashIndex.get(h) === record.id) hashIndex.delete(h)
  }
}

// 新记录前插 + 按 maxRecords 截断（截断时同步清理被裁记录的索引条目）
function prependRecord(store, rec) {
  const max = store.get('settings.maxRecords') || DEFAULT_MAX_RECORDS
  const records = store.get('records')
  const next = [rec, ...records]
  const overflow = next.length > max ? next.splice(max) : []
  store.set('records', next)
  for (const h of recordHashes(rec)) {
    if (h) hashIndex.set(h, rec.id)
  }
  overflow.forEach(removeFromIndex)
}

function pruneByAge(store) {
  const now = Date.now()
  const threshold = now - PRUNE_DAYS * 86400000
  const favorites = new Set(store.get('favorites') || [])
  const records = store.get('records') || []
  const keep = []
  const removed = []
  for (const r of records) {
    if (favorites.has(r.id) || r.ts >= threshold) keep.push(r)
    else removed.push(r)
  }
  if (removed.length) {
    store.set('records', keep)
    removed.forEach(removeFromIndex)
  }
  return { removedIds: removed.map(r => r.id) }
}

function startClipboardWatcher(store, onEvent) {
  const notify = typeof onEvent === 'function' ? onEvent : () => {}
  // 初始化索引，便于快速去重判断
  buildIndex(store.get('records') || [])

  const runPrune = () => {
    const { removedIds } = pruneByAge(store)
    if (removedIds.length) notify({ kind: 'pruned', removedIds })
  }
  // 过期由墙钟时间决定，与剪贴板活动无关：启动清一次，之后低频定时即可
  runPrune()
  pruneTimer = setInterval(runPrune, PRUNE_INTERVAL_MS)

  timer = setInterval(() => {
    const img = clipboard.readImage()
    if (!img.isEmpty()) {
      const fp = imageFingerprint(img)
      if (fp === lastImageFp) return
      lastImageFp = fp

      const ihash = idOf(img.toPNG())
      const existedId = hashIndex.get(ihash)
      if (existedId) {
        const moved = moveRecordToTop(store, existedId)
        if (moved) notify({ kind: 'moved', ...moved })
      } else {
        const thumb = img.resize({ width: 256 })
        const rec = {
          id: ihash + '-' + Date.now(),
          hash: ihash,       // 原图hash
          thumbHash: idOf(thumb.toPNG()),  // 缩略图hash（用于粘贴后移动）
          type: 'image',
          imageData: thumb.toDataURL(),
          ts: Date.now(),
          tags: []
        }
        prependRecord(store, rec)
        notify({ kind: 'created', record: rec })
      }
    } else {
      const text = clipboard.readText()
      if (!text) return
      if (text === lastText) return
      lastText = text

      const hash = idOf(text)
      const existedId = hashIndex.get(hash)
      if (existedId) {
        const moved = moveRecordToTop(store, existedId)
        if (moved) notify({ kind: 'moved', ...moved })
      } else {
        const rec = {
          id: hash + '-' + Date.now(),
          hash,
          type: classifyText(text),
          text,
          ts: Date.now(),
          tags: []
        }
        prependRecord(store, rec)
        notify({ kind: 'created', record: rec })
      }
    }
  }, POLL_MS)
}

function stopClipboardWatcher() {
  if (timer) clearInterval(timer)
  if (pruneTimer) clearInterval(pruneTimer)
  timer = null
  pruneTimer = null
}

// 粘贴图片后调用：把指纹标记为“已见过”，避免轮询器把自己的粘贴重捕获
function notePastedImage(dataUrl) {
  lastImageFp = dataUrl ? imageFingerprint(nativeImage.createFromDataURL(dataUrl)) : ''
}

function notePastedText(text) {
  lastText = text || ''
}

module.exports = {
  DEFAULT_MAX_RECORDS,
  moveRecordToTop,
  moveRecordTo,
  deleteRecord,
  clearRecords,
  startClipboardWatcher,
  stopClipboardWatcher,
  notePastedImage,
  notePastedText
}
