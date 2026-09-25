import { mkdtemp, realpath, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { AuthProcess } from '../src/main/connections/process'

// Account state, consent and their layout moved to test/onboarding/setup-state.test.ts,
// test/onboarding/ui.test.ts and test/layout/onboarding.test.ts. This keeps the real
// pinned Codex authentication process confined by the sandbox.
it('onboarding: the actual pinned authentication process accepts account reads and rejects model execution', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-auth-only-')))
  const home = join(root, 'home'); await mkdir(home, { mode: 0o700 })
  const runtime = { helper: resolve('dist/native/pods-helper'), executable: process.execPath, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [dirname(process.execPath)], environment: {}, binary: resolve('dist/vendor/codex'), catalog: resolve('dist/vendor/models.json'), manifest: resolve('dist/vendor/manifest.json'), sdkHost: resolve('dist/runtime/sdk-host.mjs') }
  const controller = new AbortController()
  const auth = await AuthProcess.start(runtime, root, runtime.binary, ['--strict-config', '-c', 'cli_auth_credentials_store="file"', 'app-server', '--stdio'], home, { HOME: home, CODEX_HOME: home, TMPDIR: home, PATH: '/usr/bin:/bin' }, controller.signal, () => {})
  try {
    await auth.request('initialize', { clientInfo: { name: 'pods_auth_test', version: '1' } }); auth.initialized()
    expect(await auth.request('account/read', { refreshToken: false })).toMatchObject({ account: null })
    await expect(auth.request('turn/start', { input: [] })).rejects.toThrow('cannot execute model')
    await expect(auth.request('command/exec', { command: ['touch', join(root, 'escaped')] })).rejects.toThrow('cannot execute model')
    await expect(readFile(join(root, 'escaped'))).rejects.toMatchObject({ code: 'ENOENT' })
  }
  finally { await auth.close(); await AuthProcess.recover(root, runtime.helper); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})
