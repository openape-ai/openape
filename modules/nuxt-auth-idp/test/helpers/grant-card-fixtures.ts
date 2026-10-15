import { join } from 'node:path'
import type { User } from '@openape/auth'
import type { OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import type { ServerShape } from '@openape/grants'
import { computeArgvHash, createInMemoryShapeStore, resolveProgramCall } from '@openape/grants'
import type { LoadedAdapter } from '@openape/shapes'
import { loadAdapter, resolveCommand } from '@openape/shapes'
import { withGrantCards } from '../../src/runtime/server/utils/grant-card'
import type { GrantWithCard } from '../../src/runtime/utils/grant-card'

/**
 * Grants as GET /api/grants/:id returns them, rendered from the real registry
 * adapters shipped in the monorepo. `fixtures/grant-cards.json` must equal
 * this output (checked, and regenerated with UPDATE_GRANT_CARD_FIXTURES=1, in
 * grant-card.test.ts) so browser tests, which cannot read adapter files,
 * render the same registry data.
 */

const PODS = join(__dirname, '../../../../apps/openape-pods')
export const POD_ID = '00000000-0000-4000-8000-000000000001'
// The registry entry pod-runtime as the IdP stores it; the Pods desktop ships no adapters since issue 1473 revision 4.
export const podRuntimeAdapter = loadAdapter('pod-runtime', join(__dirname, '../fixtures/pod-runtime-shapes.toml'))
export const gitAdapter = loadAdapter('git', join(PODS, 'examples/git-shapes.toml'))

function storeShape(loaded: LoadedAdapter): ServerShape {
  return { cli_id: loaded.adapter.cli.id, executable: loaded.adapter.cli.executable, description: '', operations: loaded.adapter.operations, source: 'builtin', digest: loaded.digest, createdAt: 0, updatedAt: 0 }
}

const shapes = new Map([podRuntimeAdapter, gitAdapter].map(loaded => [loaded.adapter.cli.id, storeShape(loaded)]))
export const getShape = async (cliId: string): Promise<ServerShape | null> => shapes.get(cliId) ?? null

const registrations: Record<string, User> = {
  'mail-digest+owner+example_com@id.example.com': { email: 'mail-digest+owner+example_com@id.example.com', name: 'Mail digest Pod', owner: 'owner@example.com', type: 'agent', isActive: true, createdAt: 0 },
  'rebase-agent+owner+example_com@id.example.com': { email: 'rebase-agent+owner+example_com@id.example.com', name: 'IURIO rebase', owner: 'owner@example.com', type: 'agent', isActive: true, createdAt: 0 },
}
export const findUser = async (email: string): Promise<User | null> => registrations[email] ?? null

/** A request the way `POST /api/grants/authorize` stores it: resolved by the IdP from the program call. */
export async function idpResolvedRequest(program: { name: string, sha256: string }, argv: string[], extra: Partial<OpenApeGrantRequest> = {}): Promise<OpenApeGrantRequest> {
  const call = await resolveProgramCall(createInMemoryShapeStore([...shapes.values()]), { program, argv })
  return { requester: 'agent@example.com', target_host: 'macmini', audience: 'shapes', grant_type: 'always', permissions: [call.detail.permission], authorization_details: [call.detail], command: call.executionArgv, execution_context: call.executionContext, ...extra }
}

/** A git binary none of the registry's tested digests names. */
export const UNTESTED_GIT_SHA256 = '5e'.repeat(32)

/** A request the way apes and the Pods desktop build it from an adapter. */
export async function shapedRequest(loaded: LoadedAdapter, argv: string[], extra: Partial<OpenApeGrantRequest> = {}): Promise<OpenApeGrantRequest> {
  const resolved = await resolveCommand(loaded, argv)
  return { requester: 'agent@example.com', target_host: 'macmini', audience: 'shapes', grant_type: 'once', permissions: [resolved.permission], authorization_details: [resolved.detail], execution_context: resolved.executionContext, ...extra }
}

export const podArgv = ['pod-runtime', 'run', '--pod', POD_ID, '--name', 'Mail digest', '--script', '/Users/owner/Pods/mail-digest/run.mjs', '--workspace', '/Users/owner/Pods/mail-digest/workspace', '--environment', '{"HOME":"/Users/owner/Pods/mail-digest/home","LANG":"de_AT.UTF-8"}']
export const pushArgv = ['git', '-C', '/Users/owner/repos/iurio', 'push', '--force-with-lease', 'origin', 'feature/rebase']
// The Pods graph gate decision from the owner's batch approval screenshot (issue 1477); no registry adapter describes it.
export const graphGateArgv = ['pods-graph-gate', 'approve', JSON.stringify({
  action: 'mail.archive',
  batchId: 'ed50790c-7d3b-4f0e-9c51-2a8b4f7c9a0e',
  expiresAt: 1792478942037,
  hash: 'fac5678a9e0d4c7b8f2e1a3d5c6b9e0f4a7d2c1b8e3f6a9d0c5b2e7f4a7f8091',
  object: 'phofmann@delta-mind.at:AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0Aihx0qtzv3k_XDmEEfSdYlgAJOdNU0wAA',
  owner: { issuer: 'https://id.openape.ai', subject: 'patrick@hofmann.eco' },
  podId: '129579b8-e03d-44b5-a44b-4de9f8cd7f89',
  version: 5,
})]

function pending(id: string, request: OpenApeGrantRequest): OpenApeGrant {
  return { id, status: 'pending', created_at: 1_791_960_000, request }
}

/** A command no adapter describes, as apes requests it: bound by its exact argv hash. */
export async function unshapedRequest(argv: string[], extra: Partial<OpenApeGrantRequest> = {}): Promise<OpenApeGrantRequest> {
  const cli = argv[0]!
  const hash = await computeArgvHash(argv)
  const permission = `${cli}.cli[name=${cli}].argv[hash=${hash}]#exec`
  return {
    requester: 'agent@example.com',
    target_host: 'macmini',
    audience: 'shapes',
    grant_type: 'once',
    command: argv,
    permissions: [permission],
    authorization_details: [{ type: 'openape_cli', cli_id: cli, operation_id: '_generic.exec', resource_chain: [{ resource: 'cli', selector: { name: cli } }, { resource: 'argv', selector: { hash } }], action: 'exec', permission, display: `Execute (unshaped): \`${argv.join(' ')}\``, risk: 'high', constraints: { exact_command: true } }],
    ...extra,
  }
}

export type CardFixtures = Record<'podRun' | 'gitPush' | 'unknown' | 'gitUntested' | 'graphGate', GrantWithCard>

export async function buildCardFixtures(): Promise<CardFixtures> {
  const podRun = pending('grant-pod-run', await shapedRequest(podRuntimeAdapter, podArgv, {
    requester: 'mail-digest+owner+example_com@id.example.com',
    target_host: `pods:${POD_ID}`,
    grant_type: 'always',
    reason: 'Run the stored script of Mail digest',
    summary: { title: 'Run the stored script of Mail digest', origin: 'Mail digest' },
  }))
  const gitPush = pending('grant-git-push', await shapedRequest(gitAdapter, pushArgv, {
    requester: 'rebase-agent+owner+example_com@id.example.com',
    command: pushArgv,
    summary: { title: 'Read-only status check', description: 'Rebased feature/rebase onto main; 12 commits replayed.', origin: 'IURIO rebase Pod', link: 'https://repos.example.com/iurio/pulls/42' },
  }))
  const unknown = pending('grant-unknown', await unshapedRequest(['acme-cli', 'deploy', '--env', 'production'], {
    summary: { title: 'Deploy the hotfix', description: 'Ticket 7: roll out the login fix.' },
  }))
  const gitUntested = pending('grant-git-untested', await idpResolvedRequest({ name: 'git', sha256: UNTESTED_GIT_SHA256 }, pushArgv.slice(1), {
    requester: 'rebase-agent+owner+example_com@id.example.com',
    summary: { title: 'Push the rebased branch', origin: 'IURIO rebase Pod' },
  }))
  const graphGate = pending('grant-graph-gate', await unshapedRequest(graphGateArgv, {
    requester: 'mail-triage+owner+example_com@id.example.com',
    target_host: 'pods:129579b8-e03d-44b5-a44b-4de9f8cd7f89',
    audience: 'pods-graph-gate',
    summary: { title: '62 Personen haben sich Ihr Profil angesehen' },
  }))
  const [podRunCard, gitPushCard, unknownCard, gitUntestedCard, graphGateCard] = await withGrantCards([podRun, gitPush, unknown, gitUntested, graphGate], { getShape, findUser })
  return { podRun: podRunCard!, gitPush: gitPushCard!, unknown: unknownCard!, gitUntested: gitUntestedCard!, graphGate: graphGateCard! }
}
