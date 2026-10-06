import type { ClaimInput, SourceInput } from '../storage/database'

export function parseProgress(value: unknown): { expectedRevision: number, checkpoint: Record<string, unknown>, sources: SourceInput[], claims: ClaimInput[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid progress request')
  const progress = value as Record<string, unknown>
  if (Object.keys(progress).some(key => !['expectedRevision', 'checkpoint', 'sources', 'claims'].includes(key)) || !Number.isSafeInteger(progress.expectedRevision) || (progress.expectedRevision as number) < 0 || !progress.checkpoint || typeof progress.checkpoint !== 'object' || Array.isArray(progress.checkpoint)) throw new Error('Invalid checkpoint fields')
  if (!Array.isArray(progress.sources) || progress.sources.length > 100 || !Array.isArray(progress.claims) || progress.claims.length > 100) throw new Error('Invalid knowledge batch')
  for (const source of progress.sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).some(key => !['id', 'locator', 'version', 'content'].includes(key)) || ['id', 'locator', 'version', 'content'].some(key => typeof source[key] !== 'string')) throw new Error('Invalid source fields')
  }
  for (const claim of progress.claims) {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim) || Object.keys(claim).some(key => !['id', 'matter', 'kind', 'text', 'sourceIds', 'supersedes'].includes(key)) || ['id', 'matter', 'kind', 'text'].some(key => typeof claim[key] !== 'string') || !Array.isArray(claim.sourceIds) || claim.sourceIds.some((id: unknown) => typeof id !== 'string') || (claim.supersedes !== undefined && typeof claim.supersedes !== 'string')) throw new Error('Invalid claim fields')
  }
  return progress as unknown as { expectedRevision: number, checkpoint: Record<string, unknown>, sources: SourceInput[], claims: ClaimInput[] }
}
