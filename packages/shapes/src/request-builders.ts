import { computeCmdHash } from '@openape/core'
import type { BuiltGrantRequest, GrantRequestOptions, ResolvedCapability, ResolvedCommand } from './types.js'

export async function buildExactCommandGrantRequest(
  command: string[],
  options: GrantRequestOptions & {
    audience: string
  },
): Promise<BuiltGrantRequest> {
  return {
    request: {
      requester: options.requester,
      target_host: options.target_host,
      audience: options.audience,
      grant_type: options.grant_type,
      command,
      cmd_hash: await computeCmdHash(command.join(' ')),
      ...(options.reason ? { reason: options.reason } : {}),
      ...(options.run_as ? { run_as: options.run_as } : {}),
    },
  }
}

export async function buildStructuredCliGrantRequest(
  resolved: ResolvedCommand | ResolvedCapability,
  options: GrantRequestOptions,
): Promise<BuiltGrantRequest> {
  const details = 'detail' in resolved ? [resolved.detail] : resolved.details
  const permissions = 'permission' in resolved ? [resolved.permission] : resolved.permissions
  const command = 'executionContext' in resolved && resolved.executionContext.argv?.length
    ? resolved.executionContext.argv
    : undefined

  return {
    request: {
      requester: options.requester,
      target_host: options.target_host,
      audience: resolved.adapter.cli.audience ?? 'shapes',
      grant_type: options.grant_type,
      permissions,
      authorization_details: details,
      execution_context: resolved.executionContext,
      ...(command ? { command } : {}),
      ...(options.reason ? { reason: options.reason } : { reason: 'summary' in resolved ? resolved.summary : details[0]?.display }),
      ...(options.run_as ? { run_as: options.run_as } : {}),
    },
  }
}
