import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError } from '../../errors'
import { apiFetch } from '../../http'
import { isDarwin, listMacOSUserNames, lookupMacOSUserForAgent, macOSUsernameForAgent } from '../../lib/macos-user'

interface IdpUser {
  email: string
  name: string
  owner: string | null
  approver: string | null
  type: string | null
  isActive: boolean
  createdAt: number
}

export const listAgentsCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List agents owned by the current user, with local OS-user status',
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

    const osUsers = isDarwin() ? listMacOSUserNames() : new Set<string>()
    // Resolve macOS state per agent, checking both the prefixed
    // (`openape-agent-<name>`) and bare (`<name>`) dscl records so
    // legacy pre-prefix agents keep showing up in the table.
    const osStateOf = (agentName: string): { osUser: boolean, home: string | null } => {
      const u = lookupMacOSUserForAgent(agentName)
      if (u) return { osUser: true, home: u.homeDir }
      // listMacOSUserNames covers ad-hoc records that dscl-read can't see
      // (e.g. names with unusual characters) — keep it as a sentinel.
      if (osUsers.has(macOSUsernameForAgent(agentName)) || osUsers.has(agentName)) {
        return { osUser: true, home: null }
      }
      return { osUser: false, home: null }
    }

    const rows = filtered.map((u) => {
      const os = osStateOf(u.name)
      return {
        name: u.name,
        email: u.email,
        isActive: u.isActive !== false,
        osUser: os.osUser,
        home: os.home,
      }
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
    const header = `${'NAME'.padEnd(nameW)}  ${'EMAIL'.padEnd(emailW)}  ACTIVE  OS-USER  HOME`
    console.log(header)
    console.log('-'.repeat(header.length))
    for (const r of rows) {
      const active = r.isActive ? '✓' : '✗'
      const os = r.osUser ? '✓' : '✗'
      const homeCol = r.home ?? (isDarwin() ? '(missing)' : '(non-darwin)')
      console.log(`${r.name.padEnd(nameW)}  ${r.email.padEnd(emailW)}  ${active.padEnd(6)}  ${os.padEnd(7)}  ${homeCol}`)
    }
  },
})
