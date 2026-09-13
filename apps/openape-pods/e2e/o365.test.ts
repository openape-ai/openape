import { mailTLSFixture } from './fixtures/mail-tls'
import { mkdtemp, realpath, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { launchSandbox, verifyExecutable } from '../src/worker/runtime/sandbox'
import type { ProcessDomain } from '../src/worker/runtime/sandbox'

let root = ''; const domains: ProcessDomain[] = []
afterEach(async () => { for (const domain of domains.splice(0)) { domain.cancel(); await domain.completed } if (root) await rm(root, { recursive: true, force: true }) })
async function capture(domain: ProcessDomain): Promise<{ code: number, stdout: string, stderr: string }> {
  domains.push(domain)
  let stdout = ''; let stderr = ''
  domain.stdout.setEncoding('utf8'); domain.stderr.setEncoding('utf8')
  domain.stdout.on('data', (chunk) => { stdout += chunk }); domain.stderr.on('data', (chunk) => { stderr += chunk })
  await domain.processId
  return { code: await domain.completed, stdout, stderr }
}
it.each([false, true])('runs the pinned o365 read protocol inside the native sandbox (packaged=%s)', async (packaged) => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-o365-native-')))
  const dist = packaged ? resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/Resources/app.asar.unpacked/dist') : resolve('dist')
  const executable = join(dist, 'vendor/o365-cli')
  const manifest = JSON.parse(await readFile(join(dist, 'vendor/o365-manifest.json'), 'utf8')) as { binaryHash: string }
  await verifyExecutable(executable, manifest.binaryHash)
  for (const operation of ['capabilities', 'denied']) {
    const args = operation === 'capabilities' ? ['pods', 'capabilities'] : ['pods', 'read', '--account', 'pod@example.invalid', '--cache-dir', root, '--operation', 'send', '--folder', 'inbox']
    const domain = await launchSandbox(join(dist, 'native/pods-helper'), root, { executable, workspace: root, readFiles: [], runtimeDirectories: [] }, args)
    const { code, stdout, stderr } = await capture(domain)
    if (operation === 'capabilities') { expect(code, stderr).toBe(0); expect(JSON.parse(stdout)).toMatchObject({ scope: 'Mail.Read', immutableIds: true, ambientConfig: false }) }
    else { expect(code).not.toBe(0); expect(stderr).toContain('unknown read operation'); expect(stdout).toBe('') }
  }
})

it.each([false, true])('refreshes synthetic OAuth and reads all TLS pages through the confined packaged CLI (packaged=%s)', async (packaged) => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-o365-tls-')))
  const fixture = await mailTLSFixture(root)
  const workspace = join(root, 'tool'); await mkdir(workspace, { mode: 0o700 })
  const cachePath = join(workspace, 'token.json')
  await writeFile(cachePath, await readFile(resolve('e2e/fixtures/msal-synthetic.json')), { mode: 0o600 })
  const dist = packaged ? resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/Resources/app.asar.unpacked/dist') : resolve('dist')
  const executable = join(dist, 'vendor/o365-cli')
  let cursor = ''; const ids: string[] = []
  try {
    for (let page = 0; page < 2; page++) {
      const args = ['pods', 'read', '--account', 'pod@example.invalid', '--cache-dir', workspace, '--operation', 'messages', '--folder', 'inbox', ...(cursor ? ['--cursor', cursor] : [])]
      const domain = await launchSandbox(join(dist, 'native/pods-helper'), root, { executable, workspace, readFiles: [fixture.certificate], runtimeDirectories: [], networkPorts: [fixture.proxy.port] }, args, { ...fixture.proxy.environment, PODS_CA_FILE: fixture.certificate })
      const { code, stdout, stderr } = await capture(domain)
      expect(code, `${stderr}\n${fixture.requests.join('\n')}`).toBe(0)
      const response = JSON.parse(stdout) as { items: { id: string, isRead: boolean }[], nextCursor?: string, complete: boolean }
      expect(response.items.every(item => item.isRead === false)).toBe(true)
      ids.push(...response.items.map(item => item.id)); cursor = response.nextCursor ?? ''
      expect(response.complete).toBe(page === 1)
    }
    expect(ids).toEqual(['first', 'second']); expect(fixture.state).toMatchObject({ refreshes: 1, reads: 2 })
    expect(await readFile(cachePath, 'utf8')).toContain('SYNTHETIC_TLS_REFRESH')
  }
  finally { await fixture.close() }
})

it.each(['invalidRefresh', 'wrongAccount', 'cancel'] as const)('fails closed for %s in a packaged TLS read', async (mode) => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-o365-tls-denied-')))
  const fixture = await mailTLSFixture(root)
  const workspace = join(root, 'tool'); await mkdir(workspace, { mode: 0o700 })
  await writeFile(join(workspace, 'token.json'), await readFile(resolve('e2e/fixtures/msal-synthetic.json')), { mode: 0o600 })
  const dist = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/Resources/app.asar.unpacked/dist')
  if (mode === 'cancel') fixture.state.stallRead = true
  else fixture.state[mode] = true
  try {
    const domain = await launchSandbox(join(dist, 'native/pods-helper'), root, { executable: join(dist, 'vendor/o365-cli'), workspace, readFiles: [fixture.certificate], runtimeDirectories: [], networkPorts: [fixture.proxy.port] }, ['pods', 'read', '--account', 'pod@example.invalid', '--cache-dir', workspace, '--operation', 'messages', '--folder', 'inbox'], { ...fixture.proxy.environment, PODS_CA_FILE: fixture.certificate })
    const completion = capture(domain)
    if (mode === 'cancel') { await expect.poll(() => fixture.state.reads, { timeout: 5000 }).toBe(1); domain.cancel() }
    const result = await completion
    expect(result.code).not.toBe(0); expect(result.stdout).toBe('')
    if (mode !== 'cancel') { expect(fixture.state.reads).toBe(0); expect(result.stderr).toContain('authentication or token refresh failed') }
  }
  finally { await fixture.close() }
})
