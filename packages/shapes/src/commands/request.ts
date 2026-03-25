import { defineCommand } from 'citty'
import consola from 'consola'
import { loadAdapter } from '../adapters.js'
import { getIdpUrl } from '../config.js'
import { createShapesGrant, fetchGrantToken, findExistingGrant, verifyAndExecute, waitForGrantStatus } from '../grants.js'
import { resolveCommand } from '../parser.js'
import { extractOption, extractWrappedCommand } from './explain.js'

export const requestCommand = defineCommand({
  meta: {
    name: 'request',
    description: 'Request a grant and execute a wrapped command',
  },
  args: {
    idp: {
      type: 'string',
      description: 'IdP URL',
    },
    approval: {
      type: 'string',
      description: 'Grant approval mode: once, timed, always',
      default: 'once',
    },
    reason: {
      type: 'string',
      description: 'Reason for the grant request',
    },
    adapter: {
      type: 'string',
      description: 'Explicit path to adapter TOML file',
    },
    _: {
      type: 'positional',
      description: 'Wrapped command (after --)',
      required: false,
    },
  },
  async run({ rawArgs, args }) {
    const command = extractWrappedCommand(rawArgs ?? [])
    if (command.length === 0)
      throw new Error('Missing wrapped command. Usage: shapes request [--idp <url>] [--approval once|timed|always] -- <cli> ...')

    const adapterOpt = extractOption(rawArgs ?? [], 'adapter')
    const idp = getIdpUrl(args.idp)
    if (!idp)
      throw new Error('No IdP URL configured. Use --idp or log in with apes.')

    const loaded = loadAdapter(command[0]!, adapterOpt)
    const resolved = await resolveCommand(loaded, command)
    const approval = (args.approval ?? 'once') as 'once' | 'timed' | 'always'

    if (approval !== 'once') {
      try {
        const existingGrantId = await findExistingGrant(resolved, idp)
        if (existingGrantId) {
          consola.info(`Reusing existing grant: ${existingGrantId}`)
          const token = await fetchGrantToken(idp, existingGrantId)
          await verifyAndExecute(token, resolved)
          return
        }
      }
      catch {
        // Fall through to creating a new grant
      }
    }

    const grant = await createShapesGrant(resolved, {
      idp,
      approval,
      ...(args.reason ? { reason: args.reason } : {}),
    })

    consola.info(`Grant requested: ${grant.id}`)
    consola.info(`Approve at: ${idp}/grant-approval?grant_id=${grant.id}`)

    const status = await waitForGrantStatus(idp, grant.id)
    if (status !== 'approved')
      throw new Error(`Grant ${status}`)

    const token = await fetchGrantToken(idp, grant.id)
    await verifyAndExecute(token, resolved)
  },
})
