import { fixtureShellIdentity } from './fixtures/shell-identity'
import { failOnKeychainDialog } from './fixtures/keychain'
import { openPod } from './fixtures/navigation'
import { removeProfile } from './fixtures/startup'
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
import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { computeArgvHash } from '@openape/grants'
import { httpPermission } from '../src/main/grants/pod-permissions'
import { expect, it, vi } from 'vitest'
import { CredentialCache } from '../src/main/connections/cache'
import { ProgramState } from '../src/main/programs/state'
import { podWorkspace } from '../src/main/programs/console'
import { ProgramSession } from '../src/main/programs/session'
import { invokeProgram } from '../src/main/programs/invoke'
import { PodIdentityManager } from '../src/main/connections/agent'
import type { GrantLedgerPort } from '../src/main/broker/authorization'
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
  const executable = join(root, 'fixture')
  await writeFile(join(root, 'fixture.c'), `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  char statePath[4096]; snprintf(statePath, sizeof(statePath), "%s/state.txt", getenv("HOME"));
  if (argc != 2) return 2;
  if (!strcmp(argv[1], "setup")) {
    char cwd[4096]; if (!getcwd(cwd,sizeof(cwd))) return 8;
    printf("CWD %s\\n",cwd);
    FILE *outside=fopen("${join(root, 'outside.txt')}", "r");
    if (outside) { fclose(outside); puts("OUTSIDE_READ_ALLOWED"); return 9; }
    puts("OUTSIDE_READ_DENIED");
    FILE *note=fopen("terminal-work.txt", "w"); if (!note) return 10;
    fputs("POD_WORKSPACE_WRITE",note); fclose(note);
    puts("SETUP_READY"); fflush(stdout);
    char line[100]; if (!fgets(line, sizeof(line), stdin)) return 3;
    FILE *file=fopen(statePath, "w"); if (!file) return 4;
    fputs(line, file); fclose(file); puts("SETUP_SAVED"); return 0;
  }
  if (!strcmp(argv[1], "read")) {
    const char *authPath=getenv("APES_AUTH_FILE"); if (!authPath) return 11;
    FILE *auth=fopen(authPath, "r"); if (!auth) return 12;
    char identity[2048]={0}; fread(identity, 1, sizeof(identity)-1, auth); fclose(auth);
    if ((!strstr(identity, "SYNTHETIC_AGENT") || !strstr(identity, "pod@example.test")) && (!strstr(identity, "LOCAL_SYNTHETIC_TOKEN") || !strstr(identity, "fixture-"))) return 13;
    auth=fopen(authPath, "w"); if (auth) { fclose(auth); return 14; }
    puts(strstr(identity, "SYNTHETIC_AGENT") ? "IDENTITY_READ_ONLY SYNTHETIC_AGENT" : "IDENTITY_READ_ONLY LOCAL_SYNTHETIC_TOKEN");
    FILE *file=fopen(statePath, "r"); if (!file) return 5;
    char line[100]; if (!fgets(line, sizeof(line), file)) return 6;
    fclose(file); printf("STATE_MATCH %d\\n", !strcmp(line, "SYNTHETIC_CONFIGURATION\\n")); return 0;
  }
  return 7;
}`)
  await execute('/usr/bin/xcrun', ['clang', '-Wall', '-Wextra', '-Werror', join(root, 'fixture.c'), '-o', executable])
  await writeFile(join(root, 'outside.txt'), 'SYNTHETIC_OUTSIDE')
  // The IdP's grants of the synthetic program: setup writes its state, read reads it (issue 1473, revision 4).
  const detail = (action: string): OpenApeCliAuthorizationDetail => ({ type: 'openape_cli', cli_id: 'fixture', operation_id: `state.${action}`, resource_chain: [{ resource: 'state' }], action, permission: `fixture.state[*]#${action}`, display: `Synthetic ${action}`, risk: 'low' })
  fixtureDirectory(root)
  const store = new PodDatabase(root); const pod = store.createPod({ name: 'Application setup' }); store.close()
  const podId = pod.id; const applicationId = randomUUID(); const connectionId = randomUUID()
  const keys = generateKeyPairSync('ed25519'); let origin = ''
  const state = { active: true, consumed: 0, authorized: 0, corruptHash: false, signedDetail: undefined as OpenApeCliAuthorizationDetail | undefined }
  const signed = (claims: Record<string, unknown>) => {
    const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), keys.privateKey).toString('base64url')}`
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/.well-known/jwks.json') { response.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] })); return }
    if (request.url === '/api/grants/authorize' && request.method === 'POST') {
      let text = ''; for await (const chunk of request) text += chunk
      const call = JSON.parse(text) as { program: { name: string, sha256: string }, argv: string[], files?: { path: string, sha256: string }[] }
      const grantId = call.argv[0] === 'setup' ? 'setup' : 'read'
      if (!state.active) { response.statusCode = 403; response.end(JSON.stringify({ type: 'https://openape.org/errors/grant_revoked', title: 'Grant revoked', status: 403, state: 'revoked', grant_id: grantId })); return }
      state.authorized++
      const now = Math.floor(Date.now() / 1000)
      const token = signed({ iss: origin, sub: 'pod@example.test', aud: 'shapes', target_host: `pods:${podId}`, grant_id: grantId, grant_type: 'always', iat: now, exp: now + 60, jti: randomUUID(), authorization_details: [detail(grantId === 'setup' ? 'write' : 'read')], argv_hash: await computeArgvHash([call.program.name, ...call.argv]), program_sha256: state.corruptHash ? '0'.repeat(64) : call.program.sha256, execution_context: { files: call.files } })
      response.end(JSON.stringify({ state: 'approved', grant_id: grantId, authz_jwt: token, expires_at: now + 60 })); return
    }
    const grantId = request.url?.split('/')[3] === 'http' ? 'http' : request.url?.split('/')[3] === 'setup' ? 'setup' : 'read'
    if (request.url?.startsWith('/api/pods/agents/')) { response.end(JSON.stringify({ email: 'pod@example.test', owner: 'owner@example.test', active: true, keyIds: ['pod-key'], grantId: new URL(request.url, origin).searchParams.get('grant'), grantActive: state.active })); return }
    if (request.url === `/api/grants/${grantId}`) { response.end(JSON.stringify({ id: grantId, status: state.active ? 'approved' : 'revoked', request: { requester: 'pod@example.test', audience: 'shapes', target_host: `pods:${podId}`, grant_type: 'always', authorization_details: [grantId === 'http' ? state.signedDetail! : detail(grantId === 'setup' ? 'write' : 'read')] } })); return }
    if (request.url === `/api/grants/${grantId}/token`) {
      const now = Math.floor(Date.now() / 1000)
      response.end(JSON.stringify({ authz_jwt: signed({ iss: origin, sub: 'pod@example.test', aud: 'shapes', target_host: `pods:${podId}`, grant_id: grantId, grant_type: 'always', iat: now, exp: now + 60, jti: randomUUID(), authorization_details: [state.signedDetail] }) })); return
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
  const assignment: ProgramAssignment = { type: 'program', name: 'Synthetic application', executable, executableHash: sha(await readFile(executable)), cliId: 'fixture', networkHosts: [], entryFiles: [], environment: {}, stateId, capability: `tool.app_${applicationId.replaceAll('-', '')}.invoke` }
  // The Pod's HTTP grant is recorded apart from the sandboxed application; program commands are authorized by the IdP per call.
  const connection = new PodIdentityManager(cache).connection(identity, `pods:${podId}`)
  const ledger: GrantLedgerPort = { find: async detail => detail.cli_id === 'pod-http' ? 'http' : detail.action === 'write' ? 'setup' : 'read', adopt: async () => undefined, record: async () => {} }
  const resource: PodResource = { id: applicationId, podId, revision: 1, kind: 'tool', state: 'ready', name: assignment.name, configuration: { ...assignment } }
  const helper = resolve('dist/native/pods-helper'); let releases = 0
  const workspace = await podWorkspace(root, podId)
  const terminal = () => new ProgramSession(randomUUID(), podId, applicationId, assignment, ['setup'], helper, privateRoot, cache, async () => {}, async () => { releases++ }, workspace, { readDirectories: [], writeDirectories: [] }, { connection: async () => connection, runtime: { executable: process.execPath, cli: resolve('dist/vendor/apes/ape-shell.mjs'), environment: { HOME: privateRoot } }, ledger, origin: async () => 'Programs', reach: async () => ({ level: 'isolated', protectedPaths: [] }) })
  const lease = { signal: new AbortController().signal, capabilities: [assignment.capability], assertCurrent: () => {} }
  const invoke = (argv: string[], capabilities = lease.capabilities) => invokeProgram([resource], podId, { application: assignment.name, argv }, helper, privateRoot, cache, { ...lease, capabilities }, { connection, reach: { level: 'isolated', protectedPaths: [] }, execution: { operationId: randomUUID(), targetHost: connection.targetHost, runtime: { executable: process.execPath, cli: resolve('dist/vendor/apes/ape-shell.mjs') }, observer: { authorized: async () => {} } } })
  return { root, privateRoot, cache, assignment, resource, podId, applicationId, state, identity, connection, ledger, terminal, invoke, releases: () => releases, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await removeProfile(root) } }
}

it('program boundary: owner terminal state is reused by the assigned read tool and the agent sees only its result', async () => {
  const f = await fixture(); const terminal = f.terminal()
  try {
    await expect.poll(() => terminal.view().output).toContain('SETUP_READY')
    terminal.input('SYNTHETIC_CONFIGURATION\n'); await terminal.completed
    expect(terminal.view()).toMatchObject({ state: 'closed', exitCode: 0, error: null })
    expect(f.releases()).toBe(1)
    expect((await f.invoke(['read'])).stdout).toBe('IDENTITY_READ_ONLY [REDACTED]\nSTATE_MATCH 1\n')
    const gateway = await startAgentGateway({
      provider: async () => new Response(),
      tool: async (body) => {
        const request = body as { applicationId: string, argv: string[], files?: { path: string, sha256: string }[] }
        if (request.applicationId !== f.applicationId) throw new Error('Unassigned application')
        return f.invoke(request.argv)
      },
    }, new AbortController().signal)
    try {
      const response = await fetch(`http://127.0.0.1:${gateway.port}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${gateway.capability}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ape_shell', arguments: { applicationId: f.applicationId, argv: ['read'] } } }) })
      const text = await response.text(); expect(text).toContain('STATE_MATCH 1'); expect(text).not.toContain('SYNTHETIC_CONFIGURATION'); expect(text).not.toContain('SYNTHETIC_AGENT')
    }
    finally { await gateway.close() }
    await expect(f.invoke(['read'], [])).rejects.toThrow('not declared')
    f.state.corruptHash = true
    await expect(f.invoke(['read'])).rejects.toThrow('Command token does not match this program file')
    expect(f.state.authorized).toBe(4)
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
    expect(terminal.view()).toMatchObject({ state: 'closed' })
    expect(terminal.view().exitCode).not.toBe(0)
    expect(terminal.view().error).not.toBeNull()
    expect(f.releases()).toBe(1)
    expect(await readdir(join(f.root, 'credentials/temporary'))).toEqual([])
    await expect(f.invoke(['read'])).rejects.toThrow('Grant read revoked')
  }
  finally { terminal.close(); await terminal.completed; await f.close() }
})

