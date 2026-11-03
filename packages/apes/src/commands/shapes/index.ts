import { readFileSync } from 'node:fs'
import { defineCommand } from 'citty'
import consola from 'consola'
import type { ServerShape } from '@openape/grants'
import { parseAdapterToml } from '@openape/shapes'
import { loadAuth } from '../../config'
import { CliError } from '../../errors'
import { ApiError, apiFetch } from '../../http'

/** A continuing grant whose reuse depends on an owner shape (server: owner-shapes.ts). */
interface OwnerShapeGrant {
  id: string
  requester: string
  operation_id: string
  grant_type: string
  decided_at: number | null
  digest_current: boolean
}

interface OwnerShapeView {
  cli_id: string
  executable: string
  digest: string
  toml: string | null
  operations: ServerShape['operations']
  created_at: number
  published_at: number
  bound_grants: OwnerShapeGrant[]
}

interface PublishResult {
  saved: boolean
  shape: OwnerShapeView
  replaced_digest: string | null
  grants_losing_reuse: OwnerShapeGrant[]
}

/**
 * Calls the owner-shape endpoints with the signed-in human's token at the IdP that issued it. Agent, Pod
 * and brokered logins are refused locally; anything else the IdP refuses surfaces with its problem title.
 */
async function ownerFetch<T>(path: string, options: { method?: string, body?: unknown } = {}): Promise<T> {
  const auth = loadAuth()
  if (!auth)
    throw new CliError('Not logged in. Run `apes login` first.')
  if (auth.agent_key_id || auth.brokered || auth.email.includes('agent+'))
    throw new CliError(`Only the human owner can manage shapes; ${auth.email} is not a direct human login. Run \`apes login\` as the owner.`)
  try {
    return await apiFetch<T>(path, { ...options, idp: auth.idp })
  }
  catch (error) {
    if (error instanceof ApiError)
      throw new CliError(String(error.problemDetails?.title ?? error.message))
    throw error
  }
}

function shapePath(cliId: string): string {
  return `/api/shapes/${encodeURIComponent(cliId)}`
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printGrants(grants: OwnerShapeGrant[]): void {
  for (const grant of grants)
    console.log(`  ${grant.id.padEnd(38)} ${grant.requester.padEnd(32)} ${grant.operation_id.padEnd(28)} ${grant.grant_type}`)
}

function printPreview({ shape, replaced_digest, grants_losing_reuse }: PublishResult): void {
  console.log(`Shape:       ${shape.cli_id}`)
  console.log(`Executable:  ${shape.executable}`)
  console.log(`Digest:      ${shape.digest}`)
  console.log('Operations:')
  for (const operation of shape.operations)
    console.log(`  ${operation.id.padEnd(28)} ${(operation.command.join(' ') || '-').padEnd(20)} ${operation.action.padEnd(8)} ${operation.risk.padEnd(8)} ${operation.display}`)
  console.log('Visible only to you.')
  if (!replaced_digest || replaced_digest === shape.digest)
    return
  console.log(`Replaces ${replaced_digest}; ${grants_losing_reuse.length} continuing grant(s) stop being reused.`)
  printGrants(grants_losing_reuse)
}

function readCliId(path: string, toml: string): string {
  try {
    return parseAdapterToml(toml).cli.id
  }
  catch (error) {
    throw new CliError(`Invalid adapter ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const jsonArg = {
  type: 'boolean',
  description: 'Output as JSON',
  default: false,
} as const

/** The signed-in owner's own shapes (issue 1551): published to their IdP, visible and used only for them. */
export const shapesCommand = defineCommand({
  meta: {
    name: 'shapes',
    description: 'Publish and manage the shapes of tools you built',
  },
  subCommands: {
    publish: defineCommand({
      meta: {
        name: 'publish',
        description: 'Preview and publish an adapter.toml as your own shape',
      },
      args: {
        path: { type: 'positional', description: 'Path to adapter.toml', required: true },
        'dry-run': { type: 'boolean', description: 'Only preview; do not publish', default: false },
        'yes': { type: 'boolean', description: 'Publish even when continuing grants stop being reused', default: false },
        json: jsonArg,
      },
      async run({ args }) {
        const path = String(args.path)
        let toml: string
        try {
          toml = readFileSync(path, 'utf8')
        }
        catch (error) {
          throw new CliError(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
        }
        const url = shapePath(readCliId(path, toml))
        const preview = await ownerFetch<PublishResult>(`${url}?dry_run=1`, { method: 'PUT', body: { toml } })
        if (!args.json)
          printPreview(preview)
        if (args['dry-run']) {
          if (args.json)
            printJson(preview)
          else
            consola.info('Dry run: nothing published.')
          return
        }
        // Same safeguard as the IdP page, which publishes only after a separate click on the preview.
        if (preview.grants_losing_reuse.length && !args.yes)
          throw new CliError(`Not published: ${preview.grants_losing_reuse.length} continuing grant(s) would stop being reused. Re-run with --yes to publish anyway.`)
        const result = await ownerFetch<PublishResult>(url, { method: 'PUT', body: { toml } })
        if (args.json)
          printJson(result)
        else
          consola.success(`Published ${result.shape.cli_id} (${result.shape.digest}).`)
      },
    }),

    list: defineCommand({
      meta: {
        name: 'list',
        description: 'List your own shapes',
      },
      args: {
        mine: { type: 'boolean', description: 'List the shapes you published', default: false },
        json: jsonArg,
      },
      async run({ args }) {
        if (!args.mine)
          throw new CliError('Pass --mine to list your own shapes; `apes adapter list` shows the shared registry.')
        const shapes = await ownerFetch<OwnerShapeView[]>('/api/shapes?mine=1')
        if (args.json) {
          printJson(shapes)
          return
        }
        if (shapes.length === 0) {
          consola.info('You have not published any shape.')
          return
        }
        console.log(`  ${'ID'.padEnd(24)} ${'OPS'.padEnd(4)} ${'DIGEST'.padEnd(14)} ${'PUBLISHED'.padEnd(10)} GRANTS`)
        for (const shape of shapes) {
          const digest = shape.digest.replace(/^SHA-256:/, '').slice(0, 12)
          const published = new Date(shape.published_at * 1000).toISOString().slice(0, 10)
          console.log(`  ${shape.cli_id.padEnd(24)} ${String(shape.operations.length).padEnd(4)} ${digest.padEnd(14)} ${published.padEnd(10)} ${shape.bound_grants.length}`)
        }
      },
    }),

    remove: defineCommand({
      meta: {
        name: 'remove',
        description: 'Remove one of your shapes',
      },
      args: {
        id: { type: 'positional', description: 'Shape (CLI) ID', required: true },
        json: jsonArg,
      },
      async run({ args }) {
        const result = await ownerFetch<{ removed: boolean, grants_losing_reuse: OwnerShapeGrant[] }>(shapePath(String(args.id)), { method: 'DELETE' })
        if (args.json) {
          printJson(result)
          return
        }
        consola.success(`Removed ${args.id}; ${result.grants_losing_reuse.length} continuing grant(s) stop being reused.`)
        printGrants(result.grants_losing_reuse)
      },
    }),
  },
})
