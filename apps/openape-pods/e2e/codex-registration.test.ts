import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { CodexRegistration } from '../src/main/codex/registration'

// Issue 1375: registration against the bundled Codex CLI with a throwaway
// CODEX_HOME. The owner's configuration is only ever appended to, and only the
// bytes the app wrote are removed again.
let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })
const owner = '# Owner settings\nmodel = "gpt-5.1" # inline\n\n[profiles.work]\nmodel = "o3"\n\n# my other server\n[mcp_servers.other]\ncommand = "/usr/bin/true"\nargs = ["--x"]'
async function fixture(config: string | null) {
  root = await mkdtemp(join(tmpdir(), 'pods-codex-registration-'))
  const home = join(root, 'codex-home'); await mkdir(home)
  if (config !== null) await writeFile(join(home, 'config.toml'), config)
  const manifest = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8')) as { binaryHash: string }
  const registration = new CodexRegistration({ binary: resolve('dist/vendor/codex'), binaryHash: manifest.binaryHash }, home, join(root, 'app', 'codex'), { executable: '/Applications/OpenApe Pods.app/Contents/MacOS/OpenApe Pods', script: '/x/codex-mcp.mjs', socket: '/x/control.sock' })
  const config_ = () => readFile(join(home, 'config.toml'), 'utf8')
  return { home, registration, config: config_ }
}

it('appends one entry Codex reads and removes exactly it again, keeping comments and a missing trailing newline', async () => {
  const { registration, config } = await fixture(owner)
  expect((await registration.status()).state).toBe('disconnected')
  expect((await registration.connect()).state).toBe('connected')
  const connected = await config()
  expect(connected.startsWith(owner)).toBe(true); expect(connected).toContain('tool_timeout_sec = 180')
  expect((await stat(registration.launcher)).mode & 0o777).toBe(0o700)
  expect((await registration.connect()).state).toBe('connected'); expect(await config()).toBe(connected)
  expect((await registration.disconnect()).state).toBe('disconnected')
  expect(await config()).toBe(owner)
  await expect(stat(registration.launcher)).rejects.toThrow('ENOENT')
})

it('creates the configuration for an owner who never configured Codex and removes it cleanly', async () => {
  const { registration, config } = await fixture(null)
  expect((await registration.connect()).state).toBe('connected')
  expect(await config()).toContain('[mcp_servers.openape-pods]')
  expect((await registration.disconnect()).state).toBe('disconnected')
  await expect(config()).rejects.toThrow('ENOENT')
})

it('never changes a foreign entry of the same name or a configuration it cannot read', async () => {
  const foreign = `${owner}\n\n[mcp_servers.openape-pods]\ncommand = "/bin/echo"\n`
  const first = await fixture(foreign)
  expect((await first.registration.connect()).state).toBe('foreign')
  expect(await first.config()).toBe(foreign)
  await expect(stat(first.registration.launcher)).rejects.toThrow('ENOENT')
  await rm(root, { recursive: true, force: true })
  const broken = '[mcp_servers.other\ncommand = '
  const second = await fixture(broken)
  await expect(second.registration.connect()).rejects.toThrow('could not be read')
  expect(await second.config()).toBe(broken)
})

it('leaves an entry the owner edited in place and names the manual removal', async () => {
  const { registration, config } = await fixture(owner)
  await registration.connect()
  const edited = (await config()).replace('tool_timeout_sec = 180', 'tool_timeout_sec = 600')
  await writeFile(join(root, 'codex-home', 'config.toml'), edited)
  expect(await registration.disconnect()).toMatchObject({ state: 'edited', manual: 'codex mcp remove openape-pods' })
  expect(await config()).toBe(edited)
  expect((await stat(registration.launcher)).isFile()).toBe(true)
})
