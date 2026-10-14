import { basename } from 'node:path'
import type { ServerResolvedCommand, ServerShape } from '@openape/grants'

/**
 * Read-only views of the IdP's Shapes registry through its public endpoints. They preview what the IdP would
 * resolve; the decision for an actual call is made per call by `POST /api/grants/authorize`.
 */

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) return await response.json() as T
  const text = await response.text()
  let message = text
  try {
    const problem = JSON.parse(text) as { title?: string, detail?: string }
    message = problem.detail ?? problem.title ?? text
  }
  catch {
    // A non-JSON error body is reported as it is.
  }
  throw new Error(`IdP answered ${response.status}: ${message || response.statusText}`)
}

function issuerOf(idp: string): string {
  return idp.replace(/\/+$/, '')
}

/** How the IdP would resolve `command` by program name; the executable is reduced to its basename. */
export async function previewCommand(idp: string, command: string[]): Promise<ServerResolvedCommand> {
  const name = basename(command[0]!)
  const response = await fetch(`${issuerOf(idp)}/api/shapes/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cli_id: name, argv: [name, ...command.slice(1)] }),
  })
  return await readJson<ServerResolvedCommand>(response)
}

export async function listShapes(idp: string): Promise<ServerShape[]> {
  return await readJson<ServerShape[]>(await fetch(`${issuerOf(idp)}/api/shapes`))
}

export async function getShape(idp: string, cliId: string): Promise<ServerShape> {
  return await readJson<ServerShape>(await fetch(`${issuerOf(idp)}/api/shapes/${encodeURIComponent(cliId)}`))
}

/** The fields `apes explain` and the MCP explain tool print. */
export function describePreview(resolved: ServerResolvedCommand): Record<string, unknown> {
  return {
    cli_id: resolved.cli_id,
    operation: resolved.operation_id,
    display: resolved.detail.display,
    permission: resolved.permission,
    resource_chain: resolved.detail.resource_chain,
    exact_command: resolved.detail.constraints?.exact_command ?? false,
    shaped: !resolved.synthetic,
    adapter_digest: resolved.executionContext.adapter_digest,
  }
}
