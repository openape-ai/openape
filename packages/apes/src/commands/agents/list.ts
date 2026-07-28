import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError } from '../../errors'
import { apiFetch } from '../../http'
import { getHostPlatform, isLinux } from '../../lib/host-platform'

interface IdpUser {
  email: string
  name: string
  owner: string | null
  approver: string | null
  type: string | null
  isActive: boolean
  createdAt: number
}

interface AgentRow {
  name: string
  email: string
  isActive: boolean
  /** Local OS-user state — only present on a Linux nest host. */
  osUser?: boolean
  home?: string | null
}

/**
 * Build a resolver for an agent's local OS-user state. Only meaningful on a
 * Linux nest host, where managed agent users actually exist — checks both the
 * prefixed (`openape-agent-<name>`) and bare (`<name>`) records so legacy
 * pre-prefix agents keep showing up.
 */
function buildOsStateResolver(): (agentName: string) => { osUser: boolean, home: string | null } {
  const platform = getHostPlatform()
  const osUsers = platform.listAgentUserNames()
  return (agentName) => {
    const u = platform.lookupAgentUser(agentName)
    if (u) return { osUser: true, home: u.homeDir }
    if (osUsers.has(platform.agentUsername(agentName)) || osUsers.has(agentName)) {
      return { osUser: true, home: null }
    }
    return { osUser: false, home: null }
  }
}

export const listAgentsCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List agents owned by the current user (from the IdP); annotated with local OS-user status on a nest host',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Output as JSON',
    },
    'include-inactive': {
      type: 'boolean',
      description: 'Include agents whose IdP record is deactivated (default hides them)',
    },
  },
  async run({ args }) {
    const auth = loadAuth()
    if (!auth) {
      throw new CliError('Not authenticated. Run `apes login` first.')
    }
    const idp = getIdpUrl()
    if (!idp) {
      throw new CliError('No IdP URL configured. Run `apes login` first.')
    }

    const all = await apiFetch<IdpUser[]>('/api/my-agents', { idp })
    const filtered = args['include-inactive']
      ? all
      : all.filter(u => u.isActive !== false)

    // The agent list itself comes from the IdP and works anywhere the user is
    // logged in. The local OS-user cross-reference (OS-USER/HOME) is a
    // Linux-nest concern — off-nest there are no managed agent users, so skip
    // the host-platform lookups and those columns instead of failing.
    const onNest = isLinux()
    const osStateOf = onNest ? buildOsStateResolver() : null

    const rows: AgentRow[] = filtered.map((u) => {
      const base: AgentRow = { name: u.name, email: u.email, isActive: u.isActive !== false }
      if (!osStateOf) return base
      const os = osStateOf(u.name)
      return { ...base, osUser: os.osUser, home: os.home }
    })

    if (args.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
      return
    }

    if (rows.length === 0) {
      consola.info(args['include-inactive'] ? 'No agents found.' : 'No active agents found. Use --include-inactive to show deactivated.')
      return
    }

    const nameW = Math.max(4, ...rows.map(r => r.name.length))
    const emailW = Math.max(5, ...rows.map(r => r.email.length))

    if (onNest) {
      const header = `${'NAME'.padEnd(nameW)}  ${'EMAIL'.padEnd(emailW)}  ACTIVE  OS-USER  HOME`
      console.log(header)
      console.log('-'.repeat(header.length))
      for (const r of rows) {
        const active = r.isActive ? '✓' : '✗'
        const os = r.osUser ? '✓' : '✗'
        const homeCol = r.home ?? '(missing)'
        console.log(`${r.name.padEnd(nameW)}  ${r.email.padEnd(emailW)}  ${active.padEnd(6)}  ${os.padEnd(7)}  ${homeCol}`)
      }
      return
    }

    const header = `${'NAME'.padEnd(nameW)}  ${'EMAIL'.padEnd(emailW)}  ACTIVE`
    console.log(header)
    console.log('-'.repeat(header.length))
    for (const r of rows) {
      console.log(`${r.name.padEnd(nameW)}  ${r.email.padEnd(emailW)}  ${r.isActive ? '✓' : '✗'}`)
    }
  },
})
