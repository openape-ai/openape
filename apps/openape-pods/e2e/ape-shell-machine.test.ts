import { validateDraft } from '../src/worker/master/validation'
import { ExternalShell } from '../src/main/shell/session'
import { CredentialCache } from '../src/main/connections/cache'
import { ProgramState } from '../src/main/programs/state'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { executeScript } from '../src/worker/runs/runner'
import type { RunInput } from '../src/contracts/runs'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { computeArgvHash } from '@openape/grants'
import { afterEach, describe, expect, it } from 'vitest'
import { launchApeShell } from '../src/worker/runtime/ape-shell'
import { inspectDomainRecords } from '../src/worker/recovery/domains'
import type { ProcessDomain } from '../src/worker/runtime/sandbox'
import { observeExecution } from '../src/main/programs/execution'
import type { ExecutionObserver } from '../src/main/programs/execution'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { RunStore } from '../src/worker/runs/store'
import { PodToolBroker } from '../src/main/broker/tools'
import { EffectLedger } from '../src/worker/recovery/effects'

const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const roots: string[] = []
const domains: ProcessDomain[] = []
const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  for (const domain of domains.splice(0)) { domain.cancel(); await domain.completed }
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(code = 'console.log(JSON.stringify(process.argv.slice(1)))', packaged = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-machine-'))); roots.push(root)
  const workspace = join(root, 'workspace'); const privateRoot = join(root, 'private')
  await mkdir(workspace); await mkdir(privateRoot)
  const marker = join(workspace, 'marker')
  const script = join(root, 'script.mjs')
  await writeFile(script, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'executed'); ${code}`)
  const keys = generateKeyPairSync('ed25519')
  let origin = ''
  const state = { answer: 'approved', active: true, grantActive: true, consumes: 0, grantType: 'always', subject: 'pod@example.test', argvHash: '', fileHash: '', requests: [] as string[], calls: [] as { program: { name: string }, argv: string[], files?: { path: string, sha256: string }[] }[] }
  const server = createServer((request, response) => {
    const handle = async () => {
      response.setHeader('content-type', 'application/json')
      state.requests.push(request.url ?? '')
      if (request.url === '/.well-known/openid-configuration') { response.end(JSON.stringify({ grants_endpoint: `${origin}/api/grants` })); return }
      if (request.url === '/.well-known/jwks.json') { response.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] })); return }
      if (request.url === '/api/grants/authorize') {
        let text = ''; for await (const chunk of request) text += chunk
        const body = JSON.parse(text); state.calls.push(body)
        if (state.answer === 'pending') { response.end(JSON.stringify({ state: 'pending', grant_id: 'grant', approval_url: `${origin}/grant` })); return }
        if (state.answer !== 'approved') { response.writeHead(403).end(JSON.stringify({ state: state.answer, grant_id: 'grant' })); return }
        const now = Math.floor(Date.now() / 1000)
        const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
        const payload = Buffer.from(JSON.stringify({ iss: origin, sub: state.subject, aud: 'shapes', target_host: 'fixture-mac', grant_id: 'grant', grant_type: state.grantType, exp: now + 60, iat: now, jti: randomUUID(), argv_hash: state.argvHash || await computeArgvHash([body.program.name, ...body.argv]), program_sha256: state.fileHash || body.program.sha256, execution_context: { files: body.files }, authorization_details: [{ type: 'openape_cli', cli_id: body.program.name, action: 'execute' }] })).toString('base64url')
        response.end(JSON.stringify({ state: 'approved', grant_id: 'grant', authz_jwt: `${head}.${payload}.${sign(null, Buffer.from(`${head}.${payload}`), keys.privateKey).toString('base64url')}`, expires_at: now + 60 })); return
      }
      if (request.url === '/api/grants/grant/consume') {
        state.consumes++
        response.end(JSON.stringify(state.consumes === 1 ? { status: 'consumed' } : { error: 'used' })); return
      }
      if (request.url === '/api/grants/grant') { response.end(JSON.stringify({ status: state.answer })); return }
      if (request.url?.startsWith('/api/pods/agents/')) { response.end(JSON.stringify({ email: 'pod@example.test', owner: 'owner@example.test', active: state.active, grantActive: state.grantActive, keyIds: ['pod-key'], grantId: 'grant' })); return }
      response.writeHead(404).end('{}')
    }
    handle().catch(error => response.destroy(error))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const auth = join(privateRoot, 'auth.json')
  await writeFile(auth, JSON.stringify({ idp: origin, email: 'pod@example.test', owner_email: 'owner@example.test', agent_key_id: 'pod-key', access_token: 'SYNTHETIC_ONLY', expires_at: Math.floor(Date.now() / 1000) + 3600 }))
  const bundle = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents')
  const executable = await realpath(packaged ? join(bundle, 'MacOS/OpenApe Pods Fixture') : process.execPath)
  const helper = packaged ? join(bundle, 'Resources/app.asar.unpacked/dist/native/pods-helper') : resolve('dist/native/pods-helper')
  async function launch(options: { terminal?: boolean, waitMs?: number, argv?: string[], onAuthorized?: () => Promise<void>, acknowledge?: boolean, owner?: boolean, observer?: ExecutionObserver } = {}) {
    const operationId = randomUUID()
    const domain = await launchApeShell(helper, privateRoot, { executable, workspace, readFiles: [script], runtimeDirectories: packaged ? [bundle] : [], ...(options.owner ? { reach: { level: 'owner' as const, protectedPaths: [privateRoot], deny: [] } } : {}) }, options.argv ?? [script], { HOME: workspace, TMPDIR: workspace, ...(packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }, {
      runtime: { executable, cli: packaged ? join(bundle, 'Resources/apes/ape-shell.mjs') : resolve('dist/vendor/apes/ape-shell.mjs'), environment: { HOME: privateRoot, APES_AUTH_FILE: auth } },
      operationId,
      targetHost: 'fixture-mac',
      executableHash: digest(await readFile(executable)),
      files: [{ path: script, sha256: digest(await readFile(script)) }],
      waitMs: options.waitMs ?? 0,
      grantType: state.grantType as 'always' | 'once',
    }, undefined, options.terminal)
    domains.push(domain)
    let stdout = ''; let stderr = ''; let buffer = ''
    const events: Record<string, unknown>[] = []
    let callback = Promise.resolve()
    domain.stdout.on('data', (chunk) => { stdout += chunk.toString() }); domain.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    const observed = options.observer ? observeExecution(domain, operationId, options.observer, new AbortController().signal).catch((error: unknown) => error as Error) : undefined
    if (!options.observer) {
      domain.authority!.on('data', (chunk) => {
        buffer += chunk.toString()
        for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
          const event = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); events.push(event)
          if (event.state === 'authorized' && options.acknowledge !== false) {
            callback = (async () => {
              await options.onAuthorized?.()
              domain.authority!.write(`${JSON.stringify({ version: 1, operationId, state: 'execute' })}\n`)
            })()
          }
        }
      })
    }
    await domain.processId
    return { domain, events, observed, output: () => ({ stdout, stderr, events }), async completed() { const code = await domain.completed; await callback; return { code, stdout, stderr, events } } }
  }
  return { state, marker, script, workspace, privateRoot, root, helper, executable, origin, auth, launch }
}

describe('ape-shell machine native boundary', () => {
  it.each(['approved', 'denied'])('forwards an external application wrapper to the actual program with an %s decision', async (answer) => {
    const setup = await fixture('console.log("external-forwarded")'); setup.state.answer = answer
    const podId = randomUUID(); const applicationId = randomUUID()
    const marker = join(setup.root, 'pods', podId, 'workspace', 'marker')
    await writeFile(setup.script, (await readFile(setup.script, 'utf8')).replace(setup.marker, marker))
    const credentials = new CredentialCache(join(setup.root, 'credentials'), { available: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
    const stateId = await new ProgramState(credentials).create({ podId, applicationId })
    const scriptHash = digest(await readFile(setup.script)); const executableHash = digest(await readFile(setup.executable))
    const configuration = { type: 'program', name: 'Fixture', cliId: 'fixture', executable: setup.script, executableHash: scriptHash, entryFiles: [{ path: setup.script, hash: scriptHash }], runtime: { executable: setup.executable, executableHash, arguments: [setup.script], readDirectories: [], environment: {}, descriptor: { path: setup.script, hash: scriptHash } }, networkHosts: [], environment: {}, stateId, capability: 'tool.fixture' }
    const connection = { issuer: setup.origin, subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'pod-key', targetHost: 'fixture-mac', accessToken: async () => 'SYNTHETIC_ONLY' }
    const shell = new ExternalShell(podId, setup.root, { executable: setup.executable, cli: resolve('dist/vendor/apes/ape-shell.mjs'), client: resolve('dist/runtime/shell-client.mjs') }, { epoch: 1, resources: [{ id: applicationId, podId, revision: 1, kind: 'tool', state: 'ready', name: 'Fixture', configuration }] }, credentials, { podConnection: async () => connection } as never, async () => {}, async () => {}, 'isolated')
    try {
      await shell.ready
      const run = promisify(execFile)('/bin/sh', [join(setup.root, 'shell-launchers', podId, 'bin/fixture'), 'literal; value'], { env: { PATH: '/usr/bin:/bin' }, timeout: 10000 })
      if (answer === 'approved') expect((await run).stdout).toContain('external-forwarded')
      else await expect(run).rejects.toThrow()
      expect(existsSync(marker)).toBe(answer === 'approved')
      expect(setup.state.calls).toHaveLength(1)
      expect(setup.state.calls[0]!.argv).toEqual([setup.script, 'literal; value'])
      expect(setup.state.calls[0]!.files).toContainEqual({ path: setup.script, sha256: scriptHash })
    }
    finally { shell.close(); await shell.completed }
  })

  it.each(['approved', 'denied'])('validates a user script only after the shared %s decision', async (answer) => {
    const setup = await fixture(); setup.state.answer = answer
    const store = new PodDatabase(join(setup.root, 'validation-store'))
    const pod = store.createPod({ name: 'Synthetic validation' }); const resources = new ResourceRegistry(store, () => {})
    const draftId = randomUUID(); let closed = false
    store.db.prepare('INSERT INTO script_drafts VALUES(?,?,?,?,?,?,NULL,NULL)').run(draftId, pod.id, 1, pod.bindingRevision, 'export async function run(){ return {status:"completed",summary:"Validated through ape-shell",completedInputIds:[],gapIds:[]} }', '[]')
    const runtime = { helper: setup.helper, executable: setup.executable, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [], environment: {}, binary: '', catalog: '', sdkHost: '', manifest: resolve('dist/vendor/manifest.json'), prepareExecution: async () => ({ machine: { runtime: { executable: setup.executable, cli: resolve('dist/vendor/apes/ape-shell.mjs'), environment: { APES_AUTH_FILE: setup.auth } }, targetHost: 'fixture-mac', waitMs: 0 }, close: async () => { closed = true } }) }
    try {
      const validate = validateDraft(store, resources, runtime, draftId, 1, AbortSignal.timeout(10000))
      if (answer === 'approved') expect(await validate).toMatchObject({ status: 'completed' })
      else await expect(validate).rejects.toThrow()
      expect(closed).toBe(true)
      expect(setup.state.calls).toHaveLength(1)
      expect(setup.state.calls[0]!.files).toHaveLength(2)
      expect(store.db.prepare('SELECT count(*) AS n FROM validations').get()!.n).toBe(answer === 'approved' ? 1 : 0)
    }
    finally { store.close() }
  })

  it('reuses one content-bound script invocation while carrying changing run data over FD 3', async () => {
    const setup = await fixture()
    const source = `import fs from 'node:fs'; export async function run(context) { fs.writeFileSync(${JSON.stringify(setup.marker)}, context.variables.value); return { status: 'completed', summary: context.variables.value, completedInputIds: [], gapIds: [] }; }`
    await writeFile(setup.script, source)
    const entry = resolve('dist/runtime/script-entry.mjs')
    const runtime = {
      executable: setup.executable,
      helper: setup.helper,
      entry,
      runtimeDirectories: [],
      environment: {},
      machine: {
        runtime: { executable: setup.executable, cli: resolve('dist/vendor/apes/ape-shell.mjs'), environment: { APES_AUTH_FILE: setup.auth, HOME: setup.privateRoot } },
        targetHost: 'fixture-mac',
        waitMs: 0,
      },
    }
    const input = (value: string): RunInput => ({ version: 1, runId: randomUUID(), podId: randomUUID(), scriptHash: digest(source), assignmentRevision: 1, reason: 'manual', eventIds: [], checkpointRevision: 0, checkpoint: {}, resourceEpoch: 0, workspace: setup.workspace, home: setup.workspace, references: [], variables: { value }, limits: { timeMs: 10000, frameBytes: 256 * 1024 } })
    for (const value of ['first run', 'second run']) {
      const run = input(value); const directory = join(setup.privateRoot, 'runs', run.runId)
      expect(await executeScript(runtime, directory, setup.script, run, AbortSignal.timeout(10000), { execution: { authorized: async () => {} }, event: () => {}, request: async () => { throw new Error('Unexpected service') } })).toMatchObject({ status: 'completed', summary: value })
      expect(await readFile(setup.marker, 'utf8')).toBe(value)
      expect(existsSync(join(directory, 'input.json'))).toBe(false)
    }
    expect(setup.state.calls).toHaveLength(2)
    expect(setup.state.calls[0]!.argv).toEqual(setup.state.calls[1]!.argv)
    expect(setup.state.calls[0]!.files).toEqual(setup.state.calls[1]!.files)
    expect(setup.state.calls[0]!.files).toContainEqual({ path: expect.stringContaining('/script-artifacts/'), sha256: digest(source) })
  })

  it('confines an isolated parser to its pinned input, without the Pod workspace or identity', async () => {
    const setup = await fixture()
    const source = join(setup.workspace, 'source.json'); await writeFile(source, 'SYNTHETIC_SOURCE')
    const hidden = join(setup.workspace, 'unassigned.json'); await writeFile(hidden, 'UNRELATED_DATA')
    await writeFile(setup.script, `import fs from 'node:fs'; const source=fs.readFileSync(process.argv[2],'utf8'); let outside=false; try { fs.readFileSync(${JSON.stringify(hidden)}); outside=true } catch {} console.log(JSON.stringify({source,outside,identity:process.env.APES_AUTH_FILE??null}));`)
    const executableHash = digest(await readFile(setup.executable))
    const broker = new PodToolBroker(setup.helper, setup.privateRoot, { runtime: { executable: setup.executable, cli: resolve('dist/vendor/apes/ape-shell.mjs') }, operationId: randomUUID(), targetHost: 'fixture-mac', observer: { authorized: async () => {} } }, undefined as never)
    const assignment = { id: 'fixture-parser', capability: 'tool.fixture', program: { path: setup.executable, name: 'node', sha256: executableHash }, executable: setup.executable, executableHash, argv: [source], prefix: [setup.script], entryFiles: [{ path: setup.script, hash: digest(await readFile(setup.script)) }], runtimeDirectories: [], environment: {}, networkPorts: [], isolation: 'temporary' as const, inputFiles: [{ path: source, sha256: digest(await readFile(source)) }], timeoutMs: 15000, identityConnection: { issuer: setup.origin, subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'pod-key', targetHost: 'fixture-mac', accessToken: async () => 'SYNTHETIC_ONLY' } }
    const lease = { workspace: setup.workspace, capabilities: ['tool.fixture'], assertCurrent: () => {}, signal: AbortSignal.timeout(10000) }
    const reply = await broker.execute(assignment, { toolId: 'fixture-parser', argv: [source] }, lease)
    expect(reply.exitCode).toBe(0); expect(JSON.parse(reply.stdout)).toEqual({ source: 'SYNTHETIC_SOURCE', outside: false, identity: null })
    expect(setup.state.calls[0]!.files).toContainEqual(assignment.inputFiles[0])
    await expect(broker.execute({ ...assignment, inputFiles: [{ path: setup.auth, sha256: digest(await readFile(setup.auth)) }] }, { toolId: 'fixture-parser', argv: [source] }, lease)).rejects.toThrow('outside assigned')
    expect(setup.state.calls).toHaveLength(1)
  })

  it('returns bounded large output as a hashed workspace artifact instead of an oversized service frame', async () => {
    const setup = await fixture('process.stdout.write(JSON.stringify({body:"x".repeat(300000)}))')
    const executableHash = digest(await readFile(setup.executable))
    const broker = new PodToolBroker(setup.helper, setup.privateRoot, { runtime: { executable: setup.executable, cli: resolve('dist/vendor/apes/ape-shell.mjs') }, operationId: randomUUID(), targetHost: 'fixture-mac', observer: { authorized: async () => {} } }, undefined as never)
    const assignment = { id: 'fixture-app', capability: 'tool.fixture', program: { path: setup.executable, name: 'node', sha256: executableHash }, executable: setup.executable, executableHash, argv: [], prefix: [setup.script], entryFiles: [{ path: setup.script, hash: digest(await readFile(setup.script)) }], runtimeDirectories: [], environment: {}, networkPorts: [], stdoutArtifact: true, maxOutputBytes: 32 * 1024 * 1024, identityConnection: { issuer: setup.origin, subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'pod-key', targetHost: 'fixture-mac', accessToken: async () => 'SYNTHETIC_ONLY' } }
    const reply = await broker.execute(assignment, { toolId: 'fixture-app', argv: [] }, { workspace: setup.workspace, capabilities: ['tool.fixture'], assertCurrent: () => {}, signal: AbortSignal.timeout(10000) })
    expect(reply.exitCode).toBe(0); expect(reply.stdout).toBe(''); expect(JSON.stringify(reply).length).toBeLessThan(2048)
    const artifact = reply.stdoutArtifact!
    const bytes = await readFile(artifact.path)
    expect(bytes.length).toBe(artifact.bytes); expect(digest(bytes)).toBe(artifact.sha256)
    expect(JSON.parse(bytes.toString()).body).toHaveLength(300000)
  })

  it('runs assigned application arguments through ape-shell and refuses before the effect journal on denial', async () => {
    for (const answer of ['approved', 'denied']) {
      const setup = await fixture('console.log("assigned-program")')
      setup.state.answer = answer
      const executableHash = digest(await readFile(setup.executable))
      let authorized = false
      const broker = new PodToolBroker(setup.helper, setup.privateRoot, {
        runtime: { executable: setup.executable, cli: resolve('dist/vendor/apes/ape-shell.mjs') },
        operationId: randomUUID(),
        targetHost: 'fixture-mac',
        observer: { authorized: async () => { authorized = true; expect(existsSync(setup.marker)).toBe(false) } },
      }, undefined as never)
      const argv = ['empty argument', '', 'literal; punctuation']
      const call = broker.execute({
        id: 'fixture-app',
        capability: 'tool.fixture',
        program: { path: setup.executable, name: 'node', sha256: executableHash },
        executable: setup.executable,
        executableHash,
        argv,
        prefix: [setup.script],
        entryFiles: [{ path: setup.script, hash: digest(await readFile(setup.script)) }],
        runtimeDirectories: [],
        environment: {},
        networkPorts: [],
        identityConnection: { issuer: setup.origin, subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'pod-key', targetHost: 'fixture-mac', accessToken: async () => 'SYNTHETIC_ONLY' },
      }, { toolId: 'fixture-app', argv }, { workspace: setup.workspace, capabilities: ['tool.fixture'], assertCurrent: () => {}, signal: AbortSignal.timeout(10000) })
      if (answer === 'approved') expect(await call).toMatchObject({ exitCode: 0, stdout: expect.stringContaining('assigned-program') })
      else await expect(call).rejects.toThrow()
      expect(authorized).toBe(answer === 'approved')
      expect(existsSync(setup.marker)).toBe(answer === 'approved')
      expect(setup.state.requests).toContain('/api/grants/authorize')
    }
  })

  it('returns an asynchronous IdP decision without acknowledging execution or recording an effect', async () => {
    const setup = await fixture(); setup.state.answer = 'pending'
    let recorded = false
    const run = await setup.launch({ observer: { authorized: async () => { recorded = true } } })
    expect(await run.observed).toMatchObject({ kind: 'pending', exitCode: 75, grantId: 'grant' })
    await run.completed()
    expect(recorded).toBe(false)
    expect(existsSync(setup.marker)).toBe(false)
  })

  it('uses the packaged Electron runtime, ape-shell and native supervisor with exact script content', async () => {
    const setup = await fixture('console.log("packaged-target")', true)
    const run = await setup.launch({ observer: { authorized: async (value) => { expect(value.write).toBe(true) } } })
    expect(await run.observed).toEqual({ kind: 'completed', exitCode: 0 })
    const result = await run.completed()
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('packaged-target')
    expect(existsSync(setup.marker)).toBe(true)
  })

  it('persists write intent before dispatch and retains an interrupted effect across journal reopen', async () => {
    const setup = await fixture('setInterval(()=>{},1000)')
    const journal = join(setup.root, 'journal')
    let store = new PodDatabase(journal)
    try {
      const resources = new ResourceRegistry(store, () => {})
      const pod = store.createPod({ name: 'Machine effect fixture' })
      installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
      const active = new RunStore(store).reserve(pod.id, store.getPod(pod.id).activeScript!, 0).run
      const ledger = new EffectLedger(store)
      const input = { argv: [setup.script] }; const key = 'program:fixture'
      const run = await setup.launch({
        observer: {
          authorized: async (value) => { expect(value.write).toBe(true); expect(ledger.begin(pod.id, active.id, key, 'program.call', input).execute).toBe(true) },
          starting: () => { expect(store.db.prepare('SELECT state FROM effect_ledger WHERE effect_key=?').get(key)?.state).toBe('intent') },
        },
      })
      await expect.poll(() => existsSync(setup.marker)).toBe(true)
      run.domain.cancel()
      expect(await run.observed).toBeInstanceOf(Error)
      await run.completed()
      ledger.markUnknown(pod.id, key)
      store.close(); store = new PodDatabase(journal)
      expect(() => new EffectLedger(store).begin(pod.id, active.id, key, 'program.call', input)).toThrow('unknown')
    }
    finally { store.close() }
  })

  it('leaves the target unstarted when recording the effect intent fails', async () => {
    const setup = await fixture()
    const run = await setup.launch({ observer: { authorized: async () => { throw new Error('Synthetic journal unavailable') } } })
    expect(await run.observed).toMatchObject({ message: 'Synthetic journal unavailable' })
    await run.completed()
    expect(existsSync(setup.marker)).toBe(false)
  })

  it('runs once inside the sandbox and keeps target output separate from execution receipts', async () => {
    const setup = await fixture(`let controlClosed=false; try { fs.writeSync(6,'forged') } catch { controlClosed=true }; let identityClosed=false; try { fs.readFileSync(new URL('./private/auth.json',import.meta.url)) } catch { identityClosed=true }; console.log(JSON.stringify({state:'authorized',write:false,controlClosed,identityClosed}));`)
    setup.state.grantType = 'once'
    const run = await setup.launch()
    const result = await run.completed()
    expect(result.code, result.stderr).toBe(0)
    expect(setup.state.consumes).toBe(1)
    expect(existsSync(setup.marker)).toBe(true)
    expect(JSON.parse(result.stdout)).toEqual({ state: 'authorized', write: false, controlClosed: true, identityClosed: true })
    expect(result.events.map(event => event.state)).toEqual(['authorized', 'starting', 'started', 'completed'])
    expect(result.events[0]).toMatchObject({ write: true })
    expect(setup.state.requests).not.toContain('/api/grants')
    const repeated = await (await setup.launch()).completed()
    expect(repeated.code).not.toBe(0)
    expect(repeated.events.map(event => event.state)).toEqual(['not-started'])
  })

  it.each(['denied', 'revoked', 'pending'])('leaves no process marker when the IdP answers %s', async (answer) => {
    const setup = await fixture(); setup.state.answer = answer
    const result = await (await setup.launch()).completed()
    expect(result.code).not.toBe(0)
    expect(existsSync(setup.marker)).toBe(false)
    expect(result.events.some(event => event.state === 'started')).toBe(false)
  })

  it('refuses a timed-out decision and foreign command tokens before dispatch', async () => {
    const setup = await fixture(); setup.state.answer = 'pending'
    const expired = await (await setup.launch({ waitMs: 10 })).completed()
    expect(expired.events.at(-1)).toMatchObject({ state: 'not-started' })
    setup.state.answer = 'approved'; setup.state.subject = 'other@example.test'
    const foreign = await (await setup.launch()).completed()
    expect(foreign.events.at(-1)).toMatchObject({ state: 'not-started' })
    expect(existsSync(setup.marker)).toBe(false)
  })

  it('preserves empty, Unicode and shell punctuation arguments as literal data', async () => {
    const setup = await fixture()
    const args = ['', 'Grüße 日本語', '$(touch forbidden)', 'a\nb', '; false', '--as', 'root']
    const result = await (await setup.launch({ argv: [setup.script, ...args] })).completed()
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([setup.script, ...args])
    expect(existsSync(join(setup.workspace, 'forbidden'))).toBe(false)
  })

  it('executes approved inline Node code and refuses a token for different inline code', async () => {
    const setup = await fixture()
    const code = `require('fs').writeFileSync(${JSON.stringify(setup.marker)}, String(2 + 2))`
    const result = await (await setup.launch({ argv: ['-e', code] })).completed()
    expect(result.code, result.stderr).toBe(0)
    expect(await readFile(setup.marker, 'utf8')).toBe('4')
    await rm(setup.marker)
    setup.state.argvHash = await computeArgvHash(['node', '-e', code])
    const changed = await (await setup.launch({ argv: ['-e', code.replace('2 + 2', '3 + 3')] })).completed()
    expect(changed.events.at(-1)).toMatchObject({ state: 'not-started' })
    expect(existsSync(setup.marker)).toBe(false)
  })

  it('terminates same-group descendants and seals the domain after cancellation', async () => {
    const setup = await fixture(`import {spawn} from 'node:child_process'; const child=spawn(process.execPath,['-e',"require('fs').writeFileSync('child-started',String(process.pid));setInterval(()=>{},1000)"],{stdio:'inherit'}); child.on('error',error=>{throw error}); setInterval(()=>{},1000)`)
    const run = await setup.launch({ owner: true })
    await expect.poll(() => run.events.some(event => event.state === 'started')).toBe(true)
    try { await expect.poll(() => existsSync(join(setup.workspace, 'child-started'))).toBe(true) }
    catch { throw new Error(JSON.stringify(run.output())) }
    run.domain.cancel()
    const result = await run.completed()
    expect(result.code).not.toBe(0)
    await inspectDomainRecords([{ path: run.domain.recordPath, owner_pid: process.pid }], setup.privateRoot, setup.helper)
  })

  it('refuses script replacement after authorization and before the effect acknowledgement', async () => {
    const setup = await fixture()
    const result = await (await setup.launch({ onAuthorized: () => writeFile(setup.script, 'console.log("substituted")') })).completed()
    expect(result.code).not.toBe(0)
    expect(existsSync(setup.marker)).toBe(false)
    expect(result.events.map(event => event.state)).toEqual(['authorized', 'not-started'])
  })

  it('does not execute without the durable-effect acknowledgement', async () => {
    const setup = await fixture()
    const run = await setup.launch({ acknowledge: false })
    await expect.poll(() => run.events.some(event => event.state === 'authorized')).toBe(true)
    expect(existsSync(setup.marker)).toBe(false)
    run.domain.cancel()
    await run.completed()
    await inspectDomainRecords([{ path: run.domain.recordPath, owner_pid: process.pid }], setup.privateRoot, setup.helper)
  })

  it.each(['identity', 'grant'] as const)('preserves the terminal and terminates a running program when its %s is revoked', async (revoked) => {
    const setup = await fixture('console.log(process.stdout.isTTY); setInterval(()=>{}, 1000)')
    const run = await setup.launch({ terminal: true })
    await expect.poll(() => existsSync(setup.marker)).toBe(true)
    if (revoked === 'identity') setup.state.active = false
    else setup.state.grantActive = false
    const result = await run.completed()
    expect(result.code).not.toBe(0)
    expect(result.stdout).toContain('true')
    expect(result.events.at(-1)).toMatchObject({ state: 'unknown' })
    await inspectDomainRecords([{ path: run.domain.recordPath, owner_pid: process.pid }], setup.privateRoot, setup.helper)
  })
})

function pdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 20 150 Td (${text}) Tj ET`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let output = '%PDF-1.4\n'; const offsets = [0]
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = Buffer.byteLength(output)
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(output)
}
// The independently delivered parser is supplied explicitly by acceptance testing; it is never bundled in Pods.
it.skipIf(!process.env.PODS_EXTERNAL_MAIL_PARSER)('extracts PDF evidence with the pinned external parser through the packaged ape-shell broker', async () => {
  const setup = await fixture('', true)
  const entry = await realpath(process.env.PODS_EXTERNAL_MAIL_PARSER!)
  const worker = join(entry.slice(0, entry.lastIndexOf('/')), 'pdf.worker.mjs')
  const source = join(setup.workspace, 'source.json')
  await writeFile(source, JSON.stringify({ data: { contentType: 'application/pdf', contentBytes: pdf('Delivery is June 8.').toString('base64') } }))
  const executableHash = digest(await readFile(setup.executable))
  const argv = [source, digest(await readFile(source)), worker, digest(await readFile(worker))]
  const broker = new PodToolBroker(setup.helper, setup.privateRoot, { runtime: { executable: setup.executable, cli: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/Resources/apes/ape-shell.mjs') }, operationId: randomUUID(), targetHost: 'fixture-mac', observer: { authorized: async () => {} } }, undefined as never)
  const assignment = { id: 'external-parser', capability: 'tool.fixture', program: { path: setup.executable, name: 'node', sha256: executableHash }, executable: setup.executable, executableHash, argv, prefix: ['--max-old-space-size=192', entry], entryFiles: [{ path: entry, hash: digest(await readFile(entry)) }, { path: worker, hash: digest(await readFile(worker)) }], runtimeDirectories: [resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/Frameworks')], environment: { ELECTRON_RUN_AS_NODE: '1' }, networkPorts: [], isolation: 'temporary' as const, inputFiles: [{ path: source, sha256: digest(await readFile(source)) }], timeoutMs: 15000, identityConnection: { issuer: setup.origin, subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'pod-key', targetHost: 'fixture-mac', accessToken: async () => 'SYNTHETIC_ONLY' } }
  const reply = await broker.execute(assignment, { toolId: 'external-parser', argv }, { workspace: setup.workspace, capabilities: ['tool.fixture'], assertCurrent: () => {}, signal: AbortSignal.timeout(20000) })
  expect(reply.exitCode, reply.stderr).toBe(0)
  const result = JSON.parse(reply.stdout)
  expect(result.text).toContain('Delivery is June 8.')
  expect(result.gap).toBeNull()
  expect(setup.state.calls[0]!.files).toEqual(expect.arrayContaining(assignment.entryFiles.map(file => ({ path: file.path, sha256: file.hash }))))
})

it.each(['pending', 'denied'])('returns a verified %s reply without dispatch or a write intent', async (answer) => {
  const setup = await fixture(); setup.state.answer = answer
  const executableHash = digest(await readFile(setup.executable)); let authorized = 0
  const broker = new PodToolBroker(setup.helper, setup.privateRoot, { runtime: { executable: setup.executable, cli: resolve('dist/vendor/apes/ape-shell.mjs') }, operationId: randomUUID(), targetHost: 'fixture-mac', observer: { authorized: async () => { authorized++ } } }, undefined as never)
  const assignment = { id: 'fixture-app', capability: 'tool.fixture', program: { path: setup.executable, name: 'node', sha256: executableHash }, executable: setup.executable, executableHash, argv: [], prefix: [setup.script], entryFiles: [{ path: setup.script, hash: digest(await readFile(setup.script)) }], runtimeDirectories: [], environment: {}, networkPorts: [], approvalWaitMs: 0, identityConnection: { issuer: setup.origin, subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'pod-key', targetHost: 'fixture-mac', accessToken: async () => 'SYNTHETIC_ONLY' } }
  const reply = await broker.execute(assignment, { toolId: 'fixture-app', argv: [] }, { workspace: setup.workspace, capabilities: ['tool.fixture'], assertCurrent: () => {}, signal: AbortSignal.timeout(10000) })
  expect(reply.exitCode).toBe(answer === 'pending' ? 75 : 126)
  expect(answer === 'pending' ? reply.pending?.grantId : reply.refusal?.reason).toBeTruthy()
  expect(authorized).toBe(0); expect(existsSync(setup.marker)).toBe(false)
})

it.each(['approved', 'denied'])('prepares dependencies through ape-shell with immutable package inputs (%s)', async (answer) => {
  const { installPackages } = await import('../src/worker/dependencies/install')
  const setup = await fixture(); setup.state.answer = answer
  const stage = join(setup.root, 'dependencies'); await mkdir(stage)
  const runtime = { helper: setup.helper, executable: setup.executable, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [], environment: {}, machine: { runtime: { executable: setup.executable, cli: resolve('dist/vendor/apes/ape-shell.mjs'), environment: { APES_AUTH_FILE: setup.auth } }, targetHost: 'fixture-mac', waitMs: 0 } }
  const operation = installPackages(runtime, stage, { dependencies: {} }, AbortSignal.timeout(20000), () => {})
  if (answer === 'denied') { await expect(operation).rejects.toThrow(/denied|refused/); expect(existsSync(join(stage, 'project/package-lock.json'))).toBe(false) }
  else {
    const project = await operation
    expect(JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8')).lockfileVersion).toBe(3)
    expect(setup.state.calls).toHaveLength(2)
    for (const call of setup.state.calls) { expect(call.argv).toContain('--ignore-scripts'); expect(call.argv).toContain('--bin-links=false'); expect(call.files).toEqual(expect.arrayContaining([{ path: join(project, 'package.json'), sha256: digest(await readFile(join(project, 'package.json'))) }])) }
    expect(setup.state.calls[1]!.files).toEqual(expect.arrayContaining([{ path: join(project, 'package-lock.json'), sha256: digest(await readFile(join(project, 'package-lock.json'))) }]))
  }
})
