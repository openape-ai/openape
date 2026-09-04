import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { buildAgentPatch } from './plan'

const DEFAULT_IDENTITY_ROOT = path.join(homedir(), 'agent-identities')

const USAGE = `apes openclaw — set up openape-gated OpenClaw agents

Usage:
  apes openclaw add <agentId> [options]

Options:
  --home <dir>     Root for agent identity homes (default: ~/agent-identities)
  --image <ref>    Sandbox image (default: ghcr.io/openape-ai/apes-sandbox:latest)
  --bind <spec>    Extra host folder as host:container:mode (repeatable)
  --dry-run        Show the config patch without writing anything
  --skip-enroll    Assume the identity already exists
  --help           Show this message
`

function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv, input?: string } = {}): void {
  const result = spawnSync(command, args, {
    stdio: options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    input: options.input,
    env: options.env ?? process.env,
  })

  const code = (result.error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT')
    throw new Error(`${command} not found on PATH.`)
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`${command} ${args[0] ?? ''} failed with exit code ${result.status}.`)
}

/**
 * Mint the agent's identity by running `apes enroll` with HOME pointed at the
 * agent's own home. Overriding HOME rather than APES_AUTH_FILE keeps the
 * agent's key, auth.json and config.toml together in one directory and leaves
 * the operator's own `~/.config/apes` untouched.
 */
function enroll(agentId: string, agentHome: string): void {
  run('apes', ['enroll', '--name', agentId], { env: { ...process.env, HOME: agentHome } })
}

const GATE_PLUGIN_ID = 'openape-grant-gate'

/**
 * Refuse to set the agent up unless the grant gate is actually installed.
 *
 * The patch enables elevated exec, and OpenClaw silently ignores a
 * `plugins.entries` record whose plugin is not installed. Writing it anyway
 * would hand the agent a host escape with no gate behind it — the exact
 * inverse of what this command promises, and invisible afterwards.
 */
function requireGatePlugin(): void {
  const probe = spawnSync('openclaw', ['plugins', 'inspect', GATE_PLUGIN_ID, '--json'], { stdio: 'ignore' })
  if ((probe.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT')
    throw new Error('openclaw not found on PATH.')
  if (probe.status !== 0) {
    throw new Error(
      `${GATE_PLUGIN_ID} is not installed — refusing to enable elevated exec without it.\n`
      + `  Install it first:  openclaw plugins install clawhub:@openape/${GATE_PLUGIN_ID}`,
    )
  }
}

function add(agentId: string, options: { home: string, image?: string, binds: string[], dryRun: boolean, skipEnroll: boolean }): void {
  const agentHome = path.join(options.home, agentId)
  const apesConfig = path.join(agentHome, '.config', 'apes')
  const authFile = path.join(apesConfig, 'auth.json')

  requireGatePlugin()

  if (!options.dryRun) {
    // sp-tokens must exist before the sandbox starts: Docker cannot create the
    // mountpoint for the writable overlay inside a read-only parent mount.
    mkdirSync(path.join(apesConfig, 'sp-tokens'), { recursive: true })
    mkdirSync(path.join(agentHome, '.ssh'), { recursive: true, mode: 0o700 })
  }

  if (!existsSync(authFile) && !options.skipEnroll && !options.dryRun) {
    console.log(`No identity at ${authFile} — enrolling ${agentId}.`)
    enroll(agentId, agentHome)
  }

  const patch = buildAgentPatch({ agentId, agentHome, image: options.image, binds: options.binds })
  const patchArgs = ['config', 'patch', '--stdin', ...(options.dryRun ? ['--dry-run'] : [])]
  run('openclaw', patchArgs, { input: JSON.stringify(patch, null, 2) })

  if (options.dryRun) {
    console.log(JSON.stringify(patch, null, 2))
    return
  }

  // `config patch` only writes the file. Changes under `plugins.entries` need a
  // restart before the gate knows about this agent, so claiming success without
  // one would announce a gate that is not loaded yet.
  run('openclaw', ['gateway', 'restart'])
  run('openclaw', ['sandbox', 'recreate', '--agent', agentId])
  console.log(`\nAgent ${agentId} is gated.`)
  console.log(`  identity: ${authFile}`)
  console.log(`  approvals: every sandbox escape becomes a grant request as ${agentId}`)
}

function main(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'home': { type: 'string' },
      'image': { type: 'string' },
      'bind': { type: 'string', multiple: true },
      'dry-run': { type: 'boolean' },
      'skip-enroll': { type: 'boolean' },
      'help': { type: 'boolean' },
    },
  })

  const [command, agentId] = positionals

  if (values.help || !command) {
    console.log(USAGE)
    return
  }

  if (command !== 'add')
    throw new Error(`Unknown command "${command}". Try \`apes openclaw --help\`.`)
  if (!agentId)
    throw new Error('Missing agent id. Usage: apes openclaw add <agentId>')

  add(agentId, {
    home: values.home ?? DEFAULT_IDENTITY_ROOT,
    image: values.image,
    binds: values.bind ?? [],
    dryRun: values['dry-run'] ?? false,
    skipEnroll: values['skip-enroll'] ?? false,
  })
}

try {
  main(process.argv.slice(2))
}
catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
