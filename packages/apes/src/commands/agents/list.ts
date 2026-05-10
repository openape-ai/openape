import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError } from '../../errors'
import { apiFetch } from '../../http'
import { isDarwin, listMacOSUserNames, readMacOSUser } from '../../lib/macos-user'

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
    // Resolve actual NFSHomeDirectory from dscl per agent — Phase G
    // agents are at /var/openape/homes/<name>, legacy at /Users/<name>.
    const homeOf = (name: string): string | null => {
      if (!osUsers.has(name)) return null
      const u = readMacOSUser(name)
      return u?.homeDir ?? `/Users/${name}`
    }

    const rows = filtered.map(u => ({
      name: u.name,
      email: u.email,
      isActive: u.isActive !== false,
      osUser: osUsers.has(u.name),
      home: homeOf(u.name),
    }))

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
