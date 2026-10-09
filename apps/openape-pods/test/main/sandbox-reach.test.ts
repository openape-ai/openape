// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { OwnerSession } from '../../src/main/connections/owner-session'
import type { OwnerSessionTokens } from '../../src/main/connections/owner-session'
import { ownerProtectedPaths, sandboxPolicy } from '../../src/worker/runtime/sandbox'

const roots: string[] = []
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const policy = { executable: '/opt/fixture/bin/tool', workspace: '/Users/owner/Library/Application Support/OpenApe Pods/profile/pods/p/workspace', readFiles: ['/opt/fixture/share/roots.pem'], runtimeDirectories: ['/opt/fixture/runtime'], readDirectories: ['/Users/owner/Documents'], writeDirectories: ['/Users/owner/Library/Application Support/OpenApe Pods/profile/credentials/temporary/state'] }
const protectedPaths = ['/Users/owner/Library/Application Support/OpenApe Pods', '/Users/owner/.config/apes', '/Users/owner/Library/Keychains']

it('keeps the isolated profile closed by default and the owner profile open except the protected owner paths', () => {
  expect(sandboxPolicy(policy)).toContain('(deny default)')
  const owner = sandboxPolicy({ ...policy, reach: { level: 'owner', protectedPaths } })
  const lines = owner.trim().split('\n')
  expect(lines[1]).toBe('(allow default)')
  // The last matching rule wins: protected paths are denied, then only the program's own paths are opened again.
  expect(lines[2]).toBe(`(deny file-read* file-write* ${protectedPaths.map(path => `(subpath ${JSON.stringify(path)})`).join(' ')})`)
  expect(lines[3]).toBe(`(allow file-read* file-write* (subpath ${JSON.stringify(policy.workspace)}) (subpath ${JSON.stringify(policy.writeDirectories[0])}))`)
  expect(lines[4]).toContain('(literal "/opt/fixture/bin/tool")')
  expect(lines[4]).toContain('(subpath "/opt/fixture/runtime")')
  expect(lines).toHaveLength(5)
  expect(() => sandboxPolicy({ ...policy, reach: { level: 'owner', protectedPaths: [] } })).toThrow('protected paths')
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
