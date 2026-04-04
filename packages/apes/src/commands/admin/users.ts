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
  },
  async run({ args }) {
    const idp = getIdpUrl()
    if (!idp) {
      throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')
    }

    const token = getManagementToken()
    const users = await apiFetch<AdminUser[]>(`${idp}/api/admin/users`, { token })

    if (args.json) {
      console.log(JSON.stringify(users, null, 2))
      return
    }

    if (users.length === 0) {
      consola.info('No users found.')
      return
    }

    for (const u of users) {
      const owner = u.owner ? ` (agent of ${u.owner})` : ''
      const active = u.isActive ? '' : ' [inactive]'
      console.log(`${u.email}  ${u.name}${owner}${active}`)
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
