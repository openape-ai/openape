import { createHash, randomUUID } from 'node:crypto'
import fs, { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportPublicKeyJWK, generateKeyPair, signJWT } from '@openape/core'
import { computeArgvHash } from '@openape/grants'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// `apes run` against a faithful fake of `POST /api/grants/authorize` (issue 1473,
// revision 4 contract): real HTTP, real EdDSA command tokens checked against the
// fake's JWKS, and a real program file whose execution leaves a marker. HOME is a
// temporary directory, so the real ~/.config/apes and ~/.openape are never used.

const home = mkdtempSync(join(tmpdir(), 'apes-program-auth-'))
const bin = join(home, 'bin')
const marker = join(home, 'ran.txt')
const savedEnv = { ...process.env }
process.env.HOME = home
process.env.PATH = `${bin}:${process.env.PATH ?? ''}`
process.env.APES_TARGET_HOST = 'test-host'
process.env.APES_USER = 'human'
process.env.APES_QUIET_WAIT = '1'
process.env.APES_TEST_MARKER = marker
for (const name of ['APES_AUTH_FILE', 'APES_IDP', 'APE_WAIT', 'APES_IGNORE_USER_CONFIG', 'APES_SHELL_CHANNEL_FD', 'NODE_OPTIONS'])
  delete process.env[name]

const SUBJECT = 'agent@example.com'
const ACCESS_TOKEN = 'agent-access-token'
const programPath = join(bin, 'fakegit')

function writeProgram(body = 'printf \'%s\\n\' "$@" > "$APES_TEST_MARKER"\n'): string {
  writeFileSync(programPath, `#!/bin/sh\n${body}`)
  chmodSync(programPath, 0o755)
  return createHash('sha256').update(readFileSync(programPath)).digest('hex')
}

interface FakeGrant {
  files?: { path: string, sha256: string }[]
  id: string
  status: 'pending' | 'approved' | 'denied' | 'revoked' | 'used' | 'withdrawn'
  grantType: 'once' | 'always'
  argvHash: string
  executionArgv: string[]
  programSha256: string
  targetHost: string
}

type SigningKey = Parameters<typeof signJWT>[1]

const ALLOWED_FIELDS = new Set(['target_host', 'audience', 'program', 'argv', 'files', 'grant_type', 'summary', 'batch', 'reference'])

/** Exact-command semantics of the contract (a program without a registry shape). */
class FakeIdp {
  issuer = ''
  grants: FakeGrant[] = []
  authorizeBodies: Record<string, unknown>[] = []
  claimOverrides: Record<string, unknown> = {}
  signWithForeignKey = false
  consumed: string[] = []
  /** Replaces the consume answer, e.g. a grant consumed elsewhere in the meantime. */
  consumeAnswer: Record<string, unknown> | null = null
  /** Called on every `GET /api/grants/{id}`; tests decide pending requests here. */
  onPoll: (grant: FakeGrant) => void = () => {}
  private server!: Server
  private key!: SigningKey
  private foreignKey!: SigningKey
  private jwk!: Record<string, unknown>

