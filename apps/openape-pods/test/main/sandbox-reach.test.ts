// @vitest-environment node
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { OwnerSession } from '../../src/main/connections/owner-session'
import type { OwnerSessionTokens } from '../../src/main/connections/owner-session'
import { ownerPersistencePaths, ownerProtectedPaths, sandboxPolicy } from '../../src/worker/runtime/sandbox'

const roots: string[] = []
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const policy = { executable: '/opt/fixture/bin/tool', workspace: '/Users/owner/Library/Application Support/OpenApe Pods/profile/pods/p/workspace', readFiles: ['/opt/fixture/share/roots.pem'], runtimeDirectories: ['/opt/fixture/runtime'], readDirectories: ['/Users/owner/Documents'], writeDirectories: ['/Users/owner/Library/Application Support/OpenApe Pods/profile/credentials/temporary/state'] }
const protectedPaths = ['/Users/owner/Library/Application Support/OpenApe Pods', '/Users/owner/.config/apes', '/Users/owner/Library/Keychains']
const persistencePaths = ['/Users/owner/Library/LaunchAgents', '/Users/owner/.zshrc', '/Library/LaunchDaemons']

it('keeps the isolated profile closed by default and the owner profile open except the protected owner paths', () => {
  expect(sandboxPolicy(policy)).toContain('(deny default)')
  const owner = sandboxPolicy({ ...policy, reach: { level: 'owner', protectedPaths, persistencePaths } })
  const lines = owner.trim().split('\n')
  expect(lines[1]).toBe('(allow default)')
  // The last matching rule wins: protected paths are denied, then only the program's own paths are opened again,
  // and finally writes to the persistence locations and the folders leading to them are denied, even inside an assigned folder.
  expect(lines[2]).toBe(`(deny file-read* file-write* ${protectedPaths.map(path => `(subpath ${JSON.stringify(path)})`).join(' ')})`)
  expect(lines[3]).toBe(`(allow file-read* file-write* (subpath ${JSON.stringify(policy.workspace)}) (subpath ${JSON.stringify(policy.writeDirectories[0])}))`)
  expect(lines[4]).toContain('(literal "/opt/fixture/bin/tool")')
  expect(lines[4]).toContain('(subpath "/opt/fixture/runtime")')
  expect(lines[5]).toBe('(deny file-write* (subpath "/Users/owner/Library/LaunchAgents") (subpath "/Users/owner/.zshrc") (subpath "/Library/LaunchDaemons") (literal "/Users") (literal "/Users/owner") (literal "/Users/owner/Library") (literal "/Library"))')
  // Seatbelt checks a Unix socket connection as network access, so the sockets under the protected paths are closed separately.
  expect(lines[6]).toBe(`(deny network-outbound ${protectedPaths.map(path => `(remote unix-socket (subpath ${JSON.stringify(path)}))`).join(' ')})`)
  expect(lines[7]).toContain('(global-name "com.apple.xpc.smd")')
  expect(lines[8]).toBe('(deny job-creation)')
  expect(lines).toHaveLength(9)
  expect(() => sandboxPolicy({ ...policy, reach: { level: 'owner', protectedPaths: [], persistencePaths } })).toThrow('protected paths')
  expect(() => sandboxPolicy({ ...policy, reach: { level: 'owner', protectedPaths } })).toThrow('protected paths')
})

const ownerConfiguration = ['.codex', '.claude', '.claude.json', '.ssh', '.gitconfig', '.config/git', '.npmrc', '.config/fish', '.local/bin', 'Library/pnpm', 'Library/Pnpm', '.zsh_shared']

it('denies writes to the launch, login, shell, SSH, Git, agent, PATH, preference and Pods app locations of the owner', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pods-reach-home-'))); roots.push(home)
  const paths = ownerPersistencePaths(home, { CODEX_HOME: '/Users/owner/codex-home', CLAUDE_CONFIG_DIR: '/Users/owner/claude-home/' })
  for (const path of ['Library/LaunchAgents', 'Library/Application Support/com.apple.backgroundtaskmanagementagent', 'Library/Preferences', '.zshrc', '.zprofile', '.zshenv', '.zlogin', '.bashrc', '.bash_profile', '.profile', 'Applications/OpenApe Pods.app', 'Library/Application Support/OpenApe Pods Rollback', ...ownerConfiguration]) expect(paths).toContain(join(home, path))
  for (const path of ['/Library/LaunchAgents', '/Library/LaunchDaemons', '/Applications/OpenApe Pods.app', '/opt/homebrew', '/usr/local', '/Users/owner/codex-home', '/Users/owner/claude-home']) expect(paths).toContain(path)
  expect(paths).not.toContain(join(home, 'Library/Keychains'))
})

