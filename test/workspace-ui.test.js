const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')

const markup = readFileSync(join(__dirname, '../renderer/index.html'), 'utf8')
const styles = readFileSync(join(__dirname, '../renderer/style.css'), 'utf8')
const mainSource = readFileSync(join(__dirname, '../main.js'), 'utf8')
const rendererSource = readFileSync(join(__dirname, '../renderer/renderer.js'), 'utf8')
const preloadSource = readFileSync(join(__dirname, '../preload.js'), 'utf8')

test('account entry belongs to the sidebar instead of the top toolbar', () => {
  const sidebar = markup.slice(
    markup.indexOf('<aside class="sidebar">'),
    markup.indexOf('</aside>')
  )
  const toolbar = markup.slice(
    markup.indexOf('<header class="top-bar">'),
    markup.indexOf('</header>')
  )

  assert.match(sidebar, /class="account-wrap sidebar-footer"/)
  assert.match(sidebar, /id="accountButton"/)
  assert.doesNotMatch(toolbar, /class="account-wrap"/)
})

test('brand lockups use the product icon instead of a letter placeholder', () => {
  const brandImages = markup.match(/<img[^>]+class="brand-logo[^>]*>/g) || []

  assert.equal(brandImages.length, 2)
  brandImages.forEach(image => {
    assert.match(image, /src="\.\.\/assets\/icon\.png"/)
    assert.doesNotMatch(image, />C</)
  })
  assert.doesNotMatch(markup, /class="brand-mark"[^>]*>C</)
})

test('all and text navigation use distinct icons', () => {
  const extractIcon = (type) => {
    const button = markup.match(new RegExp(`<button data-type="${type}"[\\s\\S]*?</button>`))
    assert.ok(button, `missing ${type} navigation item`)
    const icon = button[0].match(/<svg[\s\S]*?<\/svg>/)
    assert.ok(icon, `missing ${type} icon`)
    return icon[0].replace(/\s+/g, ' ')
  }

  assert.notEqual(extractIcon('all'), extractIcon('text'))
})

test('collapsed account menu stays inside the narrow window', () => {
  const compactStyles = styles.slice(styles.indexOf('@media (max-width: 780px)'))
  const accountMenu = compactStyles.match(/\.account-menu \{[\s\S]*?\}/)

  assert.ok(accountMenu, 'missing compact account menu styles')
  assert.match(accountMenu[0], /left: 8px;/)
  assert.doesNotMatch(accountMenu[0], /transform:\s*translateX/)
})

test('the supported minimum window width keeps the full workspace layout', () => {
  assert.match(mainSource, /minWidth:\s*800,/)
  assert.match(styles, /@media \(max-width:\s*780px\)/)
})

test('closing the panel keeps it available for the first shortcut', () => {
  assert.match(mainSource, /let isQuitting = false/)
  assert.match(mainSource, /app\.on\('before-quit', \(\) => \{\s*isQuitting = true\s*\}\)/)

  const closeHandler = mainSource.match(/mainWindow\.on\('close', \(event\) => \{[\s\S]*?\}\)/)
  assert.ok(closeHandler, 'missing panel close handler')
  assert.match(closeHandler[0], /if \(!isQuitting\)/)
  assert.match(closeHandler[0], /event\.preventDefault\(\)/)
  assert.match(closeHandler[0], /mainWindow\.hide\(\)/)
})

test('sandboxed preload inline IPC channels stay in sync with src/ipc-channels.js', () => {
  // 沙箱化 preload 无法 require 本地模块，通道名只能内联；
  // 用深度相等断言强制两份表保持同步，避免新增通道时只改一处。
  const inline = preloadSource.match(/const CH = (\{[\s\S]*?\n\})/)
  assert.ok(inline, 'missing inline CH table in preload.js')

  const inlineChannels = new Function(`return ${inline[1]}`)()
  assert.deepEqual(inlineChannels, require('../src/ipc-channels.js'))
})

test('duplicate capture no longer shows a persistent undo-closed toast', () => {
  assert.doesNotMatch(rendererSource, /撤销已关闭/)
  assert.doesNotMatch(rendererSource, /undoClosedShown/)
})

test('scrolling away keeps a clickable prompt for records captured later', () => {
  assert.match(markup, /id="newRecordsNotice"/)
  assert.match(markup, /id="newRecordsCount"/)
  assert.match(rendererSource, /unseenRecordCount/)
  assert.match(rendererSource, /document\.hidden/)
  assert.match(styles, /\.new-records-notice \{/)
})

test('the record list provides a scroll-to-top control', () => {
  assert.match(markup, /id="scrollToTop"/)
  assert.match(markup, /aria-label="回到顶部"/)
  assert.match(rendererSource, /SCROLL_TOP_THRESHOLD_PX/)
  assert.match(styles, /\.scroll-top \{/)
  assert.match(styles, /\.scroll-top\[hidden\] \{\s*display: none;/)
})
