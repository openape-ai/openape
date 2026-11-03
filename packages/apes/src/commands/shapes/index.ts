import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'
import type { ServerShape } from '@openape/grants'
import { parseAdapterToml } from '@openape/shapes'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError } from '../../errors'
import { ApiError, apiFetch } from '../../http'

type Scope = 'personal' | 'domain' | 'instance'

/** A continuing grant one shape write affects (server: shape-tiers.ts). */
interface AffectedGrant {
  id: string
  requester: string
  cli_id?: string
  operation_id: string
  grant_type: string
  decided_at: number | null
}

/** A continuing grant whose reuse depends on a personal or domain shape. */
interface OwnerShapeGrant extends AffectedGrant {
  digest_current: boolean
}

interface OverriddenShape {
  cli_id: string
  tier: 'domain' | 'instance'
  by: string
  grants: AffectedGrant[]
}

interface ImportReport {
  scope: Scope
  scope_key: string | null
  dry_run: boolean
  saved: boolean
  added: string[]
  rules_changed: string[]
  text_changed: string[]
  removed: string[]
  unchanged: string[]
  grants_losing_reuse: AffectedGrant[]
  grants_keeping_reuse: AffectedGrant[]
  overrides: OverriddenShape[]
}

interface OwnerShapeView {
  cli_id: string
  executable: string
  digest: string
  toml: string | null
  operations: ServerShape['operations']
  created_at: number
  published_at: number
  published_by?: string | null
  bound_grants: OwnerShapeGrant[]
}

interface PublishResult {
  saved: boolean
  shape: OwnerShapeView
  replaced_digest: string | null
  grants_losing_reuse: AffectedGrant[]
  overrides?: OverriddenShape[]
}

const SCOPES = new Set<Scope>(['personal', 'domain', 'instance'])

function readScope(value: unknown): Scope {
  const scope = String(value ?? 'personal') as Scope
  if (!SCOPES.has(scope))
    throw new CliError(`--scope must be personal, domain or instance, not ${JSON.stringify(value)}`)
  return scope
}

/**
 * Calls the shape endpoints of one tier. IdP-wide shapes use the management
 * token, read only from `APES_MANAGEMENT_TOKEN` so it never appears in
 * `ps` or shell history; personal and domain shapes use the signed-in
 * human's token at the IdP that issued it. Agent, Pod and brokered logins
 * are refused locally; anything else the IdP refuses surfaces with its
 * problem title.
 */
async function shapeFetch<T>(scope: Scope, path: string, options: { method?: string, body?: unknown } = {}): Promise<T> {
  let target: { idp?: string, token?: string }
  if (scope === 'instance') {
    const token = process.env.APES_MANAGEMENT_TOKEN
    if (!token)
      throw new CliError('IdP-wide shapes need the management token. Set APES_MANAGEMENT_TOKEN in the environment.')
    const idp = getIdpUrl()
    if (!idp)
      throw new CliError('No IdP URL configured. Set APES_IDP or run `apes login`.')
    target = { idp, token }
  }
  else {
    const auth = loadAuth()
    if (!auth)
      throw new CliError('Not logged in. Run `apes login` first.')
    if (auth.agent_key_id || auth.brokered || auth.email.includes('agent+'))
      throw new CliError(`Only a human can manage ${scope} shapes; ${auth.email} is not a direct human login. Run \`apes login\` as yourself.`)
    target = { idp: auth.idp }
  }
  try {
    return await apiFetch<T>(path, { ...options, ...target })
  }
  catch (error) {
    if (error instanceof ApiError)
      throw new CliError(String((error.problemDetails?.data as { title?: unknown } | undefined)?.title ?? error.problemDetails?.title ?? error.message))
    throw error
  }
}

/** The shape's URL; personal shapes keep the scope-less URL that IdPs before issue 1553 understand. */
function shapePath(cliId: string, scope: Scope, dryRun = false): string {
  const query = new URLSearchParams({ ...(scope === 'personal' ? {} : { scope }), ...(dryRun ? { dry_run: '1' } : {}) }).toString()
  return `/api/shapes/${encodeURIComponent(cliId)}${query ? `?${query}` : ''}`
}