it('lists every location both as written and as resolved through links', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pods-reach-forms-'))); roots.push(root)
  const real = join(root, 'real'); const home = join(root, 'home'); const dotfiles = join(root, 'dotfiles/claude')
  mkdirSync(real); mkdirSync(dotfiles, { recursive: true }); symlinkSync(real, home); symlinkSync(dotfiles, join(real, '.claude'))
  const paths = ownerPersistencePaths(home)
  for (const path of [join(home, '.claude'), join(real, '.claude'), dotfiles, join(home, '.codex'), join(real, '.codex')]) expect(paths).toContain(path)
  const profile = join(real, 'profile'); mkdirSync(join(real, '.config/apes'), { recursive: true }); mkdirSync(profile)
  expect(ownerProtectedPaths(join(home, 'profile'), home)).toEqual(expect.arrayContaining([join(home, 'profile'), profile, join(home, '.config/apes'), join(real, '.config/apes')]))
})

/** Runs a command under a sandbox profile and returns its exit code and output; asynchronous so a socket server in this process can answer. */
function sandboxed(profile: string, command: string[]): Promise<{ code: number, output: string }> {
  return new Promise((resolve) => {
    execFile('/usr/bin/sandbox-exec', ['-f', profile, ...command], { encoding: 'utf8', timeout: 20000 }, (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, output: `${stdout}${stderr}` }))
  })
}

it.runIf(process.platform === 'darwin')('blocks writes to persistence locations, as written and through a linked home, and the Pods sockets under the real macOS sandbox', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pr-'))); roots.push(root)
  const real = join(root, 'real'); const home = join(root, 'home'); const workspace = join(root, 'w'); const profileRoot = join(root, 'p')
  for (const path of ['.codex', '.ssh', '.config/git', '.local/bin', 'Library/pnpm', '.zsh_shared', 'notes']) mkdirSync(join(real, path), { recursive: true })
  mkdirSync(join(root, 'dotfiles/claude'), { recursive: true }); symlinkSync(join(root, 'dotfiles/claude'), join(real, '.claude'))
  mkdirSync(join(profileRoot, 'codex'), { recursive: true }); mkdirSync(workspace); symlinkSync(real, home)
  const reach = { level: 'owner' as const, protectedPaths: ownerProtectedPaths(profileRoot, home), persistencePaths: ownerPersistencePaths(home, { CODEX_HOME: join(root, 'codex-home') }) }
  const owner = join(root, 'owner.sb'); writeFileSync(owner, sandboxPolicy({ executable: '/bin/sh', workspace, readFiles: [], runtimeDirectories: [], reach }))
  const isolated = join(root, 'isolated.sb'); writeFileSync(isolated, sandboxPolicy({ executable: process.execPath, workspace, readFiles: [], runtimeDirectories: [] }))

  const targets = ['.codex/config.toml', '.claude/settings.json', '.claude.json', '.ssh/id_planted', '.gitconfig', '.config/git/config', '.npmrc', '.local/bin/tool', 'Library/pnpm/tool', '.zsh_shared/planted.zsh']
  for (const base of [home, real]) {
    for (const target of targets) expect((await sandboxed(owner, ['/bin/sh', '-c', 'echo planted > "$1"', '-', join(base, target)])).code, join(base, target)).not.toBe(0)
  }
  expect((await sandboxed(owner, ['/bin/sh', '-c', 'echo planted > "$1"', '-', join(root, 'codex-home/config.toml')])).code).not.toBe(0)
  // The link itself cannot be replaced by a folder the run controls.
  expect((await sandboxed(owner, ['/bin/rm', join(real, '.claude')])).code).not.toBe(0)
  expect(existsSync(join(real, '.claude/'))).toBe(true)
  // The rest of the owner's home and ordinary programs keep working.
  expect(await sandboxed(owner, ['/bin/sh', '-c', 'echo note > "$1" && cat "$1"', '-', join(home, 'notes/today.txt')])).toEqual({ code: 0, output: 'note\n' })
  expect((await sandboxed(owner, ['/usr/bin/git', '--version'])).code).toBe(0)
  expect(await sandboxed(owner, [process.execPath, '-p', '1 + 1'])).toEqual({ code: 0, output: '2\n' })

  const socket = join(profileRoot, 'codex/control.sock')
  const server = createServer(connection => connection.end('owner-session\n'))
  await new Promise<void>(resolve => server.listen(socket, resolve))
  try {
    const client = 'const s=require("net").connect(process.argv[1]);s.on("data",d=>{console.log("CONNECTED");process.exit(0)});s.on("error",e=>{console.log("REFUSED "+e.code);process.exit(0)})'
    expect((await sandboxed(owner, [process.execPath, '-e', client, socket])).output).toBe('REFUSED EPERM\n')
    expect((await sandboxed(isolated, [process.execPath, '-e', client, socket])).output).toBe('REFUSED EPERM\n')
    const open = join(root, 'open.sb'); writeFileSync(open, '(version 1)\n(allow default)\n')
    expect((await sandboxed(open, [process.execPath, '-e', client, socket])).output).toBe('CONNECTED\n')
  }
  finally { server.close() }
}, 60000)

