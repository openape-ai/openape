import { executeHttp } from '../src/main/programs/http-service'
import { _electron as electron } from 'playwright'
import { fixtureDirectory } from '../src/main/fixture'
import { PodDatabase } from '../src/worker/storage/database'
import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { expect, it, vi } from 'vitest'
import { CredentialCache } from '../src/main/connections/cache'
import { ProgramState } from '../src/main/programs/state'
import { ProgramSession } from '../src/main/programs/session'
import { invokeProgram } from '../src/main/programs/invoke'
import { startAgentGateway } from '../src/worker/agent/gateway'
import type { ProgramAssignment } from '../src/contracts/programs'
import type { PodResource } from '../src/contracts/resources'

const sendHttp = vi.hoisted(() => vi.fn(async (_request: unknown, _signal: AbortSignal) => ({ status: 200, headers: {}, body: '{}' })))
vi.mock('../src/main/programs/http', () => ({ requestHttp: sendHttp }))
const execute = promisify(execFile)
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-assigned-program-')))
  const privateRoot = join(root, 'authentication'); await mkdir(privateRoot)
  const executable = join(root, 'fixture'); const adapterPath = join(root, 'fixture.toml')
  await writeFile(join(root, 'fixture.c'), `#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc != 2) return 2;
  if (!strcmp(argv[1], "setup")) {
    puts("SETUP_READY"); fflush(stdout);
    char line[100]; if (!fgets(line, sizeof(line), stdin)) return 3;
    FILE *file=fopen("state.txt", "w"); if (!file) return 4;
    fputs(line, file); fclose(file); puts("SETUP_SAVED"); return 0;
  }
  if (!strcmp(argv[1], "read")) {
    FILE *file=fopen("state.txt", "r"); if (!file) return 5;
    char line[100]; if (!fgets(line, sizeof(line), file)) return 6;
    fclose(file); printf("STATE_MATCH %d\\n", !strcmp(line, "SYNTHETIC_CONFIGURATION\\n")); return 0;
  }
  return 7;
}`)
  await execute('/usr/bin/xcrun', ['clang', '-Wall', '-Wextra', '-Werror', join(root, 'fixture.c'), '-o', executable])
  await writeFile(adapterPath, `schema="openape-shapes/v1"\n[cli]\nid="fixture"\nexecutable="fixture"\naudience="shapes"\n${['setup', 'read'].map(action => `[[operation]]\nid="state.${action}"\ncommand=["${action}"]\ndisplay="Synthetic ${action}"\naction="${action === 'setup' ? 'write' : 'read'}"\nrisk="low"\nresource_chain=["state:*"]\n`).join('')}`)
  const adapter = loadAdapter('fixture', adapterPath)
  const commands = await Promise.all(['setup', 'read'].map(action => resolveCommand(adapter, ['fixture', action])))
  fixtureDirectory(root)
  const store = new PodDatabase(root); const pod = store.createPod({ name: 'Application setup', assignment: 'Synthetic program setup and granted reads' }); store.close()
  const podId = pod.id; const applicationId = randomUUID(); const connectionId = randomUUID()
  const keys = generateKeyPairSync('ed25519'); let origin = ''
  const state = { active: true, consumed: 0, corruptDetail: false, signedCommand: undefined as Awaited<ReturnType<typeof resolveCommand>> | undefined }
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/.well-known/jwks.json') { response.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] })); return }
    const index = request.url?.includes('/setup/') ? 0 : 1
    const grantId = request.url?.includes('/http/') ? 'http' : index === 0 ? 'setup' : 'read'
    if (request.url?.startsWith('/api/pods/agents/')) { response.end(JSON.stringify({ email: 'pod@example.test', owner: 'owner@example.test', active: true, keyIds: ['pod-key'], grantId: new URL(request.url, origin).searchParams.get('grant'), grantActive: state.active })); return }
    if (request.url === `/api/grants/${grantId}/token`) {
      const command = state.signedCommand ?? commands[state.corruptDetail ? 0 : index]!
      const now = Math.floor(Date.now() / 1000)
      const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
      const body = Buffer.from(JSON.stringify({ iss: origin, sub: 'pod@example.test', aud: 'shapes', target_host: `pods:${podId}`, grant_id: grantId, grant_type: 'always', iat: now, exp: now + 60, jti: randomUUID(), authorization_details: [command.detail], execution_context: command.executionContext })).toString('base64url')
      response.end(JSON.stringify({ authz_jwt: `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), keys.privateKey).toString('base64url')}` })); return
    }
    if (request.url === `/api/grants/${grantId}/consume`) { state.consumed++; response.end(JSON.stringify({ status: state.active ? 'valid' : 'revoked' })); return }
    response.statusCode = 404; response.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture bind failed')
  origin = `http://127.0.0.1:${address.port}`
  const cache = new CredentialCache(join(root, 'credentials'), { available: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
  const identity = { connectionId, podId, issuer: origin, owner: 'owner@example.test', subject: 'pod@example.test', keyId: 'pod-key' }
  await cache.connect(connectionId, JSON.stringify({ ...identity, accessToken: 'SYNTHETIC_AGENT', expiresAt: Date.now() / 1000 + 3600 }))
  const stateId = await new ProgramState(cache).create({ podId, applicationId })
  const assignment: ProgramAssignment = { type: 'program', name: 'Synthetic application', executable, executableHash: sha(await readFile(executable)), adapterPath, adapterHash: sha(await readFile(adapterPath)), cliId: 'fixture', networkHosts: [], entryFiles: [], environment: {}, stateId, capability: `tool.app_${applicationId.replaceAll('-', '')}.invoke`, grants: commands.map((command, index) => ({ permission: command.permission, display: command.detail.display, authority: { identity, ownerConnection: randomUUID(), grantId: index === 0 ? 'setup' : 'read' } })) }
  const resource: PodResource = { id: applicationId, podId, revision: 1, kind: 'tool', state: 'ready', name: assignment.name, configuration: { ...assignment } }
  const helper = resolve('dist/native/pods-helper'); let releases = 0
  const terminal = () => new ProgramSession(randomUUID(), podId, applicationId, assignment, ['setup'], helper, privateRoot, cache, async () => {}, async () => { releases++ })
  const lease = { signal: new AbortController().signal, capabilities: [assignment.capability], assertCurrent: () => {} }
  const invoke = (argv: string[], capabilities = lease.capabilities) => invokeProgram([resource], podId, { applicationId, argv }, helper, privateRoot, cache, { ...lease, capabilities })
  return { root, privateRoot, cache, assignment, resource, podId, applicationId, state, terminal, invoke, releases: () => releases, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }) } }
}