// Application cards, HTTP destinations and their narrow/German layout live in
// test/programs/ui.test.ts and test/layout/pod-tabs.test.ts; the owner dialogs in
// test/main/app.test.ts. This keeps what needs the packaged app: keychain-backed
// program state, the folder dialog path and a saved script reaching the
// application through worker, main broker and ape-shell.
it('packaged program UI: exposes the external terminal and reuses application setup from the saved script', async () => {
  const f = await fixture()
  const setup = f.terminal()
  await expect.poll(() => setup.view().output).toContain('SETUP_READY')
  setup.input('SYNTHETIC_CONFIGURATION\n'); await setup.completed
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'pods-assigned-folder-')))
  await writeFile(join(folder, 'input.txt'), 'DIRECT_READ')
  // The Pod acts as the shell identity's Pod; its IdP approves the application's commands as the owner would.
  const shellIdentity = await fixtureShellIdentity(f.root, ['fixture'])
  const store = new PodDatabase(f.root)
  store.db.prepare('INSERT INTO pod_sandbox VALUES(?,?) ON CONFLICT(pod_id) DO UPDATE SET level=excluded.level').run(f.podId, 'isolated')
  store.db.prepare('INSERT INTO resources VALUES(?,?,1,\'tool\',\'ready\',?,?)').run(f.applicationId, f.podId, f.assignment.name, JSON.stringify(f.assignment))
  store.db.prepare('INSERT INTO resources VALUES(?,?,1,\'tool\',\'ready\',?,?)').run(randomUUID(), f.podId, 'https://api.example.com', JSON.stringify({ type: 'http', origin: 'https://api.example.com', methods: ['GET', 'POST'], capability: 'tool.http_fixture.request' }))
  store.close()
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: homedir(), TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: f.root, NODE_ENV: 'test' } })
  failOnKeychainDialog(app)
  console.info('Program UI: fixture launched')
  try {
    const records = await Promise.all([f.assignment.stateId, f.identity.connectionId].map(async id => ({ path: join(f.root, 'credentials', `${id}.encrypted`), value: await readFile(join(f.root, 'credentials', `${id}.encrypted`), 'utf8') })))
    await app.evaluate(({ safeStorage }, records) => {
      const { writeFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Credential storage unavailable for program UI fixture')
      for (const record of records) writeFileSync(record.path, safeStorage.encryptString(record.value), { mode: 0o600 })
    }, records)
    await shellIdentity.encrypt(app)
    console.info('Program UI: synthetic records encrypted using safeStorage with the mock keychain')
    const page = await app.firstWindow(); page.setDefaultTimeout(7000)
    await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    console.info('Program UI: worker ready')
    await openPod(page, 'Application setup')
    await page.getByRole('navigation', { name: 'Pod sections' }).getByRole('button', { name: 'Access', exact: true }).click()
    await page.getByRole('button', { name: 'Open Terminal.app', exact: true }).waitFor()
    expect(await page.getByRole('button', { name: 'Open Terminal.app', exact: true }).count()).toBe(1)
    expect(await page.locator('.pod-console').count()).toBe(0)
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder], bookmarks: [] })
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    }, folder)
    await page.getByRole('button', { name: 'Add directory', exact: true }).click()
    await expect.poll(async () => page.locator('.directory-select').count()).toBe(1)
    expect(await page.locator('.fixed-directory').count()).toBe(2)
    const runCode = `import fs from 'node:fs/promises'; import path from 'node:path';
    export async function run(context) {
      if (context.input.validation) return {status:'completed',summary:'Synthetic validation',completedInputIds:[],gapIds:[]}
      await fs.writeFile(path.join(context.home, 'home-check.txt'), 'HOME')
      if (context.directories.length) {
        const folder = context.directories[0].path
        if (await fs.readFile(path.join(folder, 'input.txt'), 'utf8') !== 'DIRECT_READ') throw new Error('Missing directory input')
        try { await fs.writeFile(path.join(folder, 'blocked.txt'), 'SYNTHETIC'); throw new Error('Unexpected directory write') }
        catch (error) { if (error.code !== 'EPERM') throw error }
      }
      const result = await context.tools.invoke({ application: 'Synthetic application', argv: ['read'] })
      if (result.exitCode !== 0) throw new Error('Application read failed: '+result.exitCode+' '+result.stderr)
      return { status: 'completed', summary: 'Program read: ' + result.stdout.trim(), completedInputIds: context.input.eventIds, gapIds: [] }
    }`
    await page.evaluate(async ({ podId, capability, code }) => {
      const current = await window.pods.scripts({ type: 'list', podId })
      const saved = await window.pods.scripts({ type: 'save', podId, revision: current.pod.revision, draftId: null, draftRevision: 0, code, capabilities: [capability] })
      const checked = await window.pods.scripts({ type: 'validate', podId, revision: saved.pod.revision, draftId: saved.source!.id, draftRevision: saved.source!.revision })
      await window.pods.scripts({ type: 'activate', podId, revision: checked.pod.revision, hash: checked.source!.hash!, expectedActive: null })
      await window.pods.runs({ type: 'start', podId })
    }, { podId: f.podId, capability: f.assignment.capability, code: runCode })
    await expect.poll(async () => { const run = (await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), f.podId)).runs[0]; return run?.error ?? run?.summary }, { timeout: 15000 }).toBe('Program read: IDENTITY_READ_ONLY [REDACTED]\nSTATE_MATCH 1')
    console.info('Program UI: saved script invoked application by name through worker and main broker')
  }
  finally { await app.close(); await shellIdentity.close(); await f.close(); await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

it('HTTP grant boundary: verifies the signed origin and method before transport and refuses a revoked grant without sending', async () => {
  const f = await fixture(); sendHttp.mockClear()
  f.state.signedDetail = httpPermission('https://api.example.com', 'POST').detail
  const capability = 'tool.http_synthetic.request'
  const resources: PodResource[] = [{ ...f.resource, configuration: { type: 'http', origin: 'https://api.example.com', methods: ['POST'], capability } }]
  const scope = { podId: f.podId, runId: randomUUID(), epoch: 0, assignmentRevision: 1, capabilities: [capability] }
  const request = { url: 'https://api.example.com/send', method: 'POST', headers: {}, key: 'synthetic' }
  const signal = new AbortController().signal
  try {
    expect(await executeHttp(resources, scope, request, f.connection, signal, undefined, f.ledger)).toMatchObject({ status: 200 })
    expect(sendHttp).toHaveBeenCalledTimes(1); expect(f.state.consumed).toBe(1)
    await expect(executeHttp(resources, scope, { ...request, method: 'DELETE' }, f.connection, signal, undefined, f.ledger)).rejects.toThrow('assigned origin or methods')
    await expect(executeHttp(resources, { ...scope, podId: randomUUID() }, request, f.connection, signal, undefined, f.ledger)).rejects.toThrow('not assigned')
    f.state.signedDetail = httpPermission('https://foreign.example.com', 'POST').detail
    await expect(executeHttp(resources, scope, request, f.connection, signal, undefined, f.ledger)).rejects.toThrow('does not cover')
    expect(sendHttp).toHaveBeenCalledTimes(1)
    f.state.signedDetail = httpPermission('https://api.example.com', 'POST').detail
    f.state.active = false
    await expect(executeHttp(resources, scope, request, f.connection, signal, undefined, f.ledger)).rejects.toThrow('Permission revoked')
    expect(sendHttp).toHaveBeenCalledTimes(1)
  }
  finally { await f.close() }
})

it('HTTP agent authentication: the runtime adds the DDISA bearer, refuses script credentials and forgets rejected tokens', async () => {
  const f = await fixture(); sendHttp.mockClear()
  f.state.signedDetail = httpPermission('https://api.example.com', 'GET').detail
  const capability = 'tool.http_synthetic.request'
  const authentication = { type: 'ddisaAgent' as const, credential: 'agent_key', subject: 'agent@id.example.com', issuer: 'https://id.example.com' }
  const resources: PodResource[] = [{ ...f.resource, configuration: { type: 'http', origin: 'https://api.example.com', methods: ['GET'], capability, authentication } }]
  const scope = { podId: f.podId, runId: randomUUID(), epoch: 0, assignmentRevision: 1, capabilities: [capability] }
  const request = { url: 'https://api.example.com/pending', method: 'GET', headers: {} }
  const bearer = { token: vi.fn(async () => 'SYNTHETIC_AGENT_TOKEN'), reject: vi.fn() }
  const signal = new AbortController().signal
  try {
    await expect(executeHttp(resources, scope, { ...request, headers: { Authorization: 'Bearer script' } }, f.connection, signal, undefined, f.ledger, bearer)).rejects.toThrow('remove the Authorization header')
    await expect(executeHttp(resources, scope, request, f.connection, signal, undefined, f.ledger)).rejects.toThrow('authentication is unavailable')
    expect(sendHttp).not.toHaveBeenCalled()
    expect(await executeHttp(resources, scope, request, f.connection, signal, undefined, f.ledger, bearer)).toMatchObject({ status: 200 })
    expect(bearer.token).toHaveBeenCalledWith(authentication, 'https://api.example.com')
    expect(sendHttp.mock.calls[0]![0]).toMatchObject({ headers: { authorization: 'Bearer SYNTHETIC_AGENT_TOKEN' } })
    expect(request.headers).toEqual({})
    sendHttp.mockResolvedValueOnce({ status: 200, headers: { 'x-echo': 'Bearer SYNTHETIC_AGENT_TOKEN' }, body: 'authorization: Bearer SYNTHETIC_AGENT_TOKEN' })
    const echoed = await executeHttp(resources, scope, request, f.connection, signal, undefined, f.ledger, bearer)
    expect(JSON.stringify(echoed)).not.toContain('SYNTHETIC_AGENT_TOKEN')
    sendHttp.mockResolvedValueOnce({ status: 401, headers: {}, body: '' })
    expect(await executeHttp(resources, scope, request, f.connection, signal, undefined, f.ledger, bearer)).toMatchObject({ status: 401 })
    expect(bearer.reject).toHaveBeenCalledWith(authentication)
  }
  finally { await f.close() }
})

it('program boundary: an explicit interpreter reuses private state while outside reads and child execution stay denied', async () => {
  const f = await fixture(); const terminal = f.terminal()
  try {
    await expect.poll(() => terminal.view().output).toContain('SETUP_READY')
    terminal.input('SYNTHETIC_CONFIGURATION\n'); await terminal.completed
    expect(terminal.view().exitCode).toBe(0)
    const interpreter = await realpath('/usr/bin/perl')
    const descriptorPath = join(f.root, 'runtime.json')
    const code = `open(my $state, '<', "$ENV{HOME}/state.txt") or die "missing private state"; my $value=<$state>; die "wrong state" unless $value eq "SYNTHETIC_CONFIGURATION\\n"; die "outside read allowed" if open(my $outside, '<', '${join(f.root, 'outside.txt')}'); my $child=fork(); die "fork allowed" if defined($child); print "PRIVATE_STATE_AND_BOUNDARIES_OK_0\\n";`
    await writeFile(descriptorPath, JSON.stringify({ version: 1, executable: interpreter, arguments: ['-e', code], readDirectories: [], environment: { FIXTURE_MODE: '0' } }), { mode: 0o600 })
    const { loadProgramRuntime } = await import('../src/main/programs/runtime')
    f.resource.configuration = { ...f.assignment, runtime: await loadProgramRuntime(descriptorPath) }
    const result = await f.invoke(['read'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('PRIVATE_STATE_AND_BOUNDARIES_OK_0\n')
    await writeFile(descriptorPath, '{}')
    await expect(f.invoke(['read'])).rejects.toThrow()
  }
  finally { terminal.close(); await terminal.completed; await f.close() }
})
