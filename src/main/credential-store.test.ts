import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AppError } from '../shared/errors'
import { CredentialFileSchema } from '../shared/schema/credentials'
import { CredentialStore, type SafeStoragePort } from './credential-store'

class FakeSafeStorage implements SafeStoragePort {
  available = true

  isEncryptionAvailable(): boolean {
    return this.available
  }

  encryptString(value: string): Buffer {
    return Buffer.from(Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5))
  }

  decryptString(value: Buffer): string {
    if (value.length === 0 || value[0] === 0) throw new Error('corrupt ciphertext')
    return Buffer.from(value.map((byte) => byte ^ 0xa5)).toString('utf8')
  }
}

test('credential file is versioned, atomic, clearable, and contains no plaintext', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-credential-'))
  const filePath = join(root, 'credentials.json')
  const plaintext = `sentinel-${Date.now()}-private`
  try {
    const encryption = new FakeSafeStorage()
    const store = new CredentialStore(filePath, encryption)
    assert.equal((await store.status('OPENAI')).status, 'UNCONFIGURED')
    assert.equal((await store.save('OPENAI', plaintext)).status, 'CONFIGURED')
    assert.equal(await store.read('OPENAI'), plaintext)
    assert.equal((await store.save('SHUAI_API', `${plaintext}-shuai`)).status, 'CONFIGURED')
    assert.equal(await store.read('SHUAI_API'), `${plaintext}-shuai`)

    const raw = await readFile(filePath, 'utf8')
    const parsed = CredentialFileSchema.parse(JSON.parse(raw))
    assert.equal(parsed.version, 1)
    assert.equal(raw.includes(plaintext), false)
    assert.equal(raw.includes(`${plaintext}-shuai`), false)
    assert.equal(
      (await readdir(root)).some((name) => name.endsWith('.tmp')),
      false
    )
    assert.equal((await store.clear('OPENAI')).status, 'UNCONFIGURED')
    assert.equal((await store.clear('SHUAI_API')).status, 'UNCONFIGURED')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('credential failures fail closed and corrupted ciphertext requires re-entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-credential-'))
  const filePath = join(root, 'credentials.json')
  try {
    const encryption = new FakeSafeStorage()
    const store = new CredentialStore(filePath, encryption)
    encryption.available = false
    await assert.rejects(
      () => store.save('AMAP', 'never-written'),
      (error: unknown) => {
        return error instanceof AppError && error.code === 'CRED_UNAVAILABLE'
      }
    )

    encryption.available = true
    await store.save('SHUAI_API', 'temporary-value')
    const file = CredentialFileSchema.parse(JSON.parse(await readFile(filePath, 'utf8')))
    file.entries.SHUAI_API = Buffer.from([0]).toString('base64')
    await writeFile(filePath, JSON.stringify(file), 'utf8')
    await assert.rejects(
      () => store.read('SHUAI_API'),
      (error: unknown) => {
        return error instanceof AppError && error.code === 'CRED_DECRYPT_FAILED'
      }
    )
    assert.equal((await store.status('SHUAI_API')).status, 'REENTRY_REQUIRED')
    assert.equal(
      CredentialFileSchema.parse(JSON.parse(await readFile(filePath, 'utf8'))).entries.SHUAI_API,
      undefined
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('FLYAI credential extends legacy files without plaintext or ordering drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-credential-'))
  const filePath = join(root, 'credentials.json')
  const plaintext = `flyai-sentinel-${Date.now()}-private`
  try {
    await writeFile(
      filePath,
      JSON.stringify({ version: 1, entries: {}, reentryRequired: [] }),
      'utf8'
    )
    const store = new CredentialStore(filePath, new FakeSafeStorage())

    const initial = await store.list()
    assert.equal(initial.at(-1)?.id, 'FLYAI')
    assert.equal(initial.at(-1)?.status, 'UNCONFIGURED')
    assert.equal((await store.save('FLYAI', plaintext)).status, 'CONFIGURED')
    assert.equal(await store.read('FLYAI'), plaintext)

    const raw = await readFile(filePath, 'utf8')
    assert.equal(raw.includes(plaintext), false)
    assert.equal((await store.clear('FLYAI')).status, 'UNCONFIGURED')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