  async start(): Promise<void> {
    const pair = await generateKeyPair()
    this.key = pair.privateKey
    this.foreignKey = (await generateKeyPair()).privateKey
    this.jwk = await exportPublicKeyJWK(pair.publicKey, 'fake-key') as Record<string, unknown>
    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error: unknown) => this.send(response, 500, { title: String(error) }))
    })
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    await new Promise(resolve => this.server.close(resolve))
  }

  reset(): void {
    this.grants = []
    this.authorizeBodies = []
    this.claimOverrides = {}
    this.signWithForeignKey = false
    this.consumed = []
    this.consumeAnswer = null
    this.onPoll = () => {}
  }

  approved(executionArgv: string[], programSha256: string, grantType: 'once' | 'always' = 'always'): Promise<FakeGrant> {
    return this.add(executionArgv, programSha256, 'approved', grantType)
  }

  async add(executionArgv: string[], programSha256: string, status: FakeGrant['status'], grantType: 'once' | 'always' = 'always'): Promise<FakeGrant> {
    const grant: FakeGrant = { id: `grant-${this.grants.length + 1}`, status, grantType, argvHash: await computeArgvHash(executionArgv), executionArgv, programSha256, targetHost: 'test-host' }
    this.grants.push(grant)
    return grant
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' })
    response.end(JSON.stringify(body))
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', this.issuer)
    if (url.pathname === '/.well-known/jwks.json') return this.send(response, 200, { keys: [this.jwk] })
    if (url.pathname === '/.well-known/openid-configuration')
      return this.send(response, 200, { issuer: this.issuer, jwks_uri: `${this.issuer}/.well-known/jwks.json`, openape_grant_reference_supported: true, openape_grants_endpoint: `${this.issuer}/api/grants`, openape_program_authorization_endpoint: `${this.issuer}/api/grants/authorize` })
    const consumed = this.grants.find(candidate => url.pathname === `/api/grants/${candidate.id}/consume`)
    if (request.method === 'POST' && consumed) return this.consume(consumed, request, response)
    if (request.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) return this.send(response, 401, { title: 'Unauthorized' })
    if (request.method === 'POST' && url.pathname === '/api/grants/authorize') return this.authorize(request, response)
    const grant = this.grants.find(candidate => url.pathname === `/api/grants/${candidate.id}`)
    if (request.method === 'GET' && grant) {
      this.onPoll(grant)
      return this.send(response, 200, { id: grant.id, status: grant.status, request: { audience: 'shapes', target_host: grant.targetHost, execution_context: { argv: grant.executionArgv, argv_hash: grant.argvHash, program_sha256: grant.programSha256 } } })
    }
    return this.send(response, 404, { title: 'Not found' })
  }

  /** Single use is enforced here, as on the IdP: the token holder consumes the grant. */
  private consume(grant: FakeGrant, request: IncomingMessage, response: ServerResponse): void {
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { grant_id?: string }
    if (claims.grant_id !== grant.id) return this.send(response, 400, { title: 'Grant ID in token does not match URL' })
    this.consumed.push(grant.id)
    if (this.consumeAnswer) return this.send(response, 200, this.consumeAnswer)
    if (grant.status === 'used') return this.send(response, 200, { error: 'already_consumed', status: 'used' })
    if (grant.grantType === 'once') grant.status = 'used'
    return this.send(response, 200, { status: grant.grantType === 'once' ? 'consumed' : 'valid' })
  }

  private async authorize(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw) as Record<string, unknown>
    this.authorizeBodies.push(body)
    const program = body.program as { name?: unknown, sha256?: unknown } | undefined
    const argv = body.argv as unknown[]
    if (Object.keys(body).some(field => !ALLOWED_FIELDS.has(field)) || body.audience !== 'shapes'
      || typeof program?.name !== 'string' || typeof program.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(program.sha256)
      || !Array.isArray(argv) || argv.length > 256 || argv.some(argument => typeof argument !== 'string' || argument.includes('\0'))
      || !['once', 'always', undefined].includes(body.grant_type as string)) {
      return this.send(response, 400, { title: 'Invalid authorization request' })
    }

    const executionArgv = [program.name, ...argv as string[]]
    const argvHash = await computeArgvHash(executionArgv)
    const mine = this.grants.filter(grant => grant.argvHash === argvHash && grant.targetHost === body.target_host && JSON.stringify(grant.files ?? []) === JSON.stringify(body.files ?? []))
    const covering = mine.find(grant => grant.status === 'approved')
    if (covering) {
      const now = Math.floor(Date.now() / 1000)
      const claims = {
        iss: this.issuer,
        sub: SUBJECT,
        aud: 'shapes',
        target_host: body.target_host,
        iat: now,
        exp: now + 300,
        jti: randomUUID(),
        grant_id: covering.id,
        grant_type: covering.grantType,
        approval: covering.grantType,
        argv_hash: argvHash,
        program_sha256: program.sha256,
        execution_context: { argv: executionArgv, argv_hash: argvHash, program_sha256: program.sha256, version_tested: false, ...(covering.files ? { files: covering.files } : {}) },
        ...this.claimOverrides,
      }
      const authzJwt = await signJWT(claims, this.signWithForeignKey ? this.foreignKey : this.key, { kid: 'fake-key' })
      return this.send(response, 200, { state: 'approved', grant_id: covering.id, authz_jwt: authzJwt, expires_at: claims.exp })
    }
    const latest = mine.at(-1)
    if (latest?.status === 'denied' || latest?.status === 'revoked' || latest?.status === 'withdrawn')
      return this.send(response, 403, { type: `https://openape.org/errors/grant_${latest.status}`, title: `Grant ${latest.status}`, status: 403, state: latest.status, grant_id: latest.id })
    const pending = latest?.status === 'pending' ? latest : await this.add(executionArgv, program.sha256, 'pending', (body.grant_type as 'once' | 'always' | undefined) ?? 'always')
    pending.files = body.files as FakeGrant['files']
    return this.send(response, 202, { state: 'pending', grant_id: pending.id, approval_url: `${this.issuer}/grant-approval?grant_id=${pending.id}` })
  }
}

