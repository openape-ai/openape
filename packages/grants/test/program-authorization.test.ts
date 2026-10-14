// Per-call program authorization (issue 1473): the IdP validates the call,
// selects the shape by program hash or name and resolves the command itself.
import type { OpenApeGrant } from '@openape/core'
import { generateKeyPair } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { COMMAND_TOKEN_LIFETIME_SECONDS, issueCommandJWT, verifyAuthzJWT } from '../src/authz-jwt.js'
import { computeArgvHash } from '../src/cli-permissions.js'
import { InvalidProgramAuthorizeRequestError, parseProgramAuthorizeRequest, resolveProgramCall, selectProgramShape } from '../src/program-authorization.js'
import { GENERIC_OPERATION_ID } from '../src/server-resolver.js'
import type { ServerShape } from '../src/shape-registry.js'
import { createInMemoryShapeStore } from '../src/shape-registry.js'

const tested = 'a'.repeat(64)
const untested = 'b'.repeat(64)
const gitShape: ServerShape = {
  cli_id: 'git',
  executable: 'git',
  description: 'Git CLI',
  operations: [
    { id: 'git.status', command: ['status'], positionals: [], display: 'Show git status', action: 'read', risk: 'low', resource_chain: [] },
    { id: 'git.push', command: ['push'], positionals: ['remote', 'branch'], display: 'Push {branch} to {remote}', action: 'write', risk: 'high', resource_chain: ['remote:name={remote}'], exact_command: true },
  ],
  source: 'builtin',
  digest: 'SHA-256:semantic',
  tested_digests: [`SHA-256:${tested}`],
  createdAt: 0,
  updatedAt: 0,
}
// A single-file script whose registry entry names it only by digest.
const scriptShape: ServerShape = { ...gitShape, cli_id: 'mail-sync', executable: 'mail-sync', operations: [{ ...gitShape.operations[0]!, id: 'sync', command: ['sync'] }], tested_digests: [`SHA-256:${'c'.repeat(64)}`] }
const store = createInMemoryShapeStore([gitShape, scriptShape])
const valid = { target_host: 'macmini', audience: 'shapes', program: { name: 'git', sha256: tested }, argv: ['status'] }

describe('parseProgramAuthorizeRequest', () => {
  it('accepts the contract body and defaults to a continuing grant', () => {
    expect(parseProgramAuthorizeRequest(valid)).toEqual({ ...valid, grant_type: 'always' })
    const full = parseProgramAuthorizeRequest({ ...valid, grant_type: 'once', summary: { title: 'Check the repository' }, batch: { id: 'b-1' } })
    expect(full).toMatchObject({ grant_type: 'once', summary: { title: 'Check the repository' }, batch: { id: 'b-1' } })
    expect(parseProgramAuthorizeRequest({ ...valid, argv: [] }).argv).toEqual([])
  })

  it('refuses client-resolved details, unknown fields and malformed values', () => {
    const invalid: unknown[] = [
      null,
      [],
      { ...valid, authorization_details: [{ type: 'openape_cli' }] },
      { ...valid, execution_context: { argv: ['git'] } },
      { ...valid, program: { ...valid.program, path: '/usr/bin/git' } },
      { ...valid, program: 'git' },
      { ...valid, program: { name: 'git', sha256: tested.toUpperCase() } },
      { ...valid, program: { name: 'git', sha256: 'a'.repeat(63) } },
      { ...valid, program: { name: '/usr/bin/git', sha256: tested } },
      { ...valid, program: { name: '..', sha256: tested } },
      { ...valid, program: { name: '', sha256: tested } },
      { ...valid, argv: 'status' },
      { ...valid, argv: ['status', 1] },
      { ...valid, argv: ['sta\0tus'] },
      { ...valid, argv: Array.from({ length: 257 }, () => 'x') },
      { ...valid, target_host: '' },
      { ...valid, audience: 7 },
      { ...valid, grant_type: 'timed' },
      { ...valid, summary: { text: 'old' } },
      { ...valid, batch: { id: '' } },
    ]
    for (const input of invalid) expect(() => parseProgramAuthorizeRequest(input)).toThrow(InvalidProgramAuthorizeRequestError)
  })
})

