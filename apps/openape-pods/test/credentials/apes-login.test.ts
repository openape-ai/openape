// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { apesLogin } from '../../src/main/connections/apes-login'

// Reads the owner's apes login the way Pods does in production, against a temporary
// home and a stub apes CLI only: the developer's own apes login is never read or written.
let home = ''; let tools = ''; let stubs = 0
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pods-apes-home-')); tools = await mkdtemp(join(tmpdir(), 'pods-apes-stub-'))
  await mkdir(join(home, '.config', 'apes'), { recursive: true })
})
afterEach(async () => { await rm(home, { recursive: true, force: true }); await rm(tools, { recursive: true, force: true }) })
const now = () => Math.floor(Date.now() / 1000)
const directory = () => join(home, '.config', 'apes')
const store = (value: unknown) => writeFile(join(directory(), 'auth.json'), typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 })
const signal = () => new AbortController().signal
// Names, sizes, modification times and contents: any write by Pods shows up here.
async function snapshot(): Promise<string> {
  const names = (await readdir(directory())).sort()
  return JSON.stringify(await Promise.all(names.map(async name => [name, (await stat(join(directory(), name))).mtimeMs, await readFile(join(directory(), name), 'utf8')])))
}
// A stub apes CLI: records how it was started, then runs `body` as apes would.
async function stub(body: string) {
  stubs += 1; const script = join(tools, `apes-${stubs}.mjs`); const log = join(tools, `calls-${stubs}.json`)
  await writeFile(script, `import { appendFileSync, writeFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), home: process.env.HOME, keys: Object.keys(process.env).sort() }) + '\\n')\n${body}\n`)
  return { login: apesLogin({ executable: process.execPath, script }, home), calls: async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line) as { argv: string[], home: string, keys: string[] }) }
}

it('reads a fresh apes token without running apes or writing anything, and sees apes logout', async () => {
  const { login, calls } = await stub('process.exit(1)')
  await store({ idp: 'https://identity.example.invalid', access_token: 'current', refresh_token: 'refresh', email: 'Owner@Example.invalid', expires_at: now() + 600 })
  const before = await snapshot()
  expect(await login.token(signal())).toEqual({ issuer: 'https://identity.example.invalid', accessToken: 'current' })
  expect(login.signedIn('https://identity.example.invalid', 'owner@example.invalid')).toBe(true)
  expect(login.signedIn('https://identity.example.invalid', 'foreign@example.invalid')).toBe(false)
  expect(login.signedIn('https://foreign.example.invalid', 'owner@example.invalid')).toBe(false)
  expect(await snapshot()).toBe(before)
  // `apes logout` leaves an empty auth.json.
  await store('')
  expect(await login.token(signal())).toBeNull()
  expect(login.signedIn('https://identity.example.invalid', 'owner@example.invalid')).toBe(false)
  expect(await calls()).toEqual([])
})

it('never renews an expired login with a refresh token and leaves it untouched', async () => {
  const { login, calls } = await stub('process.exit(0)')
  await store({ idp: 'https://identity.example.invalid', access_token: 'expired', refresh_token: 'refresh', email: 'owner@example.invalid', expires_at: now() + 30 })
  const before = await snapshot()
  await expect(login.token(signal())).rejects.toThrow('does not renew an apes login with a refresh token')
  expect(await snapshot()).toBe(before)
  expect(await calls()).toEqual([])
})

it('lets the apes CLI renew an expired key login, then reads the renewed token, and refuses when apes cannot renew', async () => {
  const renewed = { idp: 'https://identity.example.invalid', access_token: 'renewed-by-apes', email: 'owner@example.invalid', key_path: '/keys/owner', expires_at: now() + 3600 }
  const renewing = await stub(`writeFileSync(process.env.HOME + '/.config/apes/auth.json', ${JSON.stringify(JSON.stringify(renewed))})`)
  await store({ ...renewed, access_token: 'expired', expires_at: now() - 10 })
  expect(await renewing.login.token(signal())).toEqual({ issuer: 'https://identity.example.invalid', accessToken: 'renewed-by-apes' })
  // apes runs once, as `whoami`, with only the owner's home, a fixed PATH and the Electron node switch.
  expect(await renewing.calls()).toEqual([{ argv: ['whoami'], home, keys: expect.arrayContaining(['ELECTRON_RUN_AS_NODE', 'HOME', 'PATH']) }])
  expect((await renewing.calls())[0]!.keys.filter(key => !['ELECTRON_RUN_AS_NODE', 'HOME', 'PATH', '__CF_USER_TEXT_ENCODING'].includes(key))).toEqual([])
  // A failing or silent apes leaves the login exactly as it was and opens nothing.
  for (const body of ['process.exit(1)', 'process.exit(0)']) {
    const { login } = await stub(body)
    await store({ ...renewed, access_token: 'expired', expires_at: now() - 10 })
    const before = await snapshot()
    await expect(login.token(signal())).rejects.toThrow('could not renew')
    expect(await snapshot()).toBe(before)
  }
  // A hanging apes is stopped with the caller's signal.
  const hanging = await stub('setInterval(() => {}, 1000)')
  const stop = new AbortController(); const pending = hanging.login.token(stop.signal)
  await expect.poll(async () => (await hanging.calls()).length).toBe(1)
  stop.abort(); await expect(pending).rejects.toThrow('could not renew')
})