const idp = new FakeIdp()

/** Records every path below ~/.openape that this process touches through node:fs, including in dependencies. */
const openapePaths: string[] = []
const restoreFs: Array<() => void> = []
function trackOpenapeReads(): void {
  const watched = join(home, '.openape')
  const wrap = (target: Record<string, unknown>, name: string) => {
    const original = target[name] as (...args: unknown[]) => unknown
    target[name] = function (this: unknown, ...args: unknown[]) {
      if (typeof args[0] === 'string' && args[0].startsWith(watched)) openapePaths.push(args[0])
      return original.apply(this, args)
    }
    restoreFs.push(() => { target[name] = original })
  }
  for (const name of ['readFileSync', 'readFile', 'existsSync', 'statSync', 'lstatSync', 'accessSync', 'readdirSync', 'readdir', 'openSync', 'open', 'createReadStream', 'realpathSync'])
    wrap(fs as unknown as Record<string, unknown>, name)
  for (const name of ['readFile', 'readdir', 'open', 'stat', 'access'])
    wrap(fs.promises as unknown as Record<string, unknown>, name)
  syncBuiltinESMExports()
}

beforeAll(async () => {
  mkdirSync(bin, { recursive: true })
  await idp.start()
  mkdirSync(join(home, '.config', 'apes'), { recursive: true })
  writeFileSync(join(home, '.config', 'apes', 'auth.json'), JSON.stringify({ idp: idp.issuer, access_token: ACCESS_TOKEN, email: SUBJECT, expires_at: Math.floor(Date.now() / 1000) + 3600 }))
  // A locally installed adapter that the old resolution path would have read.
  mkdirSync(join(home, '.openape', 'shapes', 'adapters'), { recursive: true })
  writeFileSync(join(home, '.openape', 'shapes', 'adapters', 'fakegit.toml'), '[cli]\nid = "fakegit"\nexecutable = "fakegit"\n')
  trackOpenapeReads()
})

beforeEach(async () => {
  idp.reset()
  rmSync(marker, { force: true })
  openapePaths.length = 0
  const { clearProgramTokenCache } = await import('../src/authorization/program.js')
  clearProgramTokenCache()
})

afterEach(() => {
  vi.restoreAllMocks()
  writeFileSync(join(home, '.config', 'apes', 'auth.json'), JSON.stringify({ idp: idp.issuer, access_token: ACCESS_TOKEN, email: SUBJECT, expires_at: Math.floor(Date.now() / 1000) + 3600 }))
})

afterAll(async () => {
  for (const restore of restoreFs) restore()
  syncBuiltinESMExports()
  await idp.stop()
  process.env = savedEnv
  rmSync(home, { recursive: true, force: true })
})

