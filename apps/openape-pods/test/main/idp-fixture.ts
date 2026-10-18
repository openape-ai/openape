import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { computeArgvHash } from '@openape/grants'
import { parseBrokerGrantRequest } from '../../../../modules/nuxt-auth-idp/src/runtime/server/utils/broker-grant-request'
import type { RunApproval } from '../../src/contracts/activity'
import type { ServiceRequest } from '../../src/contracts/services'
import { GrantLedger } from '../../src/worker/resources/grants'
import { PodDatabase } from '../../src/worker/storage/database'

/**
 * A synthetic IdP and desktop worker for the grant suites. Grants start pending and change only through decide()
 * (the owner at the IdP) or an approve/deny call; every decision call is recorded with the bearer it carried.
 * Only the provisioned Pod identities, Electron and the worker process are substitutes; the grant ledger is the
 * real one on a temporary profile.
 */
export const issuer = 'https://id.example.test'
export const owner = 'owner@example.test'
export const ownerToken = 'OWNER_SESSION_TOKEN'
export const podSubject = (id: string) => `pod-${id.slice(-4)}@example.test`
export interface StubGrant { status: string, request: Record<string, unknown>, decided_by?: string }
export interface Decision { action: 'approve' | 'deny' | 'revoke', id: string, bearer: string, body: Record<string, unknown> }

/**
 * What the owner's IdP rejects with 400 among the recorded grant requests: Pod identities are brokered, so it validates
 * each one with this function. Checked after a scenario, so the stub keeps its timing.
 */
export async function brokerRejections(requests: Record<string, unknown>[]): Promise<string[]> {
  const errors = await Promise.all(requests.map(async (request) => {
    try { await parseBrokerGrantRequest(structuredClone(request), String(request.requester)); return null }
    catch (error) { return `${String(request.reason)}: ${(error as Error).message}` }
  }))
  return errors.filter(error => error !== null)
}

/** The provenance the decision IdP keeps on a brokered grant; a brokered Pod connection carries the same. */
export const brokered = { connection_id: '00000000-0000-4000-8000-0000000000b1', broker_issuer: issuer, agent_issuer: issuer, owner, key_id: 'key' }

/**
 * With `brokered`, the Pod identities are brokered like those of pods.openape.ai: every grant carries the provenance,
 * and the agent provider forwards reads but not a revoke, so a revoke with the Pod token finds no grant (404); only
 * the owner revokes at the decision IdP.
 */
