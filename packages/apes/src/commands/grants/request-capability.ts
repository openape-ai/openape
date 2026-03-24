import { hostname } from 'node:os'
import { buildStructuredCliGrantRequest, loadAdapter, resolveCapabilityRequest } from '@openape/shapes'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { parseDuration } from '../../duration'
import { apiFetch, getGrantsEndpoint } from '../../http'

function parseCapabilityArgs(rawArgs: string[]): {
  cliId: string
  adapter?: string
  idp?: string
  approval: 'once' | 'timed' | 'always'
  reason?: string
  duration?: number
  runAs?: string
  wait: boolean
  resources: string[]
  selectors: string[]
  actions: string[]
} {
  const tokens = [...rawArgs]
  if (tokens[0] === 'request-capability') {
    tokens.shift()
  }

  const cliId = tokens.shift()
  if (!cliId || cliId.startsWith('-')) {
    throw new Error('Missing CLI identifier')
  }

  const resources: string[] = []
  const selectors: string[] = []
  const actions: string[] = []
  let adapter: string | undefined
  let idp: string | undefined
  let approval: 'once' | 'timed' | 'always' = 'once'
  let reason: string | undefined
  let duration: number | undefined
  let runAs: string | undefined
  let wait = false

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const next = tokens[index + 1]
    switch (token) {
      case '--resource':
        if (!next)
          throw new Error('Missing value for --resource')
        resources.push(next)
        index += 1
        break
      case '--selector':
        if (!next)
          throw new Error('Missing value for --selector')
        selectors.push(next)
        index += 1
        break
      case '--action':
        if (!next)
          throw new Error('Missing value for --action')
        actions.push(next)
        index += 1
        break
      case '--adapter':
        if (!next)
          throw new Error('Missing value for --adapter')
        adapter = next
        index += 1
        break
      case '--idp':
        if (!next)
          throw new Error('Missing value for --idp')
        idp = next
        index += 1
        break
      case '--approval':
        if (!next || !['once', 'timed', 'always'].includes(next)) {
          throw new Error('Approval must be one of: once, timed, always')
        }
        approval = next as 'once' | 'timed' | 'always'
        index += 1
        break
      case '--reason':
        if (!next)
          throw new Error('Missing value for --reason')
        reason = next
        index += 1
        break
      case '--duration':
        if (!next)
          throw new Error('Missing value for --duration')
        duration = parseDuration(next)
        index += 1
        break
      case '--run-as':
        if (!next)
          throw new Error('Missing value for --run-as')
        runAs = next
        index += 1
        break
      case '--wait':
        wait = true
        break
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }

  return {
    cliId,
    adapter,
    idp,
    approval,
    reason,
    duration,
    runAs,
    wait,
    resources,
    selectors,
    actions,
  }
}

async function waitForApproval(grantsUrl: string, grantId: string): Promise<void> {
  const maxWait = 300_000
  const interval = 3_000
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    const grant = await apiFetch<{ status: string }>(`${grantsUrl}/${grantId}`)
    if (grant.status === 'approved') {
      consola.success('Grant approved!')
      return
    }
    if (grant.status === 'denied') {
      consola.error('Grant denied.')
      process.exit(1)
    }
    if (grant.status === 'revoked') {
      consola.error('Grant revoked.')
      process.exit(1)
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }

  consola.error('Timed out waiting for approval.')
  process.exit(1)
}

export const requestCapabilityCommand = defineCommand({
  meta: {
    name: 'request-capability',
    description: 'Request a structured CLI capability grant',
  },
  async run({ rawArgs }) {
    const auth = loadAuth()
    if (!auth) {
      consola.error('Not logged in. Run `apes login` first.')
      return process.exit(1)
    }

    const parsed = parseCapabilityArgs(rawArgs)
    const idp = getIdpUrl(parsed.idp)
    if (!idp) {
      consola.error('No IdP URL configured. Use --idp or log in first.')
      return process.exit(1)
    }

    const loaded = loadAdapter(parsed.cliId, parsed.adapter)
    const resolved = resolveCapabilityRequest(loaded, {
      resources: parsed.resources,
      selectors: parsed.selectors,
      actions: parsed.actions,
    })

    const { request } = await buildStructuredCliGrantRequest(resolved, {
      requester: auth.email,
      target_host: hostname(),
      grant_type: parsed.approval,
      ...(parsed.reason ? { reason: parsed.reason } : {}),
    })

    if (parsed.duration != null) {
      request.duration = parsed.duration
    }
    if (parsed.runAs) {
      request.run_as = parsed.runAs
    }

    const grantsUrl = await getGrantsEndpoint(idp)
    const grant = await apiFetch<{ id: string, status: string }>(grantsUrl, {
      method: 'POST',
      idp,
      body: request,
    })

    consola.success(`Grant requested: ${grant.id} (status: ${grant.status})`)

    if (parsed.wait) {
      consola.info('Waiting for approval...')
      await waitForApproval(grantsUrl, grant.id)
    }
  },
})
