// `apes grants llm` — owner-issued LLM-account access for agents on the
// llms.openape.ai gateway. An "allow" is a DDISA standing grant
// (delegate=agent, audience=llms.openape.ai, resource=llm-account[account]).
// The gateway's token-exchange reflects these into the agent's gateway token,
// so the agent authenticates as itself and the owner controls (and revokes)
// access without touching the agent.
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../../errors'
import { apiFetch } from '../../http'

const AUDIENCE = 'llms.openape.ai'
const RESOURCE = 'llm-account'

interface ResourceRef { resource: string, selector?: Record<string, string> }
interface StandingGrant {
  id: string
  status: string
  request: { delegate: string, audience: string, resource_chain_template?: ResourceRef[] }
}

function templateFor(account: string): ResourceRef[] {
  // '*' = any account (wildcard selector omitted, matching the coverage logic).
  return account === '*' ? [{ resource: RESOURCE }] : [{ resource: RESOURCE, selector: { account } }]
}

function accountOf(g: StandingGrant): string {
  return (g.request.resource_chain_template ?? [])
    .filter(r => r.resource === RESOURCE)
    .map(r => r.selector?.account ?? '*')
    .join(',') || '?'
}

const allow = defineCommand({
  meta: { name: 'allow', description: 'Allow an agent to use an LLM account on llms.openape.ai' },
  args: {
    agent: { type: 'positional', required: true, description: 'Agent DDISA email (the grant delegate)' },
    account: { type: 'positional', required: true, description: 'LLM account name, or * for all' },
  },
  async run({ args }) {
    const agent = String(args.agent)
    if (!agent.includes('@')) {
      throw new CliError('Pass the full agent DDISA email (e.g. from `ape-troop agents list`), not a short name.')
    }
    const account = String(args.account)
    const grant = await apiFetch<StandingGrant>('/api/standing-grants', {
      method: 'POST',
      body: {
        delegate: agent,
        audience: AUDIENCE,
        resource_chain_template: templateFor(account),
        grant_type: 'always',
        reason: `LLM gateway access: ${account}`,
      },
    })
    consola.success(`Granted ${agent} → llm-account[${account}] (standing grant ${grant.id})`)
  },
})

const list = defineCommand({
  meta: { name: 'list', description: 'List LLM-account standing grants (optionally for one agent)' },
  args: { agent: { type: 'positional', required: false, description: 'Filter by agent email' } },
  async run({ args }) {
    const all = await apiFetch<StandingGrant[]>('/api/standing-grants')
    const filter = args.agent ? String(args.agent) : undefined
    const llm = all.filter(g => g.request.audience === AUDIENCE && (!filter || g.request.delegate === filter))
    if (!llm.length) {
      consola.info('No LLM-account standing grants.')
      return
    }
    for (const g of llm) consola.log(`${g.id}  ${g.request.delegate} → ${accountOf(g)}  [${g.status}]`)
  },
})

const revoke = defineCommand({
  meta: { name: 'revoke', description: 'Revoke an LLM-account standing grant by id' },
  args: { id: { type: 'positional', required: true, description: 'Standing grant id' } },
  async run({ args }) {
    await apiFetch(`/api/standing-grants/${String(args.id)}`, { method: 'DELETE' })
    consola.success(`Revoked standing grant ${args.id}`)
  },
})

export const llmCommand = defineCommand({
  meta: { name: 'llm', description: 'Grant agents access to LLM accounts on llms.openape.ai' },
  subCommands: { allow, list, revoke },
})
