import { join } from 'node:path'
import type { User } from '@openape/auth'
import type { OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import type { ServerShape } from '@openape/grants'
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
export const podRuntimeAdapter = loadAdapter('pod-runtime', join(PODS, 'runtime-sources/pod-runtime-shapes.toml'))
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

/** A request the way apes and the Pods desktop build it from an adapter. */
export async function shapedRequest(loaded: LoadedAdapter, argv: string[], extra: Partial<OpenApeGrantRequest> = {}): Promise<OpenApeGrantRequest> {
  const resolved = await resolveCommand(loaded, argv)
  return { requester: 'agent@example.com', target_host: 'macmini', audience: 'shapes', grant_type: 'once', permissions: [resolved.permission], authorization_details: [resolved.detail], execution_context: resolved.executionContext, ...extra }
}

export const podArgv = ['pod-runtime', 'run', '--pod', POD_ID, '--name', 'Mail digest', '--script', '/Users/owner/Pods/mail-digest/run.mjs', '--workspace', '/Users/owner/Pods/mail-digest/workspace', '--environment', '{"HOME":"/Users/owner/Pods/mail-digest/home","LANG":"de_AT.UTF-8"}']
export const pushArgv = ['git', '-C', '/Users/owner/repos/iurio', 'push', '--force-with-lease', 'origin', 'feature/rebase']

function pending(id: string, request: OpenApeGrantRequest): OpenApeGrant {
  return { id, status: 'pending', created_at: 1_791_960_000, request }
}

export type CardFixtures = Record<'podRun' | 'gitPush' | 'unknown', GrantWithCard>

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
  const unknown = pending('grant-unknown', {
    requester: 'agent@example.com',
    target_host: 'macmini',
    audience: 'shapes',
    grant_type: 'once',
    command: ['acme-cli', 'deploy', '--env', 'production'],
    permissions: ['acme-cli.cli[name=acme-cli].argv[hash=SHA-256:9f]#exec'],
    authorization_details: [{ type: 'openape_cli', cli_id: 'acme-cli', operation_id: '_generic.exec', resource_chain: [{ resource: 'cli', selector: { name: 'acme-cli' } }, { resource: 'argv', selector: { hash: 'SHA-256:9f' } }], action: 'exec', permission: 'acme-cli.cli[name=acme-cli].argv[hash=SHA-256:9f]#exec', display: 'Execute (unshaped): `acme-cli deploy --env production`', risk: 'high', constraints: { exact_command: true } }],
    summary: { title: 'Deploy the hotfix', description: 'Ticket 7: roll out the login fix.' },
  })
  const [podRunCard, gitPushCard, unknownCard] = await withGrantCards([podRun, gitPush, unknown], { getShape, findUser })
  return { podRun: podRunCard!, gitPush: gitPushCard!, unknown: unknownCard! }
}
