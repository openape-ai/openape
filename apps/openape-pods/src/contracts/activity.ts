export interface RunApproval {
  grantId: string
  issuer: string
  state: 'pending' | 'approved' | 'denied' | 'revoked' | 'expired' | 'cancelled'
  title: string
  permission?: string
  subject?: string
  openError?: string
}
export function parseRunApproval(value: unknown): RunApproval {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid run approval')
  const item = value as RunApproval
  if (Object.keys(item).some(key => !['grantId', 'issuer', 'state', 'title', 'permission', 'subject', 'openError'].includes(key)) || typeof item.grantId !== 'string' || !/^[\w-]{1,128}$/.test(item.grantId) || typeof item.issuer !== 'string' || typeof item.title !== 'string' || item.title.length > 4096 || !['pending', 'approved', 'denied', 'revoked', 'expired', 'cancelled'].includes(item.state)) throw new Error('Invalid run approval fields')
  const url = new URL(item.issuer)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Invalid approval issuer')
  for (const key of ['permission', 'subject', 'openError'] as const) {
    if (item[key] !== undefined && (typeof item[key] !== 'string' || item[key].length > 4096)) throw new Error('Invalid approval metadata')
  }
  return item
}
export function approvalURL(approval: RunApproval): string {
  const valid = parseRunApproval(approval)
  const url = new URL('/grant-approval', valid.issuer); url.searchParams.set('grant_id', valid.grantId)
  return url.href
}
