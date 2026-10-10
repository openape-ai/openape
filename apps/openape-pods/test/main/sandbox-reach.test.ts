// @vitest-environment node
import { execFile, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { OwnerSession } from '../../src/main/connections/owner-session'
import type { OwnerSessionTokens } from '../../src/main/connections/owner-session'
import { deniedPaths, ownerProtectedPaths, sandboxPolicy } from '../../src/worker/runtime/sandbox'

const roots: string[] = []
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const policy = { executable: '/opt/fixture/bin/tool', workspace: '/Users/owner/Library/Application Support/OpenApe Pods/profile/pods/p/workspace', readFiles: ['/opt/fixture/share/roots.pem'], runtimeDirectories: ['/opt/fixture/runtime'], readDirectories: ['/Users/owner/Documents'], writeDirectories: ['/Users/owner/Library/Application Support/OpenApe Pods/profile/credentials/temporary/state'] }
const protectedPaths = ['/Users/owner/Library/Application Support/OpenApe Pods', '/Users/owner/.config/apes']
const subpaths = (paths: string[]) => paths.map(path => `(subpath ${JSON.stringify(path)})`).join(' ')

it('gives the owner level the owner reach except the protected paths and the configured denylist', () => {
  expect(sandboxPolicy(policy)).toContain('(deny default)')
  const deny = ['/Users/owner/.ssh']
  const owner = sandboxPolicy({ ...policy, reach: { level: 'owner', protectedPaths, deny } })
  const lines = owner.trim().split('\n')
  expect(lines[1]).toBe('(allow default)')
  // The last matching rule wins: protected paths are denied, then only the program's own paths are opened again,
  // the folders leading to protected and denied paths stay unwritable, and the denylist closes even an assigned folder.
  expect(lines[2]).toBe(`(deny file-read* file-write* ${subpaths(protectedPaths)})`)
  expect(lines[3]).toBe(`(allow file-read* file-write* ${subpaths([policy.workspace, policy.writeDirectories[0]!])})`)
  expect(lines[4]).toContain('(literal "/opt/fixture/bin/tool")')
  expect(lines[4]).toContain('(subpath "/opt/fixture/runtime")')
  expect(lines[5]).toBe('(deny file-write* (literal "/Users") (literal "/Users/owner") (literal "/Users/owner/Library") (literal "/Users/owner/Library/Application Support") (literal "/Users/owner/.config"))')
  // Seatbelt checks a Unix socket connection as network access, so the sockets under these paths are closed separately.
  expect(lines[6]).toBe(`(deny network-outbound ${[...protectedPaths, ...deny].map(path => `(remote unix-socket (subpath ${JSON.stringify(path)}))`).join(' ')})`)
  expect(lines[7]).toBe(`(deny file-read* file-write* ${subpaths(deny)})`)
  expect(lines).toHaveLength(8)
  // No curated persistence list: launch agents, preferences, keychains and login item services stay the owner's.
  for (const removed of ['LaunchAgents', 'Keychains', 'Preferences', 'mach-lookup', 'job-creation', 'user-preference-write']) expect(owner).not.toContain(removed)
  expect(sandboxPolicy({ ...policy, reach: { level: 'owner', protectedPaths } }).trim().split('\n')).toHaveLength(7)
  expect(() => sandboxPolicy({ ...policy, reach: { level: 'owner', protectedPaths: [] } })).toThrow('protected paths')
})

it('closes the denylist and the folders leading to it last at the isolated level, so not even the workspace reopens it', () => {
  const deny = ['/w/sub/private']
  const lines = sandboxPolicy({ ...policy, workspace: '/w', reach: { level: 'isolated', protectedPaths: [], deny } }).trim().split('\n')
  expect(lines[0]).toBe('(version 1)')
  expect(lines[1]).toBe('(deny default)')
  expect(lines.at(-2)).toBe('(deny file-write* (literal "/w") (literal "/w/sub"))')
  expect(lines.at(-1)).toBe(`(deny file-read* file-write* ${subpaths(deny)})`)
  expect(sandboxPolicy(policy)).not.toContain('(deny file-read*')
})

it('resolves denied paths below the owner home and through links, and always protects the Pods base, profile and apes login', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pods-reach-forms-'))); roots.push(root)
  const real = join(root, 'real'); const home = join(root, 'home'); const vault = join(root, 'vault')
  mkdirSync(real); mkdirSync(vault); symlinkSync(real, home); symlinkSync(vault, join(real, 'notes'))
  expect(deniedPaths(['~/notes', '/srv/data'], home)).toEqual([join(home, 'notes'), vault, '/srv/data'])
  const base = join(real, 'base'); const profile = join(base, 'profiles/a'); mkdirSync(join(real, '.config/apes'), { recursive: true }); mkdirSync(profile, { recursive: true })
  expect(ownerProtectedPaths(join(home, 'base/profiles/a'), join(home, 'base'), home)).toEqual([join(home, 'base'), base, join(home, 'base/profiles/a'), profile, join(home, '.config/apes'), join(real, '.config/apes')])
  expect(ownerProtectedPaths(base, base, real)).toEqual([base, join(real, '.config/apes')])
})