export function identityProvider(options: { brokered?: typeof brokered } = {}) {
  const keys = generateKeyPairSync('ed25519')
  const grants = new Map<string, StubGrant>()
  const state = { reuse: false, approvals: [] as string[], decisions: [] as Decision[], tokens: [] as string[], creates: [] as Record<string, unknown>[], authorizations: [] as Record<string, unknown>[], revokedTokens: [] as string[], delegations: [] as Record<string, unknown>[] }
  const signed = (claims: Record<string, unknown>) => {
    const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${head}.${payload}.${sign(null, Buffer.from(`${head}.${payload}`), keys.privateKey).toString('base64url')}`
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.origin !== issuer) throw new Error(`Unexpected network request to ${url.origin}`)
    const bearer = String(new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer /, '')
    if (url.pathname === '/revoke') { state.revokedTokens.push(JSON.parse(String(init?.body)).token as string); return json({ status: 'ok' }) }
    if (url.pathname === '/.well-known/jwks.json') return json({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] })
    if (url.pathname === '/api/delegations' && init?.method === 'POST') {
      // Like the IdP: only the human owner creates delegations, and grants scopes only for the IdP itself.
      const request = JSON.parse(String(init.body)) as Record<string, unknown>
      if (bearer !== ownerToken) return json({ title: 'Only humans can create delegations' }, 403)
      if (request.audience !== issuer) return json({ title: 'Grants scopes require the IdP issuer as the delegation audience' }, 400)
      state.delegations.push(request)
      return json({ id: `delegation-${state.delegations.length}`, type: 'delegation', status: 'approved', request: { ...request, delegator: owner }, ...(typeof request.duration === 'number' ? { expires_at: 1_000_000 + request.duration } : {}) }, 201)
    }
    if (url.pathname === '/api/grants/authorize' && init?.method === 'POST') return authorize(JSON.parse(String(init.body)) as Record<string, unknown>)
    if (url.pathname.startsWith('/api/pods/agents/')) return json({ email: decodeURIComponent(url.pathname.split('/')[4]!), owner, active: true, keyIds: ['key'], grantId: url.searchParams.get('grant'), grantActive: true })
    if (url.pathname === '/api/grants' && init?.method === 'POST') {
      const request = JSON.parse(String(init.body)) as Record<string, unknown>
      const id = `grant-${grants.size + 1}`
      state.creates.push(request)
      // Like the IdP: an approved continuing grant covering the same details is returned again (200) instead of a new one (201).
      const reused = [...grants.entries()].find(([, grant]) => grant.status === 'approved' && grant.request.grant_type === 'always' && request.grant_type === 'always' && grant.request.requester === request.requester && grant.request.target_host === request.target_host && JSON.stringify(grant.request.authorization_details) === JSON.stringify(request.authorization_details))
      if (reused && state.reuse) return json({ id: reused[0], status: 'approved' })
      grants.set(id, { status: 'pending', request })
      return json({ id, status: 'pending' }, 201)
    }
    const [, , , id, action] = url.pathname.split('/')
    const grant = grants.get(id ?? '')
    if (!grant) return json({ title: 'Unknown grant' }, 404)
    if (action === 'approve' || action === 'deny' || action === 'revoke') {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      state.decisions.push({ action, id: id!, bearer, body })
      if (action === 'approve') state.approvals.push(url.pathname)
      // Like the IdP: only the owner decides; the requesting Pod may revoke its own direct grant.
      if (action === 'revoke' && options.brokered && bearer !== ownerToken) return json({ title: 'Grant not found' }, 404)
      if (action !== 'revoke' && bearer !== ownerToken) return json({ title: 'Direct human authentication is required' }, 403)
      if (action === 'revoke' && !['pending', 'approved'].includes(grant.status)) return json({ title: `Grant cannot be revoked (status: ${grant.status})` }, 400)
      if (action === 'revoke') { grant.status = 'revoked'; return json({ id, status: 'revoked', request: grant.request }) }
      if (grant.status !== 'pending') return json({ title: 'Grant already decided' }, 400)
      grant.status = action === 'approve' ? 'approved' : 'denied'; grant.decided_by = owner
      if (action === 'approve' && typeof body.grant_type === 'string') grant.request.grant_type = body.grant_type
      return action === 'approve' ? json({ grant: { id, status: grant.status, request: grant.request, decided_by: owner } }) : json({ id, status: grant.status, request: grant.request })
    }
    if (action === 'token') {
      if (grant.status !== 'approved') return json({ type: 'https://openape.org/errors/grant_not_approved' }, 400)
      state.tokens.push(id!)
      const now = Math.floor(Date.now() / 1000)
      return json({ authz_jwt: signed({ iss: issuer, sub: grant.request.requester, aud: 'shapes', target_host: grant.request.target_host, grant_id: id, grant_type: grant.request.grant_type, iat: now, exp: now + 3600, jti: randomUUID(), authorization_details: grant.request.authorization_details, execution_context: grant.request.execution_context, ...(grant.decided_by ? { decided_by: grant.decided_by } : {}), ...(options.brokered ? { brokered: options.brokered } : {}) }) })
    }
    if (action === 'consume') return json({ status: 'valid' })
    if (action === undefined && (init?.method ?? 'GET') === 'GET') return json({ id, status: grant.status, request: grant.request, ...(grant.decided_by ? { decided_by: grant.decided_by } : {}), ...(options.brokered ? { brokered: options.brokered } : {}) })
    return json({ title: 'Unsupported' }, 404)
  })
  /**
   * Per-call program authorization like the IdP (issue 1473, revision 4). The stub knows no Shapes: a grant covers a call
   * when it is approved for the same Pod and target and either was requested for exactly this argv, or its details
   * name the program with operation `*` (a whole-program grant). Otherwise one pending exact request is created or
   * reused; the newest denied or revoked request refuses with 403. The token carries the resolution of the call; the
   * stub's grants have one action each, so their details stand in for it.
   */
  async function authorize(body: Record<string, unknown>): Promise<Response> {
    state.authorizations.push(body)
    if (Object.keys(body).some(key => !['target_host', 'audience', 'program', 'argv', 'files', 'grant_type', 'summary', 'batch'].includes(key))) return json({ statusCode: 400, data: { title: 'Invalid request' } }, 400)
    const program = body.program as { name: string, sha256: string }; const executionArgv = [program.name, ...body.argv as string[]]
    const argvHash = await computeArgvHash(executionArgv)
    const requester = podSubject(String(body.target_host).slice(5))
    const own = [...grants.entries()].filter(([, grant]) => grant.request.requester === requester && grant.request.target_host === body.target_host && grant.request.audience === 'shapes')
    const details = (grant: StubGrant) => (grant.request.authorization_details ?? []) as { cli_id: string, operation_id: string }[]
    const covers = (grant: StubGrant) => {
      const context = grant.request.execution_context as { argv_hash?: string, program_sha256?: string, files?: unknown } | undefined
      return (context?.argv_hash === argvHash && context.program_sha256 === program.sha256 && JSON.stringify(context.files ?? []) === JSON.stringify(body.files ?? [])) || details(grant).some(detail => detail.cli_id === program.name && detail.operation_id === '*')
    }
    const approved = own.find(([, grant]) => grant.status === 'approved' && covers(grant))
    if (approved) {
      const [id, grant] = approved; const now = Math.floor(Date.now() / 1000)
      state.tokens.push(id)
      return json({ state: 'approved', grant_id: id, expires_at: now + 300, authz_jwt: signed({ iss: issuer, sub: requester, aud: 'shapes', target_host: body.target_host, iat: now, exp: now + 300, jti: randomUUID(), grant_id: id, grant_type: grant.request.grant_type, approval: grant.request.grant_type, authorization_details: grant.request.authorization_details, command: executionArgv, argv_hash: argvHash, program_sha256: program.sha256, ...(grant.decided_by ? { decided_by: grant.decided_by } : {}), ...(options.brokered ? { brokered: options.brokered } : {}) }) })
    }
    const newest = own.filter(([, grant]) => covers(grant)).at(-1)
    if (newest && ['denied', 'revoked'].includes(newest[1].status)) return json({ type: `https://openape.org/errors/grant_${newest[1].status}`, title: 'Refused', status: 403, state: newest[1].status, grant_id: newest[0] }, 403)
    if (newest?.[1].status === 'pending') return json({ state: 'pending', grant_id: newest[0], approval_url: `${issuer}/grant-approval?grant_id=${newest[0]}` }, 202)
    const id = `grant-${grants.size + 1}`
    const detail = { type: 'openape_cli', cli_id: program.name, operation_id: '_exact', resource_chain: [], action: 'exec', permission: `${program.name}.command[argv_hash=${argvHash}]#exec`, display: executionArgv.join(' '), risk: 'high', constraints: { exact_command: true } }
    grants.set(id, { status: 'pending', request: { requester, target_host: body.target_host, audience: 'shapes', grant_type: body.grant_type ?? 'always', command: executionArgv, authorization_details: [detail], execution_context: { argv: executionArgv, argv_hash: argvHash, program_sha256: program.sha256, ...(body.files ? { files: body.files } : {}) }, summary: body.summary } })
    return json({ state: 'pending', grant_id: id, approval_url: `${issuer}/grant-approval?grant_id=${id}` }, 202)
  }
  /** A decision made outside Pods, by the owner at the IdP or by its expiry. */
  const decide = (id: string, status: 'approved' | 'denied' | 'revoked' | 'expired') => { grants.get(id)!.status = status }
  /** A grant that another requester or for another target asked for, to prove Pods never decides it. */
  const foreign = (request: Record<string, unknown>) => { const id = `grant-${grants.size + 1}`; grants.set(id, { status: 'pending', request: { audience: 'shapes', grant_type: 'always', ...request } }); return id }
  return { state, fetch, decide, foreign }
}

