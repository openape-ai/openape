export type ConnectionProvider = 'chatgpt' | 'openape' | 'microsoft'
export interface ConnectionView { id: string, provider: ConnectionProvider, account: string, state: 'connecting' | 'ready' | 'failed' | 'expired' | 'revoked', error: string | null, login: { url: string, code?: string } | null }
export interface MailSetup { podId: string, revision: number, ownerConnection: string, mailConnection: string, account: string, folders: { id: string, name: string }[], since: string | null, attachments: boolean }
export interface OnboardingView { connections: ConnectionView[], runtime: { ready: boolean, error: string | null }, complete: boolean, folders?: { connectionId: string, items: { id: string, name: string }[] } }
export type OnboardingCommand = { type: 'list' } | { type: 'connect', provider: ConnectionProvider, account: string, issuer?: string } | { type: 'cancel' | 'disconnect' | 'openLogin', id: string } | { type: 'folders', id: string } | { type: 'assign', setup: MailSetup } | { type: 'finish' }
export function parseSince(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT00:00:00Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().replace('.000Z', 'Z') !== value) throw new Error('Choose a valid UTC start date or all history')
  return value
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
export function parseOnboardingCommand(value: unknown): OnboardingCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid setup request')
  const item = value as Record<string, unknown>
  const fields: Record<string, string[]> = { list: [], connect: ['provider', 'account', 'issuer'], openLogin: ['id'], cancel: ['id'], disconnect: ['id'], folders: ['id'], assign: ['setup'], finish: [] }
  if (typeof item.type !== 'string' || !Object.hasOwn(fields, item.type) || Object.keys(item).some(key => key !== 'type' && !fields[item.type as string].includes(key))) throw new Error('Unsupported setup request')
  if (item.type === 'assign' || item.type === 'folders' || (item.type === 'connect' && item.provider === 'microsoft')) throw new Error('Configure application accounts in the pod Permissions tab')
  if (fields[item.type].includes('id') && !uuid(item.id)) throw new Error('Invalid connection identity')
  if (item.type === 'connect') {
    if (!['chatgpt', 'openape', 'microsoft'].includes(String(item.provider)) || typeof item.account !== 'string' || (item.provider !== 'chatgpt' && !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(item.account)) || item.account.length > 254) throw new Error('Enter the expected account email')
    if (item.provider === 'openape') {
      if (typeof item.issuer !== 'string') throw new Error('OpenApe identity provider is required')
      const url = new URL(item.issuer)
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Identity provider must be an HTTPS origin')
    }
    else if (item.issuer !== undefined) {
      throw new Error('This provider has a fixed sign-in service')
    }
  }
  if (item.type === 'assign') {
    const setup = item.setup as Record<string, unknown>
    if (!setup || typeof setup !== 'object' || Array.isArray(setup) || Object.keys(setup).some(key => !['podId', 'revision', 'ownerConnection', 'mailConnection', 'account', 'folders', 'since', 'attachments'].includes(key)) || ![setup.podId, setup.ownerConnection, setup.mailConnection].every(uuid) || !Number.isSafeInteger(setup.revision) || (setup.revision as number) < 1 || typeof setup.account !== 'string' || setup.account.length > 254 || !Array.isArray(setup.folders) || !setup.folders.length || setup.folders.length > 100 || typeof setup.attachments !== 'boolean') throw new Error('Invalid mail assignment')
    for (const folder of setup.folders) {
      if (!folder || typeof folder !== 'object' || Object.keys(folder).some(key => !['id', 'name'].includes(key)) || typeof folder.id !== 'string' || !folder.id || folder.id.length > 2048 || /[\0\r\n/\\]/.test(folder.id) || ['.', '..'].includes(folder.id) || typeof folder.name !== 'string' || folder.name.length > 255) throw new Error('Invalid selected folder')
    }
    if (new Set(setup.folders.map(folder => folder.id)).size !== setup.folders.length) throw new Error('Duplicate selected folder')
    parseSince(setup.since)
  }
  return structuredClone(item) as OnboardingCommand
}
export function parseOnboardingView(value: unknown): OnboardingView {
  if (!value || typeof value !== 'object') throw new Error('Invalid setup state')
  const view = value as OnboardingView
  if (!Array.isArray(view.connections) || view.connections.length > 100 || typeof view.complete !== 'boolean' || !view.runtime || typeof view.runtime.ready !== 'boolean' || (view.runtime.error !== null && typeof view.runtime.error !== 'string')) throw new Error('Invalid setup state fields')
  for (const connection of view.connections) {
    if (!uuid(connection.id) || !['chatgpt', 'openape', 'microsoft'].includes(connection.provider) || typeof connection.account !== 'string' || !['connecting', 'ready', 'failed', 'expired', 'revoked'].includes(connection.state) || (connection.error !== null && typeof connection.error !== 'string')) throw new Error('Invalid connection state')
    if (connection.login && (typeof connection.login.url !== 'string' || (connection.login.code !== undefined && typeof connection.login.code !== 'string'))) throw new Error('Invalid sign-in details')
  }
  return view
}
