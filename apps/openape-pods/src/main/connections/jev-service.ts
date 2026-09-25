import { join } from 'node:path'
import { loadAdapter, resolveCommand } from '@openape/apes'
import type { JevAssignment, JevEvaluation, JevRequest } from '../../contracts/jev'
import { typesafeOrigin } from '../../contracts/jev'
import { AgentAuthority } from '../broker/authorization'
import type { GrantLookup, GrantObserver } from '../broker/authorization'
import { PodIdentityManager } from './agent'
import type { CredentialCache } from './cache'
import { evaluateTypesafe } from './typesafe'

export async function executeJev(assignment: JevAssignment, request: JevRequest, options: {
  vendor: string
  credentials: CredentialCache
  signal: AbortSignal
  observe: GrantObserver
  previous: GrantLookup
  check: () => Promise<unknown>
  send: (body: string, signal: AbortSignal) => Promise<Response>
  consumeAttempt: () => void
}): Promise<JevEvaluation> {
  const identity = new PodIdentityManager(options.credentials)
  const authority = new AgentAuthority(identity.connection(assignment.authority.identity, `pods:${assignment.authority.identity.podId}`), options.observe, options.previous)
  const adapterPath = join(options.vendor, 'pod-http-shapes.toml')
  const adapter = loadAdapter('pod-http', adapterPath)
  const argv = ['pod-http', 'request', '--origin', typesafeOrigin, '--method', 'POST']
  const resolved = await resolveCommand(adapter, argv)
  const authorization = { grantId: assignment.authority.grantId, command: { cliId: 'pod-http', adapterPath, adapterDigest: adapter.digest, argv, permission: resolved.permission } }
  await authority.authorize(authorization, options.signal)
  const revoked = new AbortController()
  const signal = AbortSignal.any([options.signal, revoked.signal])
  let checking: Promise<void> | undefined
  const inspect = async () => { await options.check(); await authority.assertActive(authorization.grantId, signal) }
  const monitor = async () => {
    try { await inspect() }
    catch { revoked.abort(new Error('Jev permission is no longer active')) }
  }
  const timer = setInterval(() => { if (!checking) checking = monitor().finally(() => { checking = undefined }) }, 1000)
  try {
    const result = await evaluateTypesafe(request, assignment.model, signal, async (body, attemptSignal) => {
      await inspect(); attemptSignal.throwIfAborted()
      const response = await options.send(body, attemptSignal)
      try { await inspect(); attemptSignal.throwIfAborted(); return response }
      catch (error) { await response.body?.cancel(); throw error }
    }, options.consumeAttempt)
    await inspect(); signal.throwIfAborted()
    return result
  }
  finally { clearInterval(timer); revoked.abort(); if (checking) await checking }
}
