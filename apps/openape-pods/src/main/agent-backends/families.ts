import type { AgentModelSize, AgentProvider } from '../../contracts/agent'
import { AgentCallError } from '../../contracts/agent-errors'
import type { ModelCatalogEntry } from './types'

export const modelFamilies: Record<AgentProvider, Record<AgentModelSize, string>> = {
  claude: { small: 'haiku', medium: 'sonnet', large: 'opus', xlarge: 'fable' },
  codex: { small: 'luna', medium: 'terra', large: 'sol', xlarge: 'astra' },
}
export function modelVersion(id: string, provider: AgentProvider, family: string): number[] | undefined {
  if (provider === 'codex') {
    const match = /^gpt-(\d+(?:\.\d+)*)-([a-z]+)(?:-(\d{8}))?$/.exec(id)
    if (!match || match[2] !== family) return undefined
    return [...match[1].split('.').map(Number), ...(match[3] ? [Number(match[3])] : [])]
  }
  const match = new RegExp(`^claude-${family}-(\\d+(?:-\\d{1,3})*)(?:-(\\d{8}))?$`).exec(id)
  if (match) return [...match[1].split('-').map(Number), ...(match[2] ? [Number(match[2])] : [])]
  const legacy = provider === 'claude' ? new RegExp(`^claude-(\\d+)-(\\d+)-${family}-(\\d{8})$`).exec(id) : null
  return legacy ? [Number(legacy[1]), Number(legacy[2]), Number(legacy[3])] : undefined
}
function compare(a: number[], b: number[]): number {
  // Dated revisions follow the semantic version, including when only one ID has a date.
  const release = (parts: number[]) => parts.filter(part => part < 10000000)
  const av = release(a); const bv = release(b)
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    if ((av[i] ?? 0) !== (bv[i] ?? 0)) return (av[i] ?? 0) - (bv[i] ?? 0)
  }
  return (a.find(part => part >= 10000000) ?? 0) - (b.find(part => part >= 10000000) ?? 0)
}
export function latestModel(entries: ModelCatalogEntry[], provider: AgentProvider, size: AgentModelSize): { entry: ModelCatalogEntry, version: string, family: string } {
  const family = modelFamilies[provider][size]; const owner = provider === 'claude' ? 'anthropic' : 'openai'
  const candidates: { entry: ModelCatalogEntry, version: number[] }[] = []
  for (const entry of entries) {
    if (entry.owned_by && entry.owned_by !== owner) continue
    if (!entry.id.split(/[-.]/).includes(family) || /(?:^|-)(?:preview|beta|experimental)(?:-|$)/.test(entry.id)) continue
    const version = modelVersion(entry.id, provider, family)
    if (!version || version.some(part => !Number.isSafeInteger(part))) throw new AgentCallError('model_unavailable', 'The newest model version cannot be determined from the catalog', { phase: 'resolve', cause: 'ambiguous_model_version' })
    candidates.push({ entry, version })
  }
  candidates.sort((a, b) => compare(b.version, a.version))
  const selected = candidates[0]
  if (!selected) throw new AgentCallError('model_unavailable', 'The model family is not offered by this API', { phase: 'resolve' })
  if (candidates[1] && compare(selected.version, candidates[1].version) === 0 && selected.entry.id !== candidates[1].entry.id) throw new AgentCallError('model_unavailable', 'The newest model identity is ambiguous', { phase: 'resolve', cause: 'ambiguous_model_version' })
  return { entry: selected.entry, version: selected.version.join('.'), family }
}
