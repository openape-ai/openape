import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { expect, it } from 'vitest'
import { CredentialCache } from '../../src/main/connections/cache'

it('encrypts named pod credentials, returns only the bound value and deletes only the owning pod record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-secret-cache-')); const key = randomBytes(32)
  const cipher = { available: () => true, encrypt: (value: string) => { const iv = randomBytes(12); const encrypt = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, encrypt.update(value), encrypt.final(), encrypt.getAuthTag()]) }, decrypt: (value: Buffer) => { const decrypt = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decrypt.setAuthTag(value.subarray(-16)); return Buffer.concat([decrypt.update(value.subarray(12, -16)), decrypt.final()]).toString() } }
  try {
    const one = randomUUID(); const two = randomUUID(); const cache = new CredentialCache(root, cipher)
    const id = await cache.createScriptSecret(one, 'crm', 'synthetic-private-one')
    const other = await cache.createScriptSecret(two, 'crm', 'synthetic-private-two')
    expect((await readFile(join(root, `${id}.encrypted`))).includes('synthetic-private-one')).toBe(false)
    const reopened = new CredentialCache(root, cipher)
    expect(await reopened.readScriptSecret(id, one, 'crm')).toBe('synthetic-private-one')
    await expect(reopened.readScriptSecret(id, two, 'crm')).rejects.toThrow('another pod')
    await expect(reopened.readScriptSecret(id, one, 'other')).rejects.toThrow('alias')
    await expect(reopened.erasePodKey(id, two)).rejects.toThrow('foreign')
    await reopened.erasePodKey(id, one); expect(await readdir(root)).not.toContain(`${id}.encrypted`)
    expect(await reopened.readScriptSecret(other, two, 'crm')).toBe('synthetic-private-two')
    const orphan = await cache.createScriptSecret(one, 'orphan', 'synthetic-orphan')
    await reopened.reconcileScriptSecrets([{ id: other, podId: two }])
    expect(await readdir(root)).not.toContain(`${orphan}.encrypted`)
    expect(await reopened.readScriptSecret(other, two, 'crm')).toBe('synthetic-private-two')
    const oauth = randomUUID(); await cache.create(oauth, JSON.stringify({ access_token: 'synthetic-provider-token' }))
    await expect(reopened.readScriptSecret(oauth, one, 'crm')).rejects.toThrow('another pod')
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
