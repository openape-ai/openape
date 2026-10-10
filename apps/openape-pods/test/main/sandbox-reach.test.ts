// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  expect(lines).toHaveLength(6)
  expect(() => sandboxPolicy({ ...policy, reach: { level: 'owner', protectedPaths: [], persistencePaths } })).toThrow('protected paths')
  expect(() => sandboxPolicy({ ...policy, reach: { level: 'owner', protectedPaths } })).toThrow('protected paths')
})

it('denies writes to the launch, login, shell, SSH, preference and Pods app locations of the owner', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pods-reach-home-'))); roots.push(home)
  const paths = ownerPersistencePaths(home)
  for (const path of ['Library/LaunchAgents', 'Library/Application Support/com.apple.backgroundtaskmanagementagent', 'Library/Preferences', '.zshrc', '.zprofile', '.zshenv', '.zlogin', '.bashrc', '.bash_profile', '.profile', '.config/fish', '.ssh/authorized_keys', '.ssh/config', 'Applications/OpenApe Pods.app', 'Library/Application Support/OpenApe Pods Rollback']) expect(paths).toContain(join(home, path))
  for (const path of ['/Library/LaunchAgents', '/Library/LaunchDaemons', '/Applications/OpenApe Pods.app']) expect(paths).toContain(path)
  expect(paths).not.toContain(join(home, 'Library/Keychains'))
})

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
