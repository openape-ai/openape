import { existsSync, readFileSync } from 'node:fs'
import { defineCommand } from 'citty'
import consola from 'consola'
import { apiFetch } from '../http'
import { loadAuth, getIdpUrl } from '../config'
import { CliError } from '../errors'

export const registerUserCommand = defineCommand({
  meta: {
    name: 'register-user',
    description: 'Register a sub-user with SSH key',
  },
  args: {
    email: {
      type: 'string',
      description: 'Email for the new user',
      required: true,
    },
    name: {
      type: 'string',
      description: 'Name for the new user',
      required: true,
    },
    key: {
      type: 'string',
      description: 'Path to SSH public key file or key string',
      required: true,
    },
    type: {
      type: 'string',
      description: 'User type: human or agent (default: agent)',
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

    // Read key from file or use as string
    let publicKey = args.key
    if (existsSync(args.key)) {
      publicKey = readFileSync(args.key, 'utf-8').trim()
    }

    if (!publicKey.startsWith('ssh-ed25519 ')) {
      throw new CliError('Public key must be in ssh-ed25519 format.')
    }

    const userType = args.type as 'human' | 'agent' | undefined
    if (userType && userType !== 'human' && userType !== 'agent') {
      throw new CliError('Type must be "human" or "agent".')
    }

    const result = await apiFetch<{
      email: string
      name: string
      owner: string
      type: string
    }>(`${idp}/api/auth/enroll`, {
      method: 'POST',
      body: {
        email: args.email,
        name: args.name,
        publicKey,
        ...(userType ? { type: userType } : {}),
      },
    })

    consola.success(`User registered: ${result.email} (type: ${result.type}, owner: ${result.owner})`)
  },
})
