import { codexNetworkRead, parseCodexNetworkAction } from '../../contracts/codex-networks'

// Reads run on the local worker directly; every other action goes through the
// central workspace's local execution path. This routes requests; it grants nothing.
export function readOnlyAction(action: Record<string, unknown>): boolean {
  if (typeof action.action !== 'string') return false
  if (action.action === 'networks') return codexNetworkRead(parseCodexNetworkAction(action))
  if (['runtime', 'list', 'inspect', 'changes', 'select'].includes(action.action)) return true
  const query = action.query as Record<string, unknown> | undefined
  if (action.action === 'workspace') return !!query && typeof query.type === 'string' && ['inventory', 'read', 'operation'].includes(query.type)
  const command = action.command as Record<string, unknown> | undefined
  return ['resources', 'scripts', 'description', 'recovery', 'program'].includes(action.action) && command?.type === 'list'
}
