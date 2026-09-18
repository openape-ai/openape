import { parseCredentialAlias } from './credentials'
import { parseHttpPermission } from './http'
import { parseNetworkHosts, parseProgramArgv } from './programs'
import type { DirectoryAccess } from './resources'

export interface SetupRequest {
  provider: 'application' | 'http' | 'directory' | 'microsoft' | 'reference' | 'credential' | 'variable'
  description: string
  instructions?: string
  alias?: string
  application?: string
  command?: string
  argv?: string[]
  networkHosts?: string[]
  origin?: string
  methods?: string[]
  path?: string
  access?: DirectoryAccess
  account?: string
  folders?: string[]
  attachments?: boolean
}
export function parseSetupRequest(value: unknown): SetupRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid resource proposal')
  const item = value as Record<string, unknown>
  const fields = ['provider', 'description', 'instructions', 'alias', 'application', 'command', 'argv', 'networkHosts', 'origin', 'methods', 'path', 'access', 'account', 'folders', 'attachments']
  if (Object.keys(item).some(key => !fields.includes(key)) || !['application', 'http', 'directory', 'microsoft', 'reference', 'credential', 'variable'].includes(String(item.provider))) throw new Error('Invalid resource proposal')
  if (typeof item.description !== 'string' || !item.description.trim() || item.description.length > 4000) throw new Error('Invalid resource proposal')
  for (const field of ['instructions', 'application', 'command', 'origin', 'path', 'account']) {
    if (item[field] !== undefined && (typeof item[field] !== 'string' || (item[field] as string).length > 4000)) throw new Error('Invalid resource proposal')
  }
  if (item.provider === 'credential' || item.provider === 'variable') parseCredentialAlias(item.alias)
  else if (item.alias !== undefined) throw new Error('Only credential and variable proposals accept an alias')
  if (item.argv !== undefined) { if (item.provider !== 'application') throw new Error('Only application proposals accept arguments'); parseProgramArgv(item.argv) }
  if (item.networkHosts !== undefined) { if (item.provider !== 'application') throw new Error('Only application proposals accept network hosts'); item.networkHosts = parseNetworkHosts(item.networkHosts) }
  if (item.methods !== undefined) { if (item.provider !== 'http') throw new Error('Only HTTP proposals accept methods'); item.origin = parseHttpPermission({ origin: item.origin, methods: item.methods }).origin }
  if (item.path !== undefined && (typeof item.path !== 'string' || !item.path.startsWith('/') || /[\0\r\n\\"]/.test(item.path))) throw new Error('Invalid directory path')
  if (item.access !== undefined && (item.provider !== 'directory' || !['read', 'readWrite'].includes(String(item.access)))) throw new Error('Invalid directory access')
  if (item.provider === 'directory' && (!item.path || !item.access)) throw new Error('Directory proposals require a path and access')
  if (item.folders !== undefined && (!Array.isArray(item.folders) || item.folders.length > 100 || item.folders.some(folder => typeof folder !== 'string' || !folder || folder.length > 2048))) throw new Error('Invalid resource proposal')
  if (item.attachments !== undefined && typeof item.attachments !== 'boolean') throw new Error('Invalid resource proposal')
  return structuredClone(item) as unknown as SetupRequest
}