it('program boundary: owner terminal state is reused by the assigned read tool and the agent sees only its result', async () => {
  const f = await fixture(); const terminal = f.terminal()
  try {
    await expect.poll(() => terminal.view().output).toContain('SETUP_READY')
    terminal.input('SYNTHETIC_CONFIGURATION\n'); await terminal.completed
    expect(terminal.view()).toMatchObject({ state: 'closed', exitCode: 0, error: null })
    expect(f.releases()).toBe(1)
    expect((await f.invoke(['read'])).stdout).toBe('STATE_MATCH 1\n')
    const gateway = await startAgentGateway({ provider: async () => new Response(), tool: async (body) => {
      const request = body as { applicationId: string, argv: string[] }
      if (request.applicationId !== f.applicationId) throw new Error('Unassigned application')
      return f.invoke(request.argv)
    } }, new AbortController().signal)
    try {
      const response = await fetch(`http://127.0.0.1:${gateway.port}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${gateway.capability}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ape_shell', arguments: { applicationId: f.applicationId, argv: ['read'] } } }) })
      const text = await response.text(); expect(text).toContain('STATE_MATCH 1'); expect(text).not.toContain('SYNTHETIC_CONFIGURATION'); expect(text).not.toContain('SYNTHETIC_AGENT')
    }
    finally { await gateway.close() }
    await expect(f.invoke(['setup'])).rejects.toThrow('Only granted read')
    await expect(f.invoke(['read'], [])).rejects.toThrow('not declared')
    f.state.corruptDetail = true
    await expect(f.invoke(['read'])).rejects.toThrow()
    expect(f.state.consumed).toBe(3)
    expect(await readdir(join(f.root, 'credentials/temporary'))).toEqual([])
  }
  finally { terminal.close(); await terminal.completed; await f.close() }
})

it('program boundary: grant revocation stops a waiting terminal before its lease and plaintext state are released', async () => {
  const f = await fixture(); const terminal = f.terminal()
  try {
    await expect.poll(() => terminal.view().output).toContain('SETUP_READY')
    expect(f.releases()).toBe(0)
    f.state.active = false; await terminal.completed
    expect(terminal.view()).toMatchObject({ state: 'closed', exitCode: 125 })
    expect(terminal.view().error).not.toBeNull()
    expect(f.releases()).toBe(1)
    expect(await readdir(join(f.root, 'credentials/temporary'))).toEqual([])
    await expect(f.invoke(['read'])).rejects.toThrow('no longer active')
  }
  finally { terminal.close(); await terminal.completed; await f.close() }
})

it('packaged program UI: opens a real pod terminal and persists application setup without an inferred login status', async () => {
  const f = await fixture()
  const store = new PodDatabase(f.root)
  store.db.prepare('INSERT INTO resources VALUES(?,?,1,\'tool\',\'ready\',?,?)').run(f.applicationId, f.podId, f.assignment.name, JSON.stringify(f.assignment))
  store.close()
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: homedir(), TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: f.root, NODE_ENV: 'test' } })
  console.info('Program UI: fixture launched')
  try {
    const records = await Promise.all([f.assignment.stateId, f.assignment.grants[0]!.authority.identity.connectionId].map(async id => ({ path: join(f.root, 'credentials', `${id}.encrypted`), value: await readFile(join(f.root, 'credentials', `${id}.encrypted`), 'utf8') })))
    await app.evaluate(({ safeStorage }, records) => {
      const { writeFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
      if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS credential storage unavailable for program UI fixture')
      for (const record of records) writeFileSync(record.path, safeStorage.encryptString(record.value), { mode: 0o600 })
    }, records)
    console.info('Program UI: synthetic records encrypted using macOS safeStorage')
    const page = await app.firstWindow(); page.setDefaultTimeout(7000)
    await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    console.info('Program UI: worker ready')
    await page.getByRole('tab', { name: 'Permissions', exact: true }).click()
    await page.getByLabel('Arguments for Synthetic application').fill('setup')
    await page.getByRole('button', { name: 'Open terminal', exact: true }).click()
    await page.locator('.xterm-helper-textarea').waitFor({ state: 'attached' })
    await expect.poll(async () => (await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), f.podId)).resources.length).toBe(1)
    await page.locator('.pod-terminal .xterm-screen').waitFor()
    await expect.poll(() => f.state.consumed).toBe(1)
    await page.getByRole('status').filter({ hasText: 'Application running' }).waitFor()
    console.info('Program UI: terminal opened')
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type('SYNTHETIC_CONFIGURATION'); await page.keyboard.press('Enter')
    await page.getByRole('status').filter({ hasText: 'Program exited with code 0' }).waitFor()
    expect(await page.getByText('Signed in', { exact: true }).count()).toBe(0)
    await mkdir(resolve('.artifacts'), { recursive: true })
    expect(await page.locator('.xterm-rows').evaluate(element => getComputedStyle(element).color)).toBe('rgb(228, 236, 230)')
    await page.locator('.pod-terminal').screenshot({ path: resolve('.artifacts/program-terminal-en.png') })
    await page.getByRole('button', { name: 'Close terminal', exact: true }).click()
    await page.getByLabel('Arguments for Synthetic application').fill('read')
    await page.getByRole('button', { name: 'Open terminal', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Program exited with code 0' }).waitFor()
    await page.locator('.pod-terminal').screenshot({ path: resolve('.artifacts/program-read-en.png') })
    await page.getByRole('button', { name: 'Close terminal', exact: true }).click()
    await page.getByRole('button', { name: 'Add application', exact: true }).click()
    await page.getByText('o365-cli', { exact: true }).first().waitFor()
    await page.locator('.application-card').first().screenshot({ path: resolve('.artifacts/program-permissions-en.png') })
    await page.locator('.http-form').screenshot({ path: resolve('.artifacts/program-http-en.png') })
    await page.getByRole('button', { name: 'App settings', exact: true }).click()
    await page.getByLabel('Language', { exact: true }).selectOption('de')
    await page.locator('.pod-button').first().click()
    await page.getByRole('tab', { name: 'Berechtigungen', exact: true }).click()
    await page.getByRole('heading', { name: 'Ausführbare Anwendungen', exact: true }).waitFor()
    await page.emulateMedia({ colorScheme: 'dark' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(560, 800))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('.application-card').first().screenshot({ path: resolve('.artifacts/program-permissions-de-dark.png') })
    await page.locator('.http-form').screenshot({ path: resolve('.artifacts/program-http-de-dark.png') })
  }
  finally { await app.close(); await f.close() }
})

it('HTTP grant boundary: verifies the signed origin and method before transport and cancels on remote revocation', async () => {
  const f = await fixture(); sendHttp.mockClear()
  const vendor = resolve('dist/vendor'); const adapter = loadAdapter('pod-http', join(vendor, 'pod-http-shapes.toml'))
  f.state.signedCommand = await resolveCommand(adapter, ['pod-http', 'request', '--origin', 'https://api.example.com', '--method', 'POST'])
  const authority = { ...f.assignment.grants[0]!.authority, grantId: 'http' }
  const capability = 'tool.http_synthetic.request'
  const resources: PodResource[] = [{ ...f.resource, configuration: { type: 'http', origin: 'https://api.example.com', methods: ['POST'], capability, authority } }]
  const scope = { podId: f.podId, runId: randomUUID(), epoch: 0, assignmentRevision: 1, capabilities: [capability] }
  const request = { url: 'https://api.example.com/send', method: 'POST', headers: {}, key: 'synthetic' }
  const signal = new AbortController().signal
  try {
    expect(await executeHttp(resources, scope, request, vendor, f.cache, signal)).toMatchObject({ status: 200 })
    expect(sendHttp).toHaveBeenCalledTimes(1); expect(f.state.consumed).toBe(1)
    await expect(executeHttp(resources, scope, { ...request, method: 'DELETE' }, vendor, f.cache, signal)).rejects.toThrow('assigned origin or methods')
    await expect(executeHttp(resources, { ...scope, podId: randomUUID() }, request, vendor, f.cache, signal)).rejects.toThrow('not assigned')
    f.state.signedCommand = await resolveCommand(adapter, ['pod-http', 'request', '--origin', 'https://foreign.example.com', '--method', 'POST'])
    await expect(executeHttp(resources, scope, request, vendor, f.cache, signal)).rejects.toThrow('does not cover')
    expect(sendHttp).toHaveBeenCalledTimes(1)
    f.state.signedCommand = await resolveCommand(adapter, ['pod-http', 'request', '--origin', 'https://api.example.com', '--method', 'POST'])
    sendHttp.mockImplementationOnce(async (_request, activeSignal) => {
      f.state.active = false
      return new Promise((_resolve, reject) => activeSignal.addEventListener('abort', () => reject(new Error('Synthetic transport cancelled')), { once: true }))
    })
    await expect(executeHttp(resources, scope, request, vendor, f.cache, signal)).rejects.toThrow('Synthetic transport cancelled')
    expect(sendHttp).toHaveBeenCalledTimes(2)
  }
  finally { await f.close() }
})
