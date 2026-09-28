export type McpMode = 'off' | 'read' | 'write'
export type McpDuration = 'hour' | 'day' | 'permanent'
export interface McpAccess { mode: McpMode, duration: McpDuration, expiresAt: number | null }
export type McpAccessCommand = { type: 'get' } | { type: 'set', mode: McpMode, duration: McpDuration }

export function parseMcpAccessCommand(value: unknown): McpAccessCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP access command')
  const item = value as Record<string, unknown>
  if (item.type === 'get' && Object.keys(item).length === 1) return { type: 'get' }
  if (item.type !== 'set' || Object.keys(item).length !== 3 || typeof item.mode !== 'string' || !['off', 'read', 'write'].includes(item.mode) || typeof item.duration !== 'string' || !['hour', 'day', 'permanent'].includes(item.duration)) throw new Error('Invalid MCP access command')
  return { type: 'set', mode: item.mode as McpMode, duration: item.duration as McpDuration }
}
export function parseMcpAccess(value: unknown): McpAccess {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP access state')
  const item = value as Record<string, unknown>
  if (Object.keys(item).length !== 3) throw new Error('Invalid MCP access state')
  const command = parseMcpAccessCommand({ type: 'set', mode: item.mode, duration: item.duration })
  if (command.type !== 'set') throw new Error('Invalid MCP access state')
  if (item.expiresAt !== null && (!Number.isSafeInteger(item.expiresAt) || Number(item.expiresAt) < 0)) throw new Error('Invalid MCP expiry')
  if ((command.mode === 'off' || command.duration === 'permanent') !== (item.expiresAt === null)) throw new Error('Invalid MCP expiry')
  return { mode: command.mode, duration: command.duration, expiresAt: item.expiresAt as number | null }
}
