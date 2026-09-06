import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import App from '../../src/renderer/src/App'

test('app shell renders the premium Chinese navigation without triggering external work', () => {
  const externalCalls = 0
  const markup = renderToStaticMarkup(createElement(App))

  assert.match(markup, /aria-label="主导航"/)
  assert.equal((markup.match(/class="nav-icon"/g) ?? []).length, 7)
  assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1)
  assert.match(markup, /规划/)
  assert.match(markup, /路线骨架/)
  assert.match(markup, /行程/)
  assert.match(markup, /待办/)
  assert.match(markup, /证据/)
  assert.match(markup, /运行记录/)
  assert.match(markup, /设置/)
  assert.match(markup, /本地优先 · 外部只读/)
  assert.match(markup, /把复杂旅行拆成可确认的决定/)
  assert.equal(externalCalls, 0)
})
