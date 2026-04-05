import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl } from '../../config'
import { apiFetch } from '../../http'
import { CliError } from '../../errors'

interface AdminUser {
  email: string
  name: string
  isActive: boolean
  owner?: string
  createdAt: number
}

function getManagementToken(): string {
  const token = process.env.APES_MANAGEMENT_TOKEN
  if (!token) {
    throw new CliError('Management token required. Set APES_MANAGEMENT_TOKEN environment variable.')
  }
  return token
}

interface UserListResponse {
  data: AdminUser[]
  pagination: {
    cursor: string | null
    has_more: boolean
  }
}

export const usersListCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List all users',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Output as JSON',
      default: false,
    },
    limit: {
      type: 'string',
      description: 'Max number of users to return (1-100, default 50)',
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor (email of last item from previous page)',
    },
    search: {
      type: 'string',
      description: 'Filter by email or name (case-insensitive)',
    },
  },
  async run({ args }) {
    const idp = getIdpUrl()
    if (!idp) {
      throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')
    }

    const token = getManagementToken()
    const params = new URLSearchParams()
    if (args.limit) params.set('limit', args.limit)
    if (args.cursor) params.set('cursor', args.cursor)
    if (args.search) params.set('search', args.search)
    const qs = params.toString()
    const url = qs ? `${idp}/api/admin/users?${qs}` : `${idp}/api/admin/users`

    const result = await apiFetch<UserListResponse>(url, { token })

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    if (result.data.length === 0) {
      consola.info('No users found.')
      return
    }

    for (const u of result.data) {
      const owner = u.owner ? ` (agent of ${u.owner})` : ''
      const active = u.isActive ? '' : ' [inactive]'
      console.log(`${u.email}  ${u.name}${owner}${active}`)
    }

    if (result.pagination.has_more) {
      consola.info(`More results available. Use --cursor="${result.pagination.cursor}" to see next page.`)
    }
  },
})

export const usersCreateCommand = defineCommand({
  meta: {
    name: 'create',
    description: 'Create a user',
  },
  args: {
    email: {
      type: 'string',
      description: 'User email',
      required: true,
    },
    name: {
      type: 'string',
      description: 'User name',
      required: true,
    },
  },
  async run({ args }) {
    const idp = getIdpUrl()
    if (!idp) {
      throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')
    }

    const token = getManagementToken()

    const result = await apiFetch<{ ok: boolean, email: string, name: string }>(
      `${idp}/api/admin/users`,
      {
        method: 'POST',
        body: { email: args.email, name: args.name },
        token,
      },
    )

    consola.success(`User created: ${result.email} (${result.name})`)
  },
})

export const usersDeleteCommand = defineCommand({
  meta: {
    name: 'delete',
    description: 'Delete a user',
  },
  args: {
    email: {
      type: 'positional',
      description: 'User email',
      required: true,
    },
  },
  async run({ args }) {
    const idp = getIdpUrl()
    if (!idp) {
      throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')
    }

    const token = getManagementToken()
    const email = String(args.email)

    await apiFetch(`${idp}/api/admin/users/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      token,
    })

    consola.success(`User deleted: ${email}`)
  },
})
