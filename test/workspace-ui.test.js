const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')

const markup = readFileSync(join(__dirname, '../renderer/index.html'), 'utf8')

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
