import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(process.cwd(), 'test', 'fixtures', 'd7-export')
const forbiddenName = /(?:credentials|provider-config|source-config|\.env|\.db(?:-|$)|\.jsonl$)/i
const forbiddenContent =
  /(?:api[_-]?key|authorization|bearer\s+|credential|secret|password|ciphertext|encrypted|\bsk-[A-Za-z0-9_-]{16,}\b|\b(?:v10|v11)[A-Za-z0-9+/=]{20,}\b)/i
const files = walk(root)
assert.ok(files.length > 0, 'no export artifacts found')
for (const file of files) {
  const relative = path.relative(root, file)
  assert.equal(forbiddenName.test(relative), false, `forbidden export path: ${relative}`)
  const content = fs.readFileSync(file, 'utf8')
  assert.equal(forbiddenContent.test(content), false, `credential sentinel found in ${relative}`)
}
console.log(JSON.stringify({ ok: true, files: files.length, root }))

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}
