import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPair, keyPath, loadKey, saveKey } from '../src/keys'

const dirs: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('keeps recipient keys isolated with their CLI authentication profile', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'secrets-profile-'))
  dirs.push(dir)
  vi.stubEnv('OPENAPE_CLI_AUTH_HOME', join(dir, 'agent-a'))
  const { privateJwk } = await generateKeyPair()
  const key = { consumerId: 'pilot-consumer', name: 'Pilot', privateJwk }
  const file = saveKey(key)
  expect(file).toBe(join(dir, 'agent-a', 'secrets', 'pilot-consumer.json'))
  expect(statSync(file).mode & 0o777).toBe(0o600)
  expect(loadKey(key.consumerId)).toEqual(key)
  vi.stubEnv('OPENAPE_CLI_AUTH_HOME', join(dir, 'agent-b'))
  expect(() => loadKey(key.consumerId)).toThrow('No private key')
  expect(() => keyPath('../agent-a')).toThrow('Invalid consumer ID')
  vi.stubEnv('OPENAPE_CLI_AUTH_HOME', join(dir, 'agent-a'))
  expect(loadKey(key.consumerId)).toEqual(key)
})

it('preserves the default key location without a profile override', () => {
  vi.stubEnv('OPENAPE_CLI_AUTH_HOME', '')
  expect(keyPath('existing-consumer')).toBe(join(homedir(), '.config', 'apes', 'secrets', 'existing-consumer.json'))
})
