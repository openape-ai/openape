import type { ReportIdentity } from './html-store'
import { randomBytes } from 'node:crypto'
import { ReportError } from '../../shared/html-publication'

interface Capability { viewerOrigin: string, identity: ReportIdentity | null, documentId: string, version: number, accessRevision: number, retentionRevision: number, expires: number }
const capabilities = new Map<string, Capability>()
export function issueHtmlCapability(value: Omit<Capability, 'expires'>) {
  const now = Date.now()
  for (const [key, item] of capabilities) {
    if (item.expires <= now) capabilities.delete(key)
  }
  if (capabilities.size >= 10000) throw new ReportError('UNAVAILABLE', 'Viewer is busy; retry shortly', 503)
  const key = randomBytes(32).toString('base64url')
  capabilities.set(key, { ...value, expires: now + 60000 })
  return key
}
export function htmlCapability(key: string) {
  const value = capabilities.get(key)
  if (!value || value.expires <= Date.now()) { capabilities.delete(key); throw new ReportError('NOT_FOUND', 'Viewer capability expired; reopen the report', 404) }
  return value
}
