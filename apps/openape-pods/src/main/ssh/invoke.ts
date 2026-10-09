import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { loadAdapter, resolveCommand } from '@openape/apes'
import type { PodResource } from '../../contracts/resources'
import { assignedSsh } from '../../contracts/ssh'
import type { ServiceScope } from '../../contracts/services'
import type { CredentialCache } from '../connections/cache'
import { PodIdentityManager } from '../connections/agent'
import { AgentAuthority } from '../broker/authorization'
import type { GrantObserver, GrantLookup, RunGrantTokens } from '../broker/authorization'
import { superviseProcess } from '../../worker/runtime/sandbox'
import type { ProcessDomain } from '../../worker/runtime/sandbox'
import { resolveSshTarget, sshConfiguration, sshGrantArgv } from './configuration'
import { inventoryCommand, parseInventoryOutput } from './profile'

export async function collectInventory(domain: ProcessDomain, signal: AbortSignal, check: () => Promise<void>, timeoutMs = 45000): Promise<Record<string, unknown>> {
  let bytes = 0; const chunks: Buffer[] = []
  const abort = new AbortController()
  const combined = AbortSignal.any([signal, abort.signal])
  const stop = () => domain.cancel()
  combined.addEventListener('abort', stop, { once: true })
  if (combined.aborted) stop()
  const append = (chunk: Buffer, output: boolean) => {
    bytes += chunk.length
    if (bytes > 128 * 1024) abort.abort(new Error('SSH inventory output exceeds its limit'))
    else if (output) chunks.push(chunk)
  }
  domain.stdout.on('data', chunk => append(chunk, true))
  domain.stderr.on('data', chunk => append(chunk, false))
  const deadline = setTimeout(() => abort.abort(new Error('SSH inventory timed out')), timeoutMs)
  const monitor = new AbortController()
  const poll = async () => {
    try { while (!monitor.signal.aborted) { await delay(1000, undefined, { signal: monitor.signal }); await check() } }
    catch (error) { if (!monitor.signal.aborted) abort.abort(error) }
  }
  const watching = poll()
  try {
    await domain.processId
    const exitCode = await domain.completed
    combined.throwIfAborted()
    await check(); combined.throwIfAborted()
    if (exitCode !== 0) throw new Error(`SSH inventory failed (exit ${exitCode}); check the reviewed route, host key, authentication and noninteractive sudo`)
    return parseInventoryOutput(Buffer.concat(chunks).toString('utf8'))
  }
  finally {
    clearTimeout(deadline); monitor.abort(); combined.removeEventListener('abort', stop)
    domain.cancel(); await domain.completed; await watching
  }
}

export async function invokeSsh(input: { resources: PodResource[], scope: ServiceScope, body: unknown, dist: string, root: string, credentials: CredentialCache, signal: AbortSignal, check: (domain?: { path: string, ownerPid: number }) => Promise<unknown>, observe?: GrantObserver, previous?: GrantLookup, tokens?: RunGrantTokens }) {
  const { resources, scope, body, dist, credentials, signal, check, observe, previous } = input
  const assignment = assignedSsh(resources, scope.podId, scope.capabilities, body)
  const binding = await resolveSshTarget(assignment.target)
  if (JSON.stringify(binding) !== JSON.stringify({ profileHash: assignment.profileHash, target: assignment.target, hosts: assignment.hosts, knownHosts: assignment.knownHosts })) throw new Error('SSH configuration changed; review and reassign this target')
  const authority = new AgentAuthority(new PodIdentityManager(credentials).connection(assignment.authority.identity, `pods:${scope.podId}`), observe, previous, undefined, input.tokens)
  const adapterPath = join(dist, 'vendor/pod-ssh-shapes.toml')
  const adapter = loadAdapter('pod-ssh', adapterPath); const argv = sshGrantArgv(binding)
  const resolved = await resolveCommand(adapter, argv)
  const authorization = { grantId: assignment.authority.grantId, command: { cliId: 'pod-ssh', adapterPath, adapterDigest: adapter.digest, argv, permission: resolved.permission } }
  await authority.authorize(authorization, signal)
  const current = async () => { await check(); signal.throwIfAborted() }
  await current()
  await mkdir(input.root, { recursive: true, mode: 0o700 })
  const workspace = await mkdtemp(join(input.root, 'ssh-'))
  try {
    const config = join(workspace, 'config')
    await writeFile(config, sshConfiguration(binding), { mode: 0o600, flag: 'wx' })
    await current()
    const domain = await superviseProcess(join(dist, 'native/pods-helper'), '/usr/bin/ssh', ['-F', 'config', '-T', ...(binding.target.jumps.length ? ['-J', binding.target.jumps.join(',')] : []), binding.target.alias, inventoryCommand()], workspace, {}, input.root, async (path, ownerPid) => { await check({ path, ownerPid }); signal.throwIfAborted() })
    return await collectInventory(domain, signal, current)
  }
  finally { await rm(workspace, { recursive: true, force: true }) }
}