export const podId = '00000000-0000-4000-8000-000000000001'
export const deniedPodId = '00000000-0000-4000-8000-000000000002'
export const applicationId = '00000000-0000-4000-8000-0000000000a1'
// A program is assigned by path and file hash only (issue 1473, revision 4); the IdP decides what its commands mean.
const programRoot = mkdtempSync(join(tmpdir(), 'pods-idp-program-'))
export const programExecutable = join(programRoot, 'fixture-cli')
writeFileSync(programExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
export const program = { id: applicationId, podId, revision: 1, kind: 'tool', state: 'ready', name: 'Fixture CLI', configuration: { type: 'program', name: 'fixture-cli', cliId: 'fixture-cli', executable: programExecutable, executableHash: createHash('sha256').update('#!/bin/sh\nexit 0\n').digest('hex'), entryFiles: [], environment: {}, networkHosts: [], stateId: '00000000-0000-4000-8000-0000000000c1', capability: 'tool.app_fixture.invoke' } }

const profiles: PodDatabase[] = []
export function closeProfiles(): void { for (const store of profiles.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } }

export async function workerFixture(options: { pods?: string[], resources?: () => Record<string, unknown>[], brokered?: typeof brokered } = {}) {
  const { FixtureWorker } = await import('../../src/main/worker')
  const { ConnectionManager } = await import('../../src/main/connections/manager')
  const { ProgramManager } = await import('../../src/main/programs/manager')
  const { shell } = await import('electron')
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-idp-fixture-'))); profiles.push(store)
  for (const id of options.pods ?? [podId, deniedPodId]) store.createPod({ name: `Pod ${id.slice(-4)}` }, id)
  const ledger = new GrantLedger(store)
  const worker = new FixtureWorker(() => {})
  const connection = (id: string) => ({ issuer, subject: podSubject(id), owner, keyId: 'key', targetHost: `pods:${id}`, accessToken: async () => 'SYNTHETIC_POD_AGENT', identity: { podId: id, connectionId: randomUUID(), issuer, owner, subject: podSubject(id), keyId: 'key' }, ownerConnection: 'owner-connection', ...(options.brokered ? { decisionIssuer: issuer, brokered: options.brokered } : {}) })
  // The real ConnectionManager.request runs; only the provisioned Pod identity is synthetic.
  const connections = Object.assign(Object.create(ConnectionManager.prototype), { podConnection: async (id: string) => connection(id) })
  const approvals: RunApproval[] = []; const bound: Record<string, unknown>[] = []
  const receipts = new Map<string, unknown>()
  const reasons = new Map<string, string>()
  const names = new Map<string, string>()
  const resources = () => ({ epoch: 1, resources: options.resources?.() ?? [program], variables: [] })
  const dispatch = vi.fn(async (command: Record<string, any>) => {
    if (command.grants) return ledger.execute(command.grants)
    if (command.type === 'list' && Object.keys(command).length === 1) return { pods: store.listPods().map(pod => ({ id: pod.id, revision: pod.revision, name: pod.name, lifecycle: pod.lifecycle, activeScript: null })) }
    if (command.resource?.type?.startsWith('bind')) bound.push(command.resource)
    if (command.program?.type === 'save') bound.push(command.program)
    if (command.serviceCheck?.approval) approvals.push(command.serviceCheck.approval)
    if (command.runContext) {
      const description = store.db.prepare('SELECT body FROM pod_descriptions WHERE pod_id=?').get(command.runContext.scope.podId)?.body
      return { name: names.get(command.runContext.scope.runId) ?? 'Synthetic Pod', reason: reasons.get(command.runContext.scope.runId) ?? 'schedule', ...(description === undefined ? {} : { description }) }
    }
    if (command.credentialCheck) return 'secret-id'
    if (command.httpCredentialInventory) return []
    if (command.codexAdministration) {
      const { type, request, result } = command.codexAdministration
      if (type === 'complete') receipts.set(request.id, result)
      return receipts.has(request.id) ? { completed: true, result: receipts.get(request.id) } : { completed: false }
    }
    return resources()
  })
  const credentials = { readScriptSecret: vi.fn(async () => 'SYNTHETIC_SECRET') }
  Object.assign(worker, { root: store.root, connections, credentials, dispatch })
  const grants = (worker as unknown as { podGrants: () => import('../../src/main/grants/pod-grants').PodGrants }).podGrants()
  Object.assign(worker, { programs: new ProgramManager('/fixture/authentication', '/fixture/helper', credentials as never, connections, async () => resources() as never, command => dispatch({ program: command }), id => ({ connection: async () => connection(id) as never, runtime: { executable: '/fixture/node', cli: '/fixture/ape-shell.mjs', environment: {} }, ledger: grants.port(id), origin: async () => 'Pod', reach: async () => ({ level: 'isolated' as const, protectedPaths: [] }) })) })
  const service = worker as unknown as { executeService: (request: ServiceRequest) => Promise<unknown> }
  const call = (scope: ServiceRequest['scope'], kind: ServiceRequest['kind'], body: unknown = {}) => service.executeService({ id: randomUUID(), kind, scope, body })
  const start = (id: string, runId = randomUUID(), reason = 'schedule', name?: string) => {
    reasons.set(runId, reason)
    if (name) names.set(runId, name)
    const scope = { podId: id, runId, epoch: 1, assignmentRevision: 1, capabilities: [] }
    return { runId, run: call(scope, 'shell'), call: (kind: ServiceRequest['kind'], body: unknown = {}) => call(scope, kind, body) }
  }
  // Cancels every open service call, as the worker does when a run is cancelled or times out.
  const abortAll = () => { for (const controller of (worker as unknown as { services: Map<string, AbortController> }).services.values()) controller.abort(new Error('Pod tool call cancelled')) }
  return { worker, store, ledger, grants, connection, approvals, bound, credentials, start, abortAll, openExternal: vi.mocked(shell.openExternal) }
}
