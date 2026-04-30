import { existsSync, readFileSync } from 'node:fs'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError } from '../../errors'
import { AGENT_NAME_REGEX, registerAgentAtIdp, SSH_ED25519_PREFIX, SSH_ED25519_REGEX } from '../../lib/agent-bootstrap'

export const registerAgentCommand = defineCommand({
  meta: {
    name: 'register',
    description: 'Register an agent at the IdP using a supplied public key',
  },
  args: {
    name: {
      type: 'string',
      description: 'Agent name (lowercase, [a-z0-9-], 1–24 chars, must start with a letter)',
      required: true,
    },
    'public-key': {
      type: 'string',
      description: 'Full ssh-ed25519 public key line (e.g. "ssh-ed25519 AAAAC3...")',
    },
    'public-key-file': {
      type: 'string',
      description: 'Path to a .pub file containing the ssh-ed25519 line',
    },
    json: {
      type: 'boolean',
      description: 'Emit machine-readable JSON instead of a human summary',
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

    const name = args.name
    if (!AGENT_NAME_REGEX.test(name)) {
      throw new CliError(
        `Invalid agent name "${name}". Must match /^[a-z][a-z0-9-]{0,23}$/ — `
        + `lowercase letters, digits and hyphens, 1–24 chars, must start with a letter.`,
      )
    }

    let publicKey: string | undefined = args['public-key']
    const keyFile = args['public-key-file']

    if (publicKey && keyFile) {
      throw new CliError('Pass either --public-key or --public-key-file, not both.')
    }

    if (!publicKey && keyFile) {
      if (!existsSync(keyFile)) {
        throw new CliError(`Public-key file not found: ${keyFile}`)
      }
      publicKey = readFileSync(keyFile, 'utf-8').trim()
    }

    if (!publicKey) {
      throw new CliError('Provide --public-key "<ssh-ed25519 line>" or --public-key-file <path>.')
    }

    if (!publicKey.startsWith(SSH_ED25519_PREFIX) || !SSH_ED25519_REGEX.test(publicKey)) {
      throw new CliError(
        'Public key must be a full ssh-ed25519 line, e.g. '
        + '"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... [optional comment]".',
      )
    }

    const result = await registerAgentAtIdp({ name, publicKey, idp })

    if (args.json) {
      process.stdout.write(`${JSON.stringify({
        email: result.email,
        name: result.name,
        owner: result.owner,
        approver: result.approver,
        idp,
      })}\n`)
      return
    }

    consola.success('Agent registered.')
    console.log(`  Name:     ${result.name}`)
    console.log(`  Email:    ${result.email}`)
    console.log(`  IdP:      ${idp}`)
    console.log(`  Owner:    ${result.owner}`)
    console.log(`  Approver: ${result.approver}`)
    console.log('')
    console.log('Tell the agent to log in with:')
    console.log(`  apes login --idp ${idp} --email ${result.email} --key <path-to-matching-private-key>`)
  },
})
