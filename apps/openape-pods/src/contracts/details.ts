export interface Citation { id: string, version: string, hash: string, locator: string }
export interface KnowledgeClaim { id: string, matter: string, kind: 'finding' | 'question' | 'gap', text: string, citations: Citation[], supersedes: string | null, revision: number, current: boolean }
export interface ScriptVersion { hash: string, assignmentRevision: number, validated: boolean, active: boolean }
export interface PodDetails { claims: KnowledgeClaim[], total: number, counts: { finding: number, question: number, gap: number }, checkpointRevision: number, versions: ScriptVersion[], source: { citation: Citation, content: string } | null }
export type DetailsCommand = { type: 'list', podId: string, offset?: number } | { type: 'source', podId: string, id: string, version: string } | { type: 'activate', podId: string, hash: string, expectedActive: string | null, assignmentRevision: number }
export function parseDetailsCommand(value: unknown): DetailsCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pod detail request')
  const request = value as Record<string, unknown>
  const keys = request.type === 'list' ? ['type', 'podId', 'offset'] : request.type === 'source' ? ['type', 'podId', 'id', 'version'] : request.type === 'activate' ? ['type', 'podId', 'hash', 'expectedActive', 'assignmentRevision'] : []
  if (!keys.length || Object.keys(request).some(key => !keys.includes(key)) || typeof request.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(request.podId)) throw new Error('Invalid pod detail scope')
  if (request.type === 'list' && request.offset !== undefined && (!Number.isSafeInteger(request.offset) || (request.offset as number) < 0)) throw new Error('Invalid knowledge offset')
  if (request.type === 'source' && ['id', 'version'].some(key => typeof request[key] !== 'string' || !(request[key] as string).length || (request[key] as string).length > 20000)) throw new Error('Invalid citation')
  if (request.type === 'activate' && (typeof request.hash !== 'string' || !/^[a-f0-9]{64}$/.test(request.hash) || (request.expectedActive !== null && (typeof request.expectedActive !== 'string' || !/^[a-f0-9]{64}$/.test(request.expectedActive))) || !Number.isSafeInteger(request.assignmentRevision) || (request.assignmentRevision as number) < 1)) throw new Error('Invalid version activation')
  return structuredClone(request) as DetailsCommand
}
export function parsePodDetails(value: unknown): PodDetails {
  if (!value || typeof value !== 'object') throw new Error('Invalid pod details')
  const data = value as PodDetails
  if (!Array.isArray(data.claims) || data.claims.length > 100 || !Array.isArray(data.versions) || !Number.isSafeInteger(data.total) || !Number.isSafeInteger(data.checkpointRevision) || !data.counts || ['finding', 'question', 'gap'].some(key => !Number.isSafeInteger(data.counts[key as keyof typeof data.counts]))) throw new Error('Invalid pod detail fields')
  for (const claim of data.claims) {
    if (typeof claim.id !== 'string' || typeof claim.matter !== 'string' || typeof claim.text !== 'string' || !['finding', 'question', 'gap'].includes(claim.kind) || !Array.isArray(claim.citations) || typeof claim.current !== 'boolean') throw new Error('Invalid sourced claim')
    for (const citation of claim.citations) {
      if (['id', 'version', 'hash', 'locator'].some(key => typeof citation[key as keyof Citation] !== 'string')) throw new Error('Invalid source reference')
    }
  }
  for (const version of data.versions) {
    if (!/^[a-f0-9]{64}$/.test(version.hash) || !Number.isSafeInteger(version.assignmentRevision) || typeof version.validated !== 'boolean' || typeof version.active !== 'boolean') throw new Error('Invalid script version')
  }
  if (data.source !== null && (typeof data.source?.content !== 'string' || !data.source.citation)) throw new Error('Invalid source content')
  return data
}
