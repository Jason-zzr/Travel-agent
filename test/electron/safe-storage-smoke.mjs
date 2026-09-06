import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, safeStorage } from 'electron'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-harness-safe-storage-'))

app.whenReady().then(() => {
  try {
    assert.equal(safeStorage.isEncryptionAvailable(), true)
    const sentinel = crypto.randomBytes(32).toString('hex')
    const encrypted = safeStorage.encryptString(sentinel)
    assert.equal(safeStorage.decryptString(encrypted), sentinel)

    const credentialPath = path.join(root, 'credentials.json')
    fs.writeFileSync(
      credentialPath,
      `${JSON.stringify({ version: 1, entries: { OPENAI: encrypted.toString('base64') }, reentryRequired: [] })}\n`,
      'utf8'
    )
    const persisted = fs.readFileSync(credentialPath, 'utf8')
    assert.equal(persisted.includes(sentinel), false)
    const evidence = {
      ok: true,
      capturedAt: new Date().toISOString(),
      electronVersion: process.versions.electron,
      encryptionAvailable: true,
      decryptMatches: true,
      plaintextAbsent: true
    }
    const evidencePath = path.join(process.cwd(), 'test', 'artifacts', 'safe-storage-smoke.json')
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true })
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(evidence))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    app.quit()
  }
})
