// The owner's MCP session as App settings shows it: the latest end of an active
// session and whether a browser sign-in is waiting. Secrets never leave main.
export interface McpSessionView { expiresAt: number | null, pending: boolean }
export type McpSessionCommand = { type: 'get' } | { type: 'end' }

export const mcpSessionLifetime = 3600000
export const loginRequired = 'login_required'

export function parseMcpSessionCommand(value: unknown): McpSessionCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP session command')
  const item = value as Record<string, unknown>
  if (Object.keys(item).length !== 1 || (item.type !== 'get' && item.type !== 'end')) throw new Error('Invalid MCP session command')
  return { type: item.type }
}

export function parseMcpSessionView(value: unknown): McpSessionView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP session state')
  const item = value as Record<string, unknown>
  if (Object.keys(item).length !== 2 || typeof item.pending !== 'boolean' || (item.expiresAt !== null && (!Number.isSafeInteger(item.expiresAt) || Number(item.expiresAt) < 0))) throw new Error('Invalid MCP session state')
  return { expiresAt: item.expiresAt as number | null, pending: item.pending }
}