const VISIBILITY: Record<Scope, string> = {
  personal: 'Visible only to you.',
  domain: 'Used for every account of your domain.',
  instance: 'Used for every account of this IdP.',
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printGrants(grants: AffectedGrant[]): void {
  for (const grant of grants)
    console.log(`  ${grant.id.padEnd(38)} ${grant.requester.padEnd(32)} ${grant.operation_id.padEnd(28)} ${grant.grant_type}`)
}

function printOverrides(overrides: OverriddenShape[] = []): void {
  for (const override of overrides) {
    console.log(`Overrides the ${override.tier === 'instance' ? 'IdP-wide' : 'domain'} shape ${override.cli_id} with ${override.by}; ${override.grants.length} continuing grant(s) of it stop covering these calls.`)
    printGrants(override.grants)
  }
}

function printPreview({ shape, replaced_digest, grants_losing_reuse, overrides }: PublishResult, scope: Scope): void {
  console.log(`Shape:       ${shape.cli_id}`)
  console.log(`Executable:  ${shape.executable}`)
  console.log(`Digest:      ${shape.digest}`)
  console.log('Operations:')
  for (const operation of shape.operations)
    console.log(`  ${operation.id.padEnd(28)} ${(operation.command.join(' ') || '-').padEnd(20)} ${operation.action.padEnd(8)} ${operation.risk.padEnd(8)} ${operation.display}`)
  console.log(VISIBILITY[scope])
  printOverrides(overrides)
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

/** One adapter of an import directory, with its registry description when `meta.json` has one. */
interface AdapterFile {
  path: string
  toml: string
  description?: string
}

function readDescription(metaPath: string): string | undefined {
  if (!existsSync(metaPath))
    return undefined
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { description?: unknown }
    return typeof meta.description === 'string' ? meta.description : undefined
  }
  catch (error) {
    throw new CliError(`Invalid ${metaPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * The adapters of an import directory: the shapes-registry layout
 * (`adapters/<id>/adapter.toml` with `meta.json`), a folder of
 * `<id>/adapter.toml`, or a folder of `*.toml` files.
 */
export function readAdapterDirectory(dir: string): AdapterFile[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    throw new CliError(`${dir} is not a directory`)
  const root = existsSync(join(dir, 'adapters')) ? join(dir, 'adapters') : dir
  const files: AdapterFile[] = []
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name)
    if (statSync(path).isDirectory()) {
      const adapter = join(path, 'adapter.toml')
      if (existsSync(adapter))
        files.push({ path: adapter, toml: readFileSync(adapter, 'utf8'), description: readDescription(join(path, 'meta.json')) })
    }
    else if (name.endsWith('.toml')) {
      files.push({ path, toml: readFileSync(path, 'utf8') })
    }
  }
  if (!files.length)
    throw new CliError(`No adapter.toml found in ${dir}`)
  for (const file of files) readCliId(file.path, file.toml)
  return files
}

function git(dir: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  }
  catch {
    return undefined
  }
}

/** The provenance the import claims: remote (without credentials), commit and uncommitted changes; the IdP records it unverified. */
export function claimedSource(dir: string): { repo?: string, commit?: string, dirty?: boolean } | undefined {
  const commit = git(dir, ['rev-parse', 'HEAD'])
  if (!commit)
    return undefined
  const remote = git(dir, ['remote', 'get-url', 'origin'])
  let repo: string | undefined
  if (remote) {
    try {
      const url = new URL(remote)
      url.username = ''
      url.password = ''
      repo = url.toString()
    }
    catch {
      repo = remote.includes('@') && !remote.includes('://') ? remote : undefined
    }
  }
  return { ...(repo ? { repo } : {}), commit, dirty: !!git(dir, ['status', '--porcelain']) }
}

function printReport(report: ImportReport): void {
  const where = report.scope === 'instance' ? 'IdP-wide' : report.scope === 'domain' ? `domain ${report.scope_key}` : `personal (${report.scope_key})`
  console.log(`Scope:          ${where}`)
  for (const [label, ids] of [['Added', report.added], ['Rules changed', report.rules_changed], ['Text changed', report.text_changed], ['Removed', report.removed]] as const)
    console.log(`${`${label}:`.padEnd(16)}${ids.length ? ids.join(', ') : '-'}`)
  console.log(`Unchanged:      ${report.unchanged.length}`)
  if (report.grants_losing_reuse.length) {
    console.log(`${report.grants_losing_reuse.length} continuing grant(s) stop being reused:`)
    printGrants(report.grants_losing_reuse)
  }
  if (report.grants_keeping_reuse.length) {
    console.log(`${report.grants_keeping_reuse.length} IdP-wide continuing grant(s) keep working under changed rules:`)
    printGrants(report.grants_keeping_reuse)
  }
  printOverrides(report.overrides)
}

const scopeArg = {
  type: 'string',
  description: 'Shape tier: personal (default), domain (root admins and operators) or instance (APES_MANAGEMENT_TOKEN)',
  default: 'personal',
} as const

const jsonArg = {
  type: 'boolean',
  description: 'Output as JSON',
  default: false,
} as const

/** Shapes of three tiers (issues 1551, 1553): personal, domain and IdP-wide, all written through the same IdP checks and audit. */
export const shapesCommand = defineCommand({
  meta: {
    name: 'shapes',
    description: 'Publish, import and manage personal, domain and IdP-wide shapes',
  },
  subCommands: {
    publish: defineCommand({
      meta: {
        name: 'publish',
        description: 'Preview and publish one adapter.toml as a shape',
      },
      args: {
        path: { type: 'positional', description: 'Path to adapter.toml', required: true },
        'scope': scopeArg,
        'dry-run': { type: 'boolean', description: 'Only preview; do not publish', default: false },
        'yes': { type: 'boolean', description: 'Publish even when continuing grants stop being reused or covering', default: false },
        'json': jsonArg,
      },
      async run({ args }) {
        const scope = readScope(args.scope)
        const path = String(args.path)
        let toml: string
        try {
          toml = readFileSync(path, 'utf8')
        }
        catch (error) {
          throw new CliError(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
        }
        const cliId = readCliId(path, toml)
        const preview = await shapeFetch<PublishResult>(scope, shapePath(cliId, scope, true), { method: 'PUT', body: { toml } })
        if (!args.json)
          printPreview(preview, scope)
        if (args['dry-run']) {
          if (args.json)
            printJson(preview)
          else
            consola.info('Dry run: nothing published.')
          return
        }
        // Same safeguard as the IdP page, which publishes only after a separate click on the preview.
        const affected = preview.grants_losing_reuse.length + (preview.overrides ?? []).reduce((sum, override) => sum + override.grants.length, 0)
        if (affected && !args.yes)
          throw new CliError(`Not published: ${affected} continuing grant(s) would stop being reused or covering. Re-run with --yes to publish anyway.`)
        const result = await shapeFetch<PublishResult>(scope, shapePath(cliId, scope), { method: 'PUT', body: { toml } })
        if (args.json)
          printJson(result)
        else
          consola.success(`Published ${result.shape.cli_id} (${result.shape.digest}).`)
      },
    }),

    import: defineCommand({
      meta: {
        name: 'import',
        description: 'Import every adapter of a directory (shapes-registry layout or adapter.toml files) as one all-or-nothing batch',
      },
      args: {
        dir: { type: 'positional', description: 'Directory: a shapes-registry checkout, <id>/adapter.toml folders or *.toml files', required: true },
        'scope': scopeArg,
        'dry-run': { type: 'boolean', description: 'Only show what would change', default: false },
        'prune': { type: 'boolean', description: 'Remove shapes of this tier that the directory no longer contains', default: false },
        'yes': { type: 'boolean', description: 'Import even when continuing grants stop being reused or covering', default: false },
        'json': jsonArg,
      },
      async run({ args }) {
        const scope = readScope(args.scope)
        const dir = String(args.dir)
        const files = readAdapterDirectory(dir)
        const source = claimedSource(dir)
        const body = { shapes: files.map(file => ({ toml: file.toml, ...(file.description ? { description: file.description } : {}) })), ...(args.prune ? { prune: true } : {}), ...(source ? { source } : {}) }
        const path = `/api/shapes/import?scope=${scope}`
        const preview = await shapeFetch<ImportReport>(scope, `${path}&dry_run=1`, { method: 'POST', body })
        if (!args.json) {
          console.log(`Source:         ${source ? `${source.commit}${source.dirty ? ' (uncommitted changes)' : ''}` : 'not a Git checkout'}`)
          printReport(preview)
        }
        if (args['dry-run']) {
          if (args.json)
            printJson(preview)
          else
            consola.info('Dry run: nothing imported.')
          return
        }
        const changes = preview.added.length + preview.rules_changed.length + preview.text_changed.length + preview.removed.length
        if (!changes) {
          if (args.json)
            printJson(preview)
          else
            consola.success('Nothing to import: every shape is unchanged.')
          return
        }
        const affected = preview.grants_losing_reuse.length + preview.overrides.reduce((sum, override) => sum + override.grants.length, 0)
        if (affected && !args.yes)
          throw new CliError(`Not imported: ${affected} continuing grant(s) would stop being reused or covering. Re-run with --yes to import anyway.`)
        const result = await shapeFetch<ImportReport>(scope, path, { method: 'POST', body })
        if (args.json)
          printJson(result)
        else
          consola.success(`Imported ${changes} change(s) into the ${scope} tier.`)
      },
    }),

    list: defineCommand({
      meta: {
        name: 'list',
        description: 'List the shapes of one tier',
      },
      args: {
        mine: { type: 'boolean', description: 'List the shapes you published (same as --scope personal)', default: false },
        scope: { type: 'string', description: 'Shape tier: personal, domain or instance' },
        json: jsonArg,
      },
      async run({ args }) {
        if (!args.mine && args.scope === undefined)
          throw new CliError('Pass --mine or --scope personal|domain|instance; `apes adapter list` shows the shared registry.')
        const scope = args.mine ? 'personal' : readScope(args.scope)
        // IdP-wide shapes are public; only writing them needs the management token.
        const shapes = await shapeFetch<OwnerShapeView[]>(scope === 'instance' ? 'personal' : scope, scope === 'personal' ? '/api/shapes?mine=1' : `/api/shapes?scope=${scope}`)
        if (args.json) {
          printJson(shapes)
          return
        }
        if (shapes.length === 0) {
          consola.info(scope === 'personal' ? 'You have not published any shape.' : `There is no ${scope} shape.`)
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
        description: 'Remove one shape of a tier',
      },
      args: {
        id: { type: 'positional', description: 'Shape (CLI) ID', required: true },
        scope: scopeArg,
        json: jsonArg,
      },
      async run({ args }) {
        const scope = readScope(args.scope)
        const result = await shapeFetch<{ removed: boolean, grants_losing_reuse: AffectedGrant[] }>(scope, shapePath(String(args.id), scope), { method: 'DELETE' })
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