describe('selectProgramShape', () => {
  it('prefers a tested digest, else the executable name with an untested version', async () => {
    expect(await selectProgramShape(store, { name: 'git', sha256: tested })).toEqual({ shape: gitShape, versionTested: true })
    expect(await selectProgramShape(store, { name: 'git', sha256: untested })).toEqual({ shape: gitShape, versionTested: false })
    // A tested digest selects its shape under any file name.
    expect((await selectProgramShape(store, { name: 'renamed', sha256: 'c'.repeat(64) }))?.shape.cli_id).toBe('mail-sync')
    expect(await selectProgramShape(store, { name: 'kubectl', sha256: untested })).toBeNull()
  })
})

describe('resolveProgramCall', () => {
  it('resolves a structured call and writes the IdP execution context', async () => {
    const call = await resolveProgramCall(store, { program: { name: 'git', sha256: untested }, argv: ['status'] })
    expect(call.executionArgv).toEqual(['git', 'status'])
    expect(call.argvHash).toBe(await computeArgvHash(['git', 'status']))
    expect(call.detail).toMatchObject({ cli_id: 'git', operation_id: 'git.status', action: 'read' })
    expect(call.executionContext).toMatchObject({ argv: ['git', 'status'], argv_hash: call.argvHash, program_sha256: untested, version_tested: false, adapter_id: 'git', adapter_digest: 'SHA-256:semantic' })
  })

  it('falls back to an exact command bound to the argv hash without a shape or a matching operation', async () => {
    const unknown = await resolveProgramCall(store, { program: { name: 'kubectl', sha256: untested }, argv: ['get', 'pods'] })
    expect(unknown.detail).toMatchObject({ cli_id: 'kubectl', operation_id: GENERIC_OPERATION_ID, constraints: { exact_command: true } })
    expect(unknown.detail.resource_chain[1]).toEqual({ resource: 'argv', selector: { hash: unknown.argvHash } })
    expect(unknown.executionContext.version_tested).toBe(false)
    const unmatched = await resolveProgramCall(store, { program: { name: 'git', sha256: tested }, argv: ['bisect'] })
    expect(unmatched.detail).toMatchObject({ cli_id: 'git', operation_id: GENERIC_OPERATION_ID })
    expect(unmatched.executionContext.version_tested).toBe(true)
  })
})

describe('issueCommandJWT', () => {
  const now = () => Math.floor(Date.now() / 1000)
  const grant = (overrides: Partial<OpenApeGrant> = {}): OpenApeGrant => ({ id: 'g-1', status: 'approved', created_at: now(), decided_by: 'owner@example.com', request: { requester: 'agent@example.com', target_host: 'macmini', audience: 'shapes', grant_type: 'always' }, ...overrides })

  it('binds the token to the call, at most five minutes and never beyond the grant', async () => {
    const keys = await generateKeyPair()
    const call = await resolveProgramCall(store, { program: { name: 'git', sha256: tested }, argv: ['status'] })
    const input = { argvHash: call.argvHash, programSha256: tested, detail: call.detail, executionContext: call.executionContext }
    const issued = await issueCommandJWT(grant(), input, 'https://id.example.com', keys.privateKey, 'k1')
    const { claims } = await verifyAuthzJWT(issued.token, { publicKey: keys.publicKey, expectedIss: 'https://id.example.com', expectedAud: 'shapes' })
    expect(claims).toMatchObject({ sub: 'agent@example.com', grant_id: 'g-1', target_host: 'macmini', argv_hash: call.argvHash, program_sha256: tested, command: ['git', 'status'], decided_by: 'owner@example.com' })
    expect(claims!.exp).toBe(issued.expiresAt)
    expect(issued.expiresAt - now()).toBeLessThanOrEqual(COMMAND_TOKEN_LIFETIME_SECONDS)

    const ending = await issueCommandJWT(grant({ expires_at: now() + 30, request: { ...grant().request, run_as: 'root' } }), input, 'https://id.example.com', keys.privateKey)
    expect(ending.expiresAt).toBe(now() + 30)
    await expect(issueCommandJWT(grant({ expires_at: now() - 1 }), input, 'https://id.example.com', keys.privateKey)).rejects.toThrow('expired')
    await expect(issueCommandJWT(grant({ status: 'pending' }), input, 'https://id.example.com', keys.privateKey)).rejects.toThrow('not approved')
  })
})
