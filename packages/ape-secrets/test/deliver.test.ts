import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSigningKey, keyFingerprint, openSigningKey, sealDelivery, signDelivery } from '@openape/secrets-crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Delivery is where a secret becomes plaintext on a machine. These tests pin
// the promises: the vault key is pinned and checked before anything is
// decrypted, files are written safely, and the value reaches only its target.

const home = mkdtempSync(join(tmpdir(), 'ape-secrets-home-'))
process.env.HOME = home

const requests: Array<{ path: string, method: string }> = []
let responses: Record<string, unknown> = {}
vi.mock('../src/client.ts', () => ({
  resolveEndpoint: async () => 'https://secrets.test',
  _request: async (path: string, opts?: { method?: string }) => {
    requests.push({ path, method: opts?.method ?? 'GET' })
    if (!(path in responses)) throw new Error(`unexpected request ${path}`)
    return responses[path]
  },
}))

const { checkPin, openCollected, prepareFileTarget, runWithSecret, PinMismatchError } = await import('../src/deliver.ts')
const { deliverCommand } = await import('../src/commands.ts')
const { generateKeyPair, saveKey } = await import('../src/keys.ts')

const VALUE = 'tg-7731:AAH-secret-marker'

async function scenario(vaultId = 'v1') {
  const vmk = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)))
  const signing = await createSigningKey(vmk, vaultId)
  const machine = await generateKeyPair()
  const fingerprint = await keyFingerprint(machine.publicJwk)
  const context = { vaultId, approvalId: 'a1', consumerKeyFingerprint: fingerprint, secretId: 's1', version: 2 }
  const pkg = await sealDelivery(machine.publicJwk, VALUE, context)
  const signature = await signDelivery(await openSigningKey(vmk, signing, vaultId), pkg, context)
  const collected = {
    approval_id: 'a1',
    mode: 'once' as const,
    expires_at: null,
    vault_id: vaultId,
    consumer_key_fingerprint: fingerprint,
    secret: { id: 's1', version: 2 },
    package: pkg,
    signature,
    vault_signing_key: signing.publicJwk,
  }
  return { machine, collected, fingerprint }
}

function memoryPins(initial: Record<string, string> = {}) {
  const pins = { ...initial }
  return { pins, store: { read: () => ({ ...pins }), write: (next: Record<string, string>) => Object.assign(pins, next) } }
}

const dir = () => mkdtempSync(join(tmpdir(), 'ape-secrets-out-'))

beforeEach(() => {
  requests.length = 0
  responses = {}
})

describe('vault key pinning', () => {
  it('pins on first use and accepts the same key afterwards', () => {
    const { pins, store } = memoryPins()
    expect(checkPin('v1', 'AAAA', store)).toBe('pinned')
    expect(pins).toEqual({ v1: 'AAAA' })
    expect(checkPin('v1', 'AAAA', store)).toBe('match')
  })

  it('refuses a different key and keeps the pinned one', () => {
    const { pins, store } = memoryPins({ v1: 'AAAA' })
    expect(() => checkPin('v1', 'BBBB', store)).toThrow(PinMismatchError)
    expect(pins).toEqual({ v1: 'AAAA' })
  })
})

describe('opening a collected package', () => {
  it('returns the value after the signature checks out', async () => {
    const { machine, collected } = await scenario()
    expect((await openCollected(collected, machine.privateJwk, memoryPins().store)).value).toBe(VALUE)
  })

  it('refuses a package whose signature does not match', async () => {
    const { machine, collected } = await scenario()
    const tampered = { ...collected, package: { ...collected.package, iv: collected.package.iv.replace(/^./, c => (c === 'A' ? 'B' : 'A')) } }
    await expect(openCollected(tampered, machine.privateJwk, memoryPins().store)).rejects.toThrow(/signature/i)
  })

  it('refuses a vault key that differs from the pinned one, before decrypting', async () => {
    const { machine, collected } = await scenario()
    const { store } = memoryPins({ v1: 'F'.repeat(64) })
    await expect(openCollected(collected, machine.privateJwk, store)).rejects.toThrow(PinMismatchError)
  })
})