it('protects the Pods profile, the base of all profiles, the apes login and the keychains', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pods-reach-home-'))); roots.push(home)
  const base = join(home, 'Library/Application Support/OpenApe Pods'); const profile = join(base, 'profile-1')
  mkdirSync(profile, { recursive: true }); mkdirSync(join(home, '.config/apes'), { recursive: true })
  expect(ownerProtectedPaths(profile, home)).toEqual([profile, join(home, '.config/apes'), join(home, 'Library/Keychains')])
  writeFileSync(join(base, 'selected-profile.json'), '{}')
  expect(ownerProtectedPaths(profile, home)).toEqual([profile, base, join(home, '.config/apes'), join(home, 'Library/Keychains')])
})

function tokens(overrides: Partial<OwnerSessionTokens> = {}): OwnerSessionTokens {
  return { issuer: 'https://id.example.test', account: 'owner@example.test', subject: 'owner@example.test', accessToken: 'ACCESS', refreshToken: 'REFRESH', expiresAt: Math.floor(Date.now() / 1000) + 300, ...overrides }
}

it('closes the session at its end by timer and revokes its refresh token without a further call', async () => {
  vi.useFakeTimers()
  const revoked: string[] = []
  const session = new OwnerSession(tokens(), Date.now() + 3600000, { refresh: async () => tokens(), revoke: async (current) => { revoked.push(current.refreshToken) } })
  expect(session.active).toBe(true)
  await vi.advanceTimersByTimeAsync(3600000)
  expect(revoked).toEqual(['REFRESH'])
  expect(session.active).toBe(false)
  await expect(session.bearer(new AbortController().signal)).rejects.toThrow('owner session ended')
})

it('revokes a renewal that races with the close and both tokens when the renewed identity differs', async () => {
  const revoked: string[] = []
  let finish: (value: OwnerSessionTokens) => void = () => {}
  const racing = new OwnerSession(tokens({ expiresAt: 0 }), Date.now() + 3600000, { refresh: () => new Promise((resolve) => { finish = resolve }), revoke: async (current) => { revoked.push(current.refreshToken) } })
  const pending = racing.bearer(new AbortController().signal)
  const closed = racing.close()
  finish(tokens({ refreshToken: 'RENEWED' }))
  await closed; await expect(pending).rejects.toThrow('owner session ended')
  expect([...new Set(revoked)].sort()).toEqual(['REFRESH', 'RENEWED'])
  revoked.length = 0
  const changed = new OwnerSession(tokens({ expiresAt: 0 }), Date.now() + 3600000, { refresh: async () => tokens({ subject: 'someone@example.test', refreshToken: 'FOREIGN' }), revoke: async (current) => { revoked.push(current.refreshToken) } })
  await expect(changed.bearer(new AbortController().signal)).rejects.toThrow('differs')
  expect(revoked.sort()).toEqual(['FOREIGN', 'REFRESH'])
  expect(changed.active).toBe(false)
})
