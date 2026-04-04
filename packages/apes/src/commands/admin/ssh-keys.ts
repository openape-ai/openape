import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl } from '../../config'
import { apiFetch } from '../../http'
import { CliError } from '../../errors'

interface SshKey {
  keyId: string
  userEmail: string
  publicKey: string
  name: string
  createdAt: number
}

function getManagementToken(): string {
  const token = process.env.APES_MANAGEMENT_TOKEN
  if (!token) {
    throw new CliError('Management token required. Set APES_MANAGEMENT_TOKEN environment variable.')
  }
  return token
}

export const sshKeysListCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List SSH keys for a user',
  },
  args: {
    email: {
      type: 'positional',
      description: 'User email',
      required: true,
    },
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
    const email = String(args.email)
    const keys = await apiFetch<SshKey[]>(
      `${idp}/api/admin/users/${encodeURIComponent(email)}/ssh-keys`,
      { token },
    )

    if (args.json) {
      console.log(JSON.stringify(keys, null, 2))
      return
    }

    if (keys.length === 0) {
      consola.info(`No SSH keys found for ${email}.`)
      return
    }

    for (const k of keys) {
      console.log(`${k.keyId}  ${k.name}  ${k.publicKey.substring(0, 40)}...`)
    }
  },
})

export const sshKeysAddCommand = defineCommand({
  meta: {
    name: 'add',
    description: 'Add an SSH key for a user',
  },
  args: {
    email: {
      type: 'string',
      description: 'User email',
      required: true,
    },
    key: {
      type: 'string',
      description: 'Path to public key file or key string',
      required: true,
    },
    name: {
      type: 'string',
      description: 'Key name/label',
    },
  },
  async run({ args }) {
    const idp = getIdpUrl()
    if (!idp) {
      throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')
    }

    const token = getManagementToken()

    // Read key from file if path exists, otherwise treat as key string
    let publicKey = args.key
    const resolved = resolve(args.key.replace(/^~/, homedir()))
    if (existsSync(resolved)) {
      publicKey = readFileSync(resolved, 'utf-8').trim()
    }

    const body: Record<string, string> = { publicKey }
    if (args.name) {
      body.name = args.name
    }

    const result = await apiFetch<SshKey>(
      `${idp}/api/admin/users/${encodeURIComponent(args.email)}/ssh-keys`,
      {
        method: 'POST',
        body,
        token,
      },
    )

    consola.success(`SSH key added: ${result.keyId} (${result.name})`)
  },
})

export const sshKeysDeleteCommand = defineCommand({
  meta: {
    name: 'delete',
    description: 'Delete an SSH key',
  },
  args: {
    email: {
      type: 'string',
      description: 'User email',
      required: true,
    },
    keyId: {
      type: 'positional',
      description: 'Key ID',
      required: true,
    },
  },
  async run({ args }) {
    const idp = getIdpUrl()
    if (!idp) {
      throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')
    }

    const token = getManagementToken()
    const keyId = String(args.keyId)

    await apiFetch(
      `${idp}/api/admin/users/${encodeURIComponent(args.email)}/ssh-keys/${keyId}`,
      {
        method: 'DELETE',
        token,
      },
    )

    consola.success(`SSH key deleted: ${keyId}`)
  },
})