async function apesRun(argv: string[], options: { wait?: boolean, approval?: string, reference?: string } = {}): Promise<void> {
  const { runCommand } = await import('../src/commands/run.js')
  await runCommand.run!({
    rawArgs: ['run', ...(options.wait ? ['--wait'] : []), '--', ...argv],
    args: { shell: false, wait: options.wait ?? false, approval: options.approval ?? 'once', reference: options.reference },
  } as never)
}

async function exactShell(command: string[]): Promise<void> {
  const { rewriteApeShellArgs } = await import('../src/ape-shell.js')
  const rewritten = rewriteApeShellArgs([process.execPath, 'ape-shell', '-c', '--', ...command])
  if (rewritten?.action !== 'rewrite') throw new Error('Exact shell request was not recognized')
  const { runCommand } = await import('../src/commands/run.js')
  await runCommand.run!({ rawArgs: rewritten.argv.slice(2), args: { shell: false, wait: false, approval: 'once' } } as never)
}

function ran(): string[] | null {
  return existsSync(marker) ? readFileSync(marker, 'utf-8').trimEnd().split('\n') : null
}

describe('apes run with per-call IdP authorization', () => {
  it('passes an opaque reference as metadata while retaining the exact command', async () => {
    writeProgram()
    await expect(apesRun(['fakegit', 'status'], { reference: 'document-42/export:v1' })).rejects.toMatchObject({ exitCode: 75 })
    expect(idp.authorizeBodies[0]).toMatchObject({ reference: 'document-42/export:v1', argv: ['status'], grant_type: 'once' })
    expect(existsSync(marker)).toBe(false)
  })

  it('checks the broker owner and key from the managed identity, including cached calls', async () => {
    const brokered = { connection_id: 'connection-1', broker_issuer: 'https://provider.test', agent_issuer: 'https://provider.test', owner: 'owner@example.com', key_id: 'key-1' }
    const auth = { idp: idp.issuer, decision_issuer: idp.issuer, brokered, access_token: ACCESS_TOKEN, email: SUBJECT, expires_at: Math.floor(Date.now() / 1000) + 3600 }
    writeFileSync(join(home, '.config', 'apes', 'auth.json'), JSON.stringify(auth))
    const sha256 = writeProgram()
    await idp.approved(['fakegit', 'status'], sha256)
    idp.claimOverrides = { brokered, decided_by: brokered.owner }
    await exactShell(['fakegit', 'status'])
    expect(ran()).toEqual(['status'])
    rmSync(marker)
    writeFileSync(join(home, '.config', 'apes', 'auth.json'), JSON.stringify({ ...auth, brokered: { ...brokered, key_id: 'key-2' } }))
    await expect(exactShell(['fakegit', 'status'])).rejects.toThrow('brokered owner identity')
    expect(ran()).toBeNull()
  })

  it('binds preloaded code even when its option follows inline code', async () => {
    const { locateProgram } = await import('../src/authorization/program.js')
    const { nodeProgramFiles, assertProgramFiles } = await import('../src/authorization/program-files.js')
    const program = await locateProgram(process.execPath)
    if (!program) throw new Error('Node executable is missing')
    const preload = join(home, 'preload.cjs')
    writeFileSync(preload, 'module.exports = 4')
    const files = nodeProgramFiles({ program, argv: ['-e', 'console.log(2 + 2)', '--require', preload] })
    expect(files).toHaveLength(1)
    writeFileSync(preload, 'module.exports = 5')
    expect(() => assertProgramFiles(files)).toThrow('changed after authorization')
  })

  it('does not replace an assigned script digest or authorize unbound stdin code', async () => {
    const { locateProgram, authorizeProgramCall } = await import('../src/authorization/program.js')
    const { nodeProgramFiles } = await import('../src/authorization/program-files.js')
    const program = await locateProgram(process.execPath)
    if (!program) throw new Error('Node executable is missing')
    const script = join(home, 'pinned.cjs'); writeFileSync(script, 'console.log(4)')
    await expect(authorizeProgramCall({ program, argv: [script], files: [{ path: script, sha256: 'a'.repeat(64) }] }, { idp: idp.issuer, subject: SUBJECT, targetHost: 'test-host', grantType: 'once', wait: false })).rejects.toThrow('changed before authorization')
    for (const argv of [[], ['-'], ['--input-type=module'], ['--use-env-proxy', '-']]) expect(() => nodeProgramFiles({ program, argv })).toThrow('stdin execution')
    expect(() => nodeProgramFiles({ program, argv: ['--use-env-proxy', '--env-file=unbound.env', script] })).toThrow('needs an explicit execution binding')
    expect(idp.authorizeBodies).toHaveLength(0)
  })

  it.each([{ options: [] }, { options: ['--use-env-proxy'] }])('binds a Node script by content with $options and refuses replacement', async ({ options }) => {
    const { locateProgram } = await import('../src/authorization/program.js')
    const { nodeProgramFiles } = await import('../src/authorization/program-files.js')
    const program = await locateProgram(process.execPath)
    if (!program) throw new Error('Node executable is missing')
    const script = join(home, 'approved.cjs')
    writeFileSync(script, 'require("node:fs").writeFileSync(process.env.APES_TEST_MARKER, "approved")')
    const argv = [...options, script]
    const grant = await idp.approved([program.name, ...argv], program.sha256)
    grant.files = nodeProgramFiles({ program, argv })

    await exactShell([process.execPath, ...argv])
    expect(readFileSync(marker, 'utf8')).toBe('approved')
    rmSync(marker)
    writeFileSync(script, 'require("node:fs").writeFileSync(process.env.APES_TEST_MARKER, "replaced")')
    await expect(exactShell([process.execPath, ...argv])).rejects.toMatchObject({ exitCode: 75 })
    expect(existsSync(marker)).toBe(false)
  })

  it('refuses a script replaced after authorization before starting its interpreter', async () => {
    const { locateProgram, authorizeProgramCall } = await import('../src/authorization/program.js')
    const { nodeProgramFiles } = await import('../src/authorization/program-files.js')
    const { executeProgramCall } = await import('../src/authorization/execute.js')
    const program = await locateProgram(process.execPath)
    if (!program) throw new Error('Node executable is missing')
    const script = join(home, 'late-replacement.cjs')
    writeFileSync(script, 'console.log(2 + 2)')
    const call = { program, argv: [script] }
    const grant = await idp.approved([program.name, script], program.sha256)
    grant.files = nodeProgramFiles(call)
    await authorizeProgramCall(call, { idp: idp.issuer, subject: SUBJECT, targetHost: 'test-host', grantType: 'once', wait: false })
    writeFileSync(script, 'require("node:fs").writeFileSync(process.env.APES_TEST_MARKER, "unexpected")')

    expect(() => executeProgramCall(call)).toThrow('changed after authorization')
    expect(existsSync(marker)).toBe(false)
  })

  it('forwards interpreter code and literal arguments through ape-shell with one exact authorization', async () => {
    const { locateProgram } = await import('../src/authorization/program.js')
    const program = await locateProgram(process.execPath)
    if (!program) throw new Error('Node executable is missing')
    const code = 'require("node:fs").writeFileSync(process.env.APES_TEST_MARKER, JSON.stringify(process.argv.slice(1)))'
    const literal = ['', 'Grüße', '$HOME', '$(touch unexpected)', 'a\nb', 'a && b', '>', '--as', 'root']
    const argv = ['-e', code, '--', ...literal]
    await idp.approved([program.name, ...argv], program.sha256, 'once')

    await exactShell([process.execPath, ...argv])

    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual(literal)
    expect(idp.authorizeBodies).toHaveLength(1)
    expect(idp.authorizeBodies[0]).toMatchObject({ audience: 'shapes', argv })
    expect(idp.consumed).toHaveLength(1)
  })

  it('does not run changed inline code under an earlier exact approval', async () => {
    const { locateProgram } = await import('../src/authorization/program.js')
    const program = await locateProgram(process.execPath)
    if (!program) throw new Error('Node executable is missing')
    await idp.approved([program.name, '-e', 'console.log(2 + 2)'], program.sha256)
    const changed = 'require("node:fs").writeFileSync(process.env.APES_TEST_MARKER, "unexpected")'

    await expect(exactShell([process.execPath, '-e', changed])).rejects.toMatchObject({ exitCode: 75 })

    expect(existsSync(marker)).toBe(false)
    expect(idp.authorizeBodies).toHaveLength(1)
    expect(idp.authorizeBodies[0]).toMatchObject({ audience: 'shapes', argv: ['-e', changed] })
  })

  it('refuses an unknown executable without requesting shell-session authority', async () => {
    await expect(exactShell([join(bin, 'missing'), 'a && b'])).rejects.toThrow('no executable file found')
    expect(existsSync(marker)).toBe(false)
    expect(idp.authorizeBodies).toEqual([])
  })

  it('runs an approved command with a token from the IdP and reads nothing below ~/.openape', async () => {
    const sha256 = writeProgram()
    await idp.approved(['fakegit', 'status', '--short'], sha256)

    await apesRun(['fakegit', 'status', '--short'])

    expect(ran()).toEqual(['status', '--short'])
    expect(idp.authorizeBodies).toEqual([{
      target_host: 'test-host',
      audience: 'shapes',
      program: { name: 'fakegit', sha256 },
      argv: ['status', '--short'],
      grant_type: 'once',
    }])
    expect(openapePaths).toEqual([])
  })

  it('the read tracker sees reads of local adapters, so an empty record means none happened', async () => {
    const { loadAdapter } = await import('@openape/shapes')
    try {
      loadAdapter('fakegit')
    }
    catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
    expect(openapePaths.some(path => path.includes(join('.openape', 'shapes')))).toBe(true)
  })

  it('waits for a pending request, authorizes again after approval and runs', async () => {
    const sha256 = writeProgram()
    idp.onPoll = (grant) => { grant.status = 'approved' }

    await apesRun(['fakegit', 'push'], { wait: true })

    expect(ran()).toEqual(['push'])
    expect(idp.authorizeBodies).toHaveLength(2)
    expect(idp.grants).toMatchObject([{ status: 'used', programSha256: sha256 }])
  })

  it('without --wait prints the pending request, exits 75 and runs nothing', async () => {
    writeProgram()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { CliExit } = await import('../src/errors.js')

    await expect(apesRun(['fakegit', 'push'])).rejects.toSatisfy(error => error instanceof CliExit && error.exitCode === 75)

    expect(ran()).toBeNull()
    expect(idp.grants).toMatchObject([{ status: 'pending' }])
  })

  it('never runs when the approval wait runs out', async () => {
    writeProgram()
    const { AuthorizationTimeoutError, authorizeProgramCall, locateProgram } = await import('../src/authorization/program.js')
    const program = (await locateProgram('fakegit'))!

    await expect(authorizeProgramCall({ program, argv: ['push'] }, {
      idp: idp.issuer,
      subject: SUBJECT,
      targetHost: 'test-host',
      grantType: 'once',
      wait: true,
      waitMs: 300,
      pollIntervalMs: 50,
    })).rejects.toBeInstanceOf(AuthorizationTimeoutError)

    expect(idp.grants).toMatchObject([{ status: 'pending' }])
    expect(idp.authorizeBodies).toHaveLength(1)
  })

  it('refuses a withdrawn command and one withdrawn while waiting (issue 1536)', async () => {
    const sha256 = writeProgram()
    await idp.add(['fakegit', 'reset', '--hard'], sha256, 'withdrawn')
    await expect(apesRun(['fakegit', 'reset', '--hard'], { wait: true })).rejects.toThrow('Grant grant-1 withdrawn')

    idp.onPoll = (grant) => { grant.status = 'withdrawn' }
    await expect(apesRun(['fakegit', 'clean', '-fdx'], { wait: true })).rejects.toThrow('Grant grant-2 withdrawn')

    expect(ran()).toBeNull()
  })

  it('refuses a denied command and one denied while waiting', async () => {
    const sha256 = writeProgram()
    await idp.add(['fakegit', 'reset', '--hard'], sha256, 'denied')
    await expect(apesRun(['fakegit', 'reset', '--hard'], { wait: true })).rejects.toThrow('Grant grant-1 denied')

    idp.onPoll = (grant) => { grant.status = 'denied' }
    await expect(apesRun(['fakegit', 'clean', '-fdx'], { wait: true })).rejects.toThrow('Grant grant-2 denied')

    expect(ran()).toBeNull()
  })

  it.each([
    ['argv hash', { argv_hash: 'SHA-256:0000' }, 'does not match this command'],
    ['program hash', { program_sha256: 'f'.repeat(64) }, 'does not match this program file'],
    ['subject', { sub: 'someone-else@example.com' }, 'another identity'],
    ['target host', { target_host: 'other-host' }, 'another host'],
    ['issuer', { iss: 'https://evil.example' }, 'Command token rejected'],
    ['audience', { aud: 'escapes' }, 'Command token rejected'],
    ['grant identity', { grant_id: 'another-grant' }, 'another grant'],
    ['execution user', { run_as: 'root' }, 'execution user'],
    ['unexpected broker', { brokered: { connection_id: 'foreign' } }, 'brokered owner identity'],
    ['unexpected script content', { execution_context: { files: [{ path: '/foreign.js', sha256: 'a'.repeat(64) }] } }, 'script content'],
  ])('refuses a token with a tampered %s before running anything', async (_field, overrides, message) => {
    const sha256 = writeProgram()
    await idp.approved(['fakegit', 'status'], sha256)
    idp.claimOverrides = overrides

    await expect(apesRun(['fakegit', 'status'])).rejects.toThrow(message)

    expect(ran()).toBeNull()
  })

  it('refuses a token signed with a key outside the IdP key set', async () => {
    const sha256 = writeProgram()
    await idp.approved(['fakegit', 'status'], sha256)
    idp.signWithForeignKey = true

    await expect(apesRun(['fakegit', 'status'])).rejects.toThrow('Command token rejected')

    expect(ran()).toBeNull()
  })

  it('binds the token to the file it runs: a program swapped after the request is refused', async () => {
    const original = writeProgram()
    await idp.approved(['fakegit', 'status'], original)
    // The IdP issues tokens for whatever hash the request carries; a different file
    // under the same name yields a different hash, and the token names that one.
    idp.claimOverrides = { program_sha256: original }
    writeProgram('echo swapped > "$APES_TEST_MARKER"\n')

    await expect(apesRun(['fakegit', 'status'])).rejects.toThrow('does not match this program file')

    expect(ran()).toBeNull()
  })

  it('re-checks the file right before it runs: a file swapped after authorization or no regular file is refused', async () => {
    const sha256 = writeProgram()
    await idp.approved(['fakegit', 'status'], sha256)
    const { authorizeProgramCall, locateProgram } = await import('../src/authorization/program.js')
    const { executeProgramCall } = await import('../src/authorization/execute.js')
    const call = { program: (await locateProgram('fakegit'))!, argv: ['status'] }
    await authorizeProgramCall(call, { idp: idp.issuer, subject: SUBJECT, targetHost: 'test-host', grantType: 'always', wait: false })

    writeProgram('echo swapped > "$APES_TEST_MARKER"\n')
    expect(() => executeProgramCall(call)).toThrow('changed after it was authorized')
    expect(() => executeProgramCall({ ...call, program: { ...call.program, path: bin } })).toThrow('is not a regular file')

    expect(ran()).toBeNull()
  })

  it('consumes a single-use grant before running and refuses when it was already used elsewhere', async () => {
    const sha256 = writeProgram()
    const grant = await idp.approved(['fakegit', 'tag', 'v1'], sha256, 'once')

    await apesRun(['fakegit', 'tag', 'v1'])
    expect(ran()).toEqual(['tag', 'v1'])
    expect(idp.consumed).toEqual([grant.id])

    rmSync(marker)
    await idp.approved(['fakegit', 'tag', 'v2'], sha256, 'once')
    idp.consumeAnswer = { error: 'already_consumed', status: 'used' }
    await expect(apesRun(['fakegit', 'tag', 'v2'])).rejects.toThrow('cannot be used: already_consumed')
    expect(ran()).toBeNull()
  })

  it('reuses a token for identical always calls until it expires, but never a single-use token', async () => {
    const sha256 = writeProgram()
    await idp.approved(['fakegit', 'log'], sha256, 'always')
    const { authorizeProgramCall, locateProgram } = await import('../src/authorization/program.js')
    const call = { program: (await locateProgram('fakegit'))!, argv: ['log'] }
    const options = { idp: idp.issuer, subject: SUBJECT, targetHost: 'test-host', grantType: 'always' as const, wait: false }

    const first = await authorizeProgramCall(call, options)
    const second = await authorizeProgramCall(call, options)
    expect(second).toEqual(first)
    expect(idp.authorizeBodies).toHaveLength(1)

    await idp.approved(['fakegit', 'tag'], sha256, 'once')
    const once = { ...call, argv: ['tag'] }
    await authorizeProgramCall(once, { ...options, grantType: 'once' })
    await expect(authorizeProgramCall(once, { ...options, grantType: 'once' })).resolves.toMatchObject({ kind: 'pending' })
    expect(idp.authorizeBodies).toHaveLength(3)
  })
})

