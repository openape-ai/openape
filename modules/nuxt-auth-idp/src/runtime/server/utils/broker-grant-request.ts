import type { OpenApeGrantRequest, OpenApeAuthorizationDetail } from '@openape/core'
import { computeCmdHash } from '@openape/core'
import { brokerObject, brokerString, canonicalizeCliPermission, computeArgvHash, validateCliAuthorizationDetail } from '@openape/grants'

export async function parseBrokerGrantRequest(input: unknown, requester: string): Promise<OpenApeGrantRequest> {
  const value = brokerObject(input)
  const allowed = ['requester', 'target_host', 'audience', 'grant_type', 'duration', 'command', 'permissions', 'authorization_details', 'execution_context', 'reason', 'summary', 'waits_until', 'cmd_hash']
  if (Object.keys(value).some(key => !allowed.includes(key)) || (value.requester !== undefined && value.requester !== requester)) throw new Error('Invalid brokered grant fields')
  brokerString(value.target_host)
  brokerString(value.audience)
  if (!['once', 'timed', 'always'].includes(String(value.grant_type))) throw new Error('Invalid grant lifetime')
  if (value.grant_type === 'timed' && (!Number.isInteger(value.duration) || Number(value.duration) <= 0)) throw new Error('Timed grant duration must be positive')
  if (value.command !== undefined && (!Array.isArray(value.command) || value.command.length === 0 || value.command.length > 100 || value.command.some(arg => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0')))) throw new Error('Invalid grant command')
  if (value.permissions !== undefined && (!Array.isArray(value.permissions) || value.permissions.length > 100 || value.permissions.some(item => typeof item !== 'string' || item.length > 4096))) throw new Error('Invalid grant permissions')
  if (value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.length > 4096)) throw new Error('Invalid grant reason')
  if (value.summary !== undefined) {
    const summary = brokerObject(value.summary)
    if (Object.keys(summary).some(key => key !== 'text') || typeof summary.text !== 'string' || summary.text.length > 4096) throw new Error('Invalid request summary')
  }
  if (value.waits_until !== undefined && (!Number.isInteger(value.waits_until) || Number(value.waits_until) <= Date.now() / 1000)) throw new Error('Invalid request deadline')
  if (value.authorization_details !== undefined) {
    if (!Array.isArray(value.authorization_details) || value.authorization_details.length === 0 || value.authorization_details.length > 100) throw new Error('Invalid authorization details')
    value.authorization_details = value.authorization_details.map((input) => {
      const detail = brokerObject(input)
      if (detail.type !== 'openape_cli') throw new Error('Brokered commands require structured CLI details')
      const checked = validateCliAuthorizationDetail(detail)
      if (!checked.valid) throw new Error(`Invalid CLI authorization: ${checked.errors.join('; ')}`)
      const cli = detail as unknown as Extract<OpenApeAuthorizationDetail, { type: 'openape_cli' }>
      return { ...cli, permission: canonicalizeCliPermission(cli) }
    })
    value.permissions = (value.authorization_details as Array<{ permission: string }>).map(detail => detail.permission)
  }
  if (value.execution_context !== undefined) {
    const execution = brokerObject(value.execution_context)
    const allowedExecution = ['argv', 'argv_hash', 'adapter_id', 'adapter_version', 'adapter_digest', 'resolved_executable', 'context_bindings']
    if (Object.keys(execution).some(key => !allowedExecution.includes(key))) throw new Error('Invalid execution context fields')
    for (const key of ['adapter_id', 'adapter_version', 'adapter_digest', 'resolved_executable']) brokerString(execution[key])
    if (!Array.isArray(execution.argv) || execution.argv.length > 100 || !execution.argv.length || execution.argv.some(arg => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))) throw new Error('Invalid execution arguments')
    execution.argv_hash = await computeArgvHash(execution.argv as string[])
    if (value.command && JSON.stringify(value.command) !== JSON.stringify(execution.argv)) throw new Error('Command and execution arguments differ')
    value.command = execution.argv
  }
  if (!value.command && !value.authorization_details && (!Array.isArray(value.permissions) || !value.permissions.length)) throw new Error('A brokered grant must name an action')
  if (value.command) value.cmd_hash = await computeCmdHash((value.command as string[]).join(' '))
  else if (value.cmd_hash !== undefined) throw new Error('Command hash requires a command')
  return { ...value, requester } as unknown as OpenApeGrantRequest
}