/** Runs a command under a sandbox profile and returns its exit code and output; asynchronous so a socket server in this process can answer. */
function sandboxed(profile: string, command: string[]): Promise<{ code: number, output: string }> {
  return new Promise((resolve) => {
    execFile('/usr/bin/sandbox-exec', ['-f', profile, ...command], { encoding: 'utf8', timeout: 20000 }, (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, output: `${stdout}${stderr}` }))
  })
}
const write = (profile: string, path: string) => sandboxed(profile, ['/bin/sh', '-c', 'echo planted > "$1"', '-', path])

it.runIf(process.platform === 'darwin')('lets the owner level write SSH and launch agent files but never the Pods data, the apes login or a denied path under the real macOS sandbox', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pr-'))); roots.push(root)
  const real = join(root, 'real'); const home = join(root, 'home'); const workspace = join(root, 'w')
  // The real layout: the base holds the profile selection, the MCP control socket and every profile; it is reached through a link here.
  const base = join(root, 'b'); const linkedBase = join(root, 'base'); const profileRoot = join(base, 'profiles/0b7c3b8e-5f8e-4a51-9b3c-2f1d6c7a9e10')
  for (const path of ['.ssh', 'Library/LaunchAgents', '.config/apes', 'private', 'notes', 'projects/secret', 'other']) mkdirSync(join(real, path), { recursive: true })
  writeFileSync(join(real, '.config/apes/auth.json'), '{}'); writeFileSync(join(real, 'private/secret.txt'), 'secret'); writeFileSync(join(real, 'projects/secret/key.txt'), 'secret')
  mkdirSync(profileRoot, { recursive: true }); mkdirSync(join(base, 'codex')); writeFileSync(join(base, 'selected-profile.json'), '{}')
  mkdirSync(join(workspace, 'sub/closed'), { recursive: true }); writeFileSync(join(workspace, 'sub/closed/key.txt'), 'secret'); mkdirSync(join(workspace, 'other'))
  symlinkSync(real, home); symlinkSync(base, linkedBase)
  const reach = { level: 'owner' as const, protectedPaths: ownerProtectedPaths(profileRoot, linkedBase, home), deny: deniedPaths(['~/private', '~/projects/secret'], home) }
  // The denied folders are also inside folders assigned for writing: the denylist wins over the assignment.
  const owner = join(root, 'owner.sb'); writeFileSync(owner, sandboxPolicy({ executable: '/bin/sh', workspace, readFiles: [], runtimeDirectories: [], writeDirectories: [join(real, 'private'), join(real, 'projects')], reach }))
  const isolated = join(root, 'isolated.sb'); writeFileSync(isolated, sandboxPolicy({ executable: process.execPath, workspace, readFiles: [], runtimeDirectories: [], reach: { level: 'isolated', protectedPaths: [], deny: deniedPaths([join(workspace, 'sub/closed')], home) } }))

  for (const base of [home, real]) {
    for (const target of ['.ssh/x', 'Library/LaunchAgents/ai.openape.pods-test.plist']) {
      expect((await write(owner, join(base, target))).code, join(base, target)).toBe(0)
      expect(readFileSync(join(real, target), 'utf8')).toBe('planted\n')
      rmSync(join(real, target))
    }
    expect((await sandboxed(owner, ['/bin/cat', join(base, '.config/apes/auth.json')])).code).not.toBe(0)
    expect((await write(owner, join(base, '.config/apes/planted.json'))).code).not.toBe(0)
    expect((await sandboxed(owner, ['/bin/cat', join(base, 'private/secret.txt')])).code).not.toBe(0)
    expect((await write(owner, join(base, 'private/planted.txt'))).code).not.toBe(0)
  }
  expect(existsSync(join(real, 'private/planted.txt'))).toBe(false)
  // The folders leading to the apes login and to a denied path cannot be moved aside.
  expect((await sandboxed(owner, ['/bin/mv', join(real, '.config'), join(real, 'moved')])).code).not.toBe(0)
  expect((await sandboxed(owner, ['/bin/mv', join(real, 'private'), join(real, 'moved')])).code).not.toBe(0)
  // Renaming the parent of a denied path inside a writable folder would expose it under a new name; it stays refused.
  for (const parent of [join(home, 'projects'), join(real, 'projects')]) expect((await sandboxed(owner, ['/bin/mv', parent, join(real, 'moved')])).code, parent).not.toBe(0)
  expect((await sandboxed(owner, ['/bin/cat', join(real, 'projects/secret/key.txt')])).code).not.toBe(0)
  expect((await sandboxed(owner, ['/bin/mv', join(real, 'other'), join(real, 'other-renamed')])).code).toBe(0)
  for (const path of [join(base, 'selected-profile.json'), join(linkedBase, 'selected-profile.json')]) {
    expect((await sandboxed(owner, ['/bin/cat', path])).code, path).not.toBe(0)
    expect((await write(owner, `${path}.planted`)).code, path).not.toBe(0)
  }
  expect((await sandboxed(owner, ['/bin/mv', linkedBase, join(root, 'moved')])).code).not.toBe(0)
  // The rest of the owner's home and ordinary programs keep working.
  expect(await sandboxed(owner, ['/bin/sh', '-c', 'echo note > "$1" && cat "$1"', '-', join(home, 'notes/today.txt')])).toEqual({ code: 0, output: 'note\n' })
  expect((await sandboxed(owner, ['/usr/bin/git', '--version'])).code).toBe(0)
  expect(await sandboxed(owner, [process.execPath, '-p', '1 + 1'])).toEqual({ code: 0, output: '2\n' })
  // The isolated level is unchanged: nothing outside its workspace, and a denied folder inside it stays closed.
  const nodeWrite = (path: string) => sandboxed(isolated, [process.execPath, '-e', 'try{require("fs").writeFileSync(process.argv[1],"ok");console.log("written")}catch(e){console.log(e.code)}', path])
  expect(await nodeWrite(join(workspace, 'open.txt'))).toEqual({ code: 0, output: 'written\n' })
  expect(await nodeWrite(join(workspace, 'sub/closed/planted.txt'))).toEqual({ code: 0, output: 'EPERM\n' })
  expect(await nodeWrite(join(real, '.ssh/x'))).toEqual({ code: 0, output: 'EPERM\n' })
  // Renaming the parent of the denied folder inside the writable workspace is refused, so it never reappears readable.
  const rename = (from: string, to: string) => sandboxed(isolated, [process.execPath, '-e', 'try{require("fs").renameSync(process.argv[1],process.argv[2]);console.log("renamed")}catch(e){console.log(e.code)}', from, to])
  expect(await rename(join(workspace, 'sub'), join(workspace, 'moved'))).toEqual({ code: 0, output: 'EPERM\n' })
  expect(existsSync(join(workspace, 'moved'))).toBe(false)
  expect(await sandboxed(isolated, [process.execPath, '-e', 'try{console.log(require("fs").readFileSync(process.argv[1],"utf8"))}catch(e){console.log(e.code)}', join(workspace, 'sub/closed/key.txt')])).toEqual({ code: 0, output: 'EPERM\n' })
  expect(await rename(join(workspace, 'other'), join(workspace, 'other-renamed'))).toEqual({ code: 0, output: 'renamed\n' })

  const socket = join(base, 'codex/control.sock')
  const server = createServer(connection => connection.end('owner-session\n'))
  await new Promise<void>(resolve => server.listen(socket, resolve))
  try {
    const client = 'const s=require("net").connect(process.argv[1]);s.on("data",d=>{console.log("CONNECTED");process.exit(0)});s.on("error",e=>{console.log("REFUSED "+e.code);process.exit(0)})'
    for (const path of [socket, join(linkedBase, 'codex/control.sock')]) {
      expect((await sandboxed(owner, [process.execPath, '-e', client, path])).output, path).toBe('REFUSED EPERM\n')
      expect((await sandboxed(isolated, [process.execPath, '-e', client, path])).output, path).toBe('REFUSED EPERM\n')
    }
    const open = join(root, 'open.sb'); writeFileSync(open, '(version 1)\n(allow default)\n')
    expect((await sandboxed(open, [process.execPath, '-e', client, socket])).output).toBe('CONNECTED\n')
  }
  finally { server.close() }
}, 60000)

// cfprefsd writes named preference domains into the real ~/Library/Preferences whatever HOME says, so only the actual home
// shows whether `defaults write` works. Only a random test domain is written, and it is removed again.
it.runIf(process.platform === 'darwin')('lets the owner level write preferences through cfprefsd under the real macOS sandbox', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pods-reach-defaults-'))); roots.push(root)
  const workspace = join(root, 'w'); mkdirSync(workspace)
  const reach = { level: 'owner' as const, protectedPaths: ownerProtectedPaths(join(root, 'p/profiles/a'), join(root, 'p'), userInfo().homedir) }
  const owner = join(root, 'owner.sb'); writeFileSync(owner, sandboxPolicy({ executable: '/bin/sh', workspace, readFiles: [], runtimeDirectories: [], reach }))
  const domain = `ai.openape.pods-test-${randomUUID()}`
  try { expect((await sandboxed(owner, ['/usr/bin/defaults', 'write', domain, 'planted', 'value'])).code).toBe(0) }
  finally {
    spawnSync('/usr/bin/defaults', ['delete', domain])
    rmSync(join(userInfo().homedir, 'Library/Preferences', `${domain}.plist`), { force: true })
  }
}, 60000)

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
