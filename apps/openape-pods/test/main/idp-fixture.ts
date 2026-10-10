import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { vi } from 'vitest'
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
export const sources = resolve('runtime-sources')
// The worker resolves its bundled adapters under dist/vendor; the suites read the same reviewed sources.
export const source = (path: string) => path.includes('/vendor/') ? resolve(sources, basename(path)) : path
export const issuer = 'https://id.example.test'
export const owner = 'owner@example.test'
export const ownerToken = 'OWNER_SESSION_TOKEN'
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

export function identityProvider() {
  const keys = generateKeyPairSync('ed25519')
  const grants = new Map<string, StubGrant>()
  const state = { reuse: false, approvals: [] as string[], decisions: [] as Decision[], tokens: [] as string[], creates: [] as Record<string, unknown>[], revokedTokens: [] as string[] }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.origin !== issuer) throw new Error(`Unexpected network request to ${url.origin}`)
    const bearer = String(new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer /, '')
    if (url.pathname === '/revoke') { state.revokedTokens.push(JSON.parse(String(init?.body)).token as string); return json({ status: 'ok' }) }
    if (url.pathname === '/.well-known/jwks.json') return json({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] })
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
      // Like the IdP: only the owner decides; the requesting Pod may revoke its own grant.
      if (action !== 'revoke' && bearer !== ownerToken) return json({ title: 'Direct human authentication is required' }, 403)
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
      const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: grant.request.requester, aud: 'shapes', target_host: grant.request.target_host, grant_id: id, grant_type: grant.request.grant_type, iat: now, exp: now + 3600, jti: randomUUID(), authorization_details: grant.request.authorization_details, execution_context: grant.request.execution_context })).toString('base64url')
      return json({ authz_jwt: `${head}.${payload}.${sign(null, Buffer.from(`${head}.${payload}`), keys.privateKey).toString('base64url')}` })
    }
    if (action === 'consume') return json({ status: 'valid' })
    if (action === undefined && (init?.method ?? 'GET') === 'GET') return json({ id, status: grant.status, request: grant.request, ...(grant.decided_by ? { decided_by: grant.decided_by } : {}) })
    return json({ title: 'Unsupported' }, 404)
  })
  const decide = (id: string, status: 'approved' | 'denied') => { grants.get(id)!.status = status }
  /** A grant that another requester or for another target asked for, to prove Pods never decides it. */
  const foreign = (request: Record<string, unknown>) => { const id = `grant-${grants.size + 1}`; grants.set(id, { status: 'pending', request: { audience: 'shapes', grant_type: 'always', ...request } }); return id }
  return { state, fetch, decide, foreign }
}

export const podId = '00000000-0000-4000-8000-000000000001'
export const deniedPodId = '00000000-0000-4000-8000-000000000002'
export const applicationId = '00000000-0000-4000-8000-0000000000a1'
export const adapterPath = resolve(sources, 'pod-http-shapes.toml')
export const program = { id: applicationId, podId, revision: 1, kind: 'tool', state: 'ready', name: 'Fixture CLI', configuration: { type: 'program', cliId: 'pod-http', adapterPath, adapterHash: createHash('sha256').update(readFileSync(adapterPath)).digest('hex'), capability: 'tool.app_fixture.invoke' } }
export const podSubject = (id: string) => `pod-${id.slice(-4)}@example.test`

const profiles: PodDatabase[] = []
export function closeProfiles(): void { for (const store of profiles.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } }

