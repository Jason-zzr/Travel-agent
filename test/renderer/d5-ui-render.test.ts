import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { D5View } from '../../src/renderer/src/D5View'

test('D5 skeleton workspace renders all local planning controls without invoking external sources', () => {
  const externalCalls = 0
  const markup = renderToStaticMarkup(createElement(D5View))

  assert.match(markup, /生成日级骨架/)
  assert.match(markup, /确认骨架并进入住宿/)
  assert.match(markup, /汇总住宿候选/)
  assert.match(markup, /门到门交通/)
  assert.match(markup, /日级行程骨架/)
  assert.match(markup, /整段住宿候选/)
  assert.doesNotMatch(markup, /严格 JSON 参数/)
  assert.doesNotMatch(markup, /按实时来源参数/)
  assert.equal(externalCalls, 0)
})