describe('writing to a file', () => {
  it('creates the file with owner-only permissions', () => {
    const path = join(dir(), 'token')
    prepareFileTarget(path, false).write(VALUE)
    expect(readFileSync(path, 'utf8')).toBe(VALUE)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('refuses an existing file unless overwriting was asked for', () => {
    const path = join(dir(), 'token')
    writeFileSync(path, 'old')
    expect(() => prepareFileTarget(path, false)).toThrow(/exists/)
    prepareFileTarget(path, true).write(VALUE)
    expect(readFileSync(path, 'utf8')).toBe(VALUE)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('refuses a symlink, even when overwriting', () => {
    const d = dir()
    writeFileSync(join(d, 'elsewhere'), 'x')
    chmodSync(join(d, 'elsewhere'), 0o644)
    symlinkSync(join(d, 'elsewhere'), join(d, 'link'))
    expect(() => prepareFileTarget(join(d, 'link'), true)).toThrow(/symlink/i)
    expect(readFileSync(join(d, 'elsewhere'), 'utf8')).toBe('x')
  })
})

describe('handing the value to a command', () => {
  const node = process.execPath

  it('through stdin, without putting it in the command line', async () => {
    const out = join(dir(), 'got')
    const code = await runWithSecret([node, '-e', `require('fs').writeFileSync(${JSON.stringify(out)}, require('fs').readFileSync(0))`], VALUE, { stdin: true })
    expect(code).toBe(0)
    expect(readFileSync(out, 'utf8')).toBe(VALUE)
  })

  it('through one environment variable', async () => {
    const out = join(dir(), 'got')
    const code = await runWithSecret([node, '-e', `require('fs').writeFileSync(${JSON.stringify(out)}, process.env.BOT_TOKEN)`], VALUE, { env: 'BOT_TOKEN' })
    expect(code).toBe(0)
    expect(readFileSync(out, 'utf8')).toBe(VALUE)
  })

  it('reports a command that cannot start without mentioning the value', async () => {
    await expect(runWithSecret(['/nonexistent/command'], VALUE, { stdin: true })).rejects.toThrow(/could not start/)
    await runWithSecret(['/nonexistent/command'], VALUE, { stdin: true }).catch((err: Error) => {
      expect(`${err.message}${err.stack}`).not.toContain(VALUE)
    })
  })
})

describe('the deliver command', () => {
  async function run(args: Record<string, unknown>) {
    let printed = ''
    const write = (chunk: unknown) => {
      printed += String(chunk)
      return true
    }
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(write as never)
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(write as never)
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { printed += `${a.join(' ')}\n` })
    const error = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { printed += `${a.join(' ')}\n` })
    try {
      await (deliverCommand.run as (ctx: { args: Record<string, unknown>, rawArgs: string[] }) => Promise<void>)({ args, rawArgs: [] })
      return { printed, error: null as Error | null }
    }
    catch (e) {
      return { printed, error: e as Error }
    }
    finally {
      out.mockRestore()
      err.mockRestore()
      log.mockRestore()
      error.mockRestore()
    }
  }

  it('fails before collecting when this machine has no key for the approval', async () => {
    const { fingerprint } = await scenario()
    responses['/api/v2/approvals/a1'] = { id: 'a1', status: 'active', mode: 'once', consumer_id: 'unknown-machine', consumer_key_fingerprint: fingerprint }
    const { error } = await run({ id: 'a1', out: join(dir(), 'token'), _: ['a1'] })
    expect(error?.message).toMatch(/No private key/)
    expect(requests.some(r => r.path.endsWith('/collect'))).toBe(false)
  })

  it('writes the value to the file and prints nothing of it', async () => {
    const { machine, collected, fingerprint } = await scenario('vault-cmd')
    saveKey({ consumerId: 'mac-mini', name: 'Mac mini', privateJwk: machine.privateJwk })
    responses['/api/v2/approvals/a1'] = { id: 'a1', status: 'active', mode: 'once', consumer_id: 'mac-mini', consumer_key_fingerprint: fingerprint }
    responses['/api/v2/approvals/a1/collect'] = collected
    const path = join(dir(), 'token')
    const { printed, error } = await run({ id: 'a1', out: path, _: ['a1'] })
    expect(error).toBeNull()
    expect(readFileSync(path, 'utf8')).toBe(VALUE)
    expect(printed).not.toContain(VALUE)
    expect(printed).toMatch(/Pinned the vault key/)
    expect(existsSync(join(home, '.config', 'apes', 'secrets', 'vault-keys.json'))).toBe(true)
    expect(lstatSync(join(home, '.config', 'apes', 'secrets', 'vault-keys.json')).mode & 0o777).toBe(0o600)
  })
})