export async function workerFixture(options: { pods?: string[], resources?: () => Record<string, unknown>[] } = {}) {
  const { FixtureWorker } = await import('../../src/main/worker')
  const { ConnectionManager } = await import('../../src/main/connections/manager')
  const { ProgramManager } = await import('../../src/main/programs/manager')
  const { shell } = await import('electron')
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-idp-fixture-'))); profiles.push(store)
  for (const id of options.pods ?? [podId, deniedPodId]) store.createPod({ name: `Pod ${id.slice(-4)}` }, id)
  const ledger = new GrantLedger(store)
  const worker = new FixtureWorker(() => {})
  const connection = (id: string) => ({ issuer, subject: podSubject(id), owner, keyId: 'key', targetHost: `pods:${id}`, accessToken: async () => 'SYNTHETIC_POD_AGENT', identity: { podId: id, connectionId: randomUUID(), issuer, owner, subject: podSubject(id), keyId: 'key' }, ownerConnection: 'owner-connection' })
  // The real ConnectionManager.request runs; only the provisioned Pod identity is synthetic.
  const connections = Object.assign(Object.create(ConnectionManager.prototype), { podConnection: async (id: string) => connection(id) })
  const approvals: RunApproval[] = []; const bound: Record<string, unknown>[] = []
  const receipts = new Map<string, unknown>()
  const reasons = new Map<string, string>()
  const names = new Map<string, string>()
  const withoutRuntime = new Set<string>()
  const resources = () => ({ epoch: 1, resources: options.resources?.() ?? [program], variables: [] })
  const dispatch = vi.fn(async (command: Record<string, any>) => {
    if (command.grants) return ledger.execute(command.grants)
    if (command.type === 'list' && Object.keys(command).length === 1) return { pods: store.listPods().map(pod => ({ id: pod.id, revision: pod.revision, name: pod.name, lifecycle: pod.lifecycle, activeScript: null })), organization: { revision: 1, groups: [] } }
    if (command.resource?.type?.startsWith('bind')) bound.push(command.resource)
    if (command.program?.type === 'save') bound.push(command.program)
    if (command.serviceCheck?.approval) approvals.push(command.serviceCheck.approval)
    if (command.runContext) return { name: names.get(command.runContext.scope.runId) ?? 'Synthetic Pod', reason: reasons.get(command.runContext.scope.runId) ?? 'schedule', runtime: !withoutRuntime.has(command.runContext.scope.runId) }
    if (command.credentialCheck) return 'secret-id'
    if (command.codexAdministration) {
      const { type, request, result } = command.codexAdministration
      if (type === 'complete') receipts.set(request.id, result)
      return receipts.has(request.id) ? { completed: true, result: receipts.get(request.id) } : { completed: false }
    }
    return resources()
  })
  const credentials = { readScriptSecret: vi.fn(async () => 'SYNTHETIC_SECRET') }
  Object.assign(worker, { root: '/fixture', connections, credentials, dispatch })
  const grants = (worker as unknown as { podGrants: () => import('../../src/main/grants/pod-grants').PodGrants }).podGrants()
  Object.assign(worker, { programs: new ProgramManager('/fixture/authentication', '/fixture/helper', credentials as never, connections, async () => resources() as never, command => dispatch({ program: command }), grants, id => ({ connection: async () => connection(id) as never, ledger: grants.port(id), reach: async () => ({ level: 'isolated' as const, protectedPaths: [] }) })) })
  const service = worker as unknown as { executeService: (request: ServiceRequest) => Promise<unknown> }
  const call = (scope: ServiceRequest['scope'], kind: ServiceRequest['kind'], body: unknown = {}) => service.executeService({ id: randomUUID(), kind, scope, body })
  const start = (id: string, runId = randomUUID(), reason = 'schedule', name?: string) => {
    reasons.set(runId, reason)
    if (name) names.set(runId, name)
    const scope = { podId: id, runId, epoch: 1, assignmentRevision: 1, capabilities: [] }
    return { runId, run: call(scope, 'shell'), call: (kind: ServiceRequest['kind'], body: unknown = {}) => call(scope, kind, body) }
  }
  // A run of a network member or decision maintenance: its service calls need no runtime grant.
  const plainCall = (id: string, kind: ServiceRequest['kind'], body: unknown, capabilities: string[] = []) => {
    const runId = randomUUID(); withoutRuntime.add(runId)
    return call({ podId: id, runId, epoch: 1, assignmentRevision: 1, capabilities }, kind, body)
  }
  // Cancels every open service call, as the worker does when a run is cancelled or times out.
  const abortAll = () => { for (const controller of (worker as unknown as { services: Map<string, AbortController> }).services.values()) controller.abort(new Error('Pod tool call cancelled')) }
  return { worker, store, ledger, grants, connection, approvals, bound, credentials, start, plainCall, abortAll, openExternal: vi.mocked(shell.openExternal) }
}