describe('apes explain', () => {
  it('previews the IdP resolution through the public resolve endpoint', async () => {
    const requests: unknown[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({
        cli_id: 'git',
        operation_id: 'git.status',
        executable: 'git',
        commandArgv: ['status'],
        bindings: {},
        detail: { type: 'openape_cli', cli_id: 'git', operation_id: 'git.status', resource_chain: [], action: 'read', permission: 'git.repo[*]#read', display: 'Show status', risk: 'low' },
        executionContext: { argv: ['git', 'status'], argv_hash: 'SHA-256:x', adapter_id: 'git', adapter_version: '1', adapter_digest: 'SHA-256:d', resolved_executable: 'git', context_bindings: {} },
        permission: 'git.repo[*]#read',
        synthetic: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { explainCommand } = await import('../src/commands/explain.js')

    await explainCommand.run!({ rawArgs: ['--', '/usr/bin/git', 'status'], args: { idp: 'https://id.example' } } as never)

    expect(requests).toEqual([{ url: 'https://id.example/api/shapes/resolve', body: { cli_id: 'git', argv: ['git', 'status'] } }])
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({ operation: 'git.status', display: 'Show status', shaped: true, exact_command: false })
    expect(openapePaths).toEqual([])
  })
})

it('binds shell and Python script content while allowing exact inline code and refusing unbound module/stdin execution', async () => {
  const { interpreterProgramFiles, assertProgramFiles } = await import('../src/authorization/program-files.js')
  const root = mkdtempSync(join(tmpdir(), 'apes-interpreter-'))
  try {
    const script = join(root, 'script.py'); writeFileSync(script, 'print(2 + 2)')
    for (const name of ['python3', 'bash']) {
      const program = { name, path: process.execPath, sha256: 'a'.repeat(64) }
      // The fixture executable has a real Node basename, so select an actual shell file for identity inspection.
      program.path = '/bin/sh'
      const context = { cwd: root, env: {} }
      const files = interpreterProgramFiles({ program, argv: [script] }, context)
      expect(files).toEqual([{ path: script, sha256: createHash('sha256').update('print(2 + 2)').digest('hex') }])
      expect(interpreterProgramFiles({ program, argv: ['-c', 'print(2 + 2)'] }, context)).toEqual([])
      for (const argv of [[], ['-'], ['-m', 'unbound'], ['-lc', 'unbound']]) expect(() => interpreterProgramFiles({ program, argv }, context)).toThrow()
      writeFileSync(script, 'changed'); expect(() => assertProgramFiles(files)).toThrow('changed after authorization'); writeFileSync(script, 'print(2 + 2)')
    }
  }
  finally { rmSync(root, { recursive: true, force: true }) }
})
