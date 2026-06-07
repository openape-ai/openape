import { describe, expect, it, vi } from 'vitest'
import { FALLBACK_CODEX_MODELS, fetchCodexModels, parseCodexModels } from '../src/codex-models'

const cred = { access_token: 'AT', refresh_token: 'r', id_token: 'i', expires_at: 1, account_id: 'acc-7' }

describe('parseCodexModels', () => {
  it('extracts visible slugs sorted by priority then slug', () => {
    const slugs = parseCodexModels({
      models: [
        { slug: 'gpt-5.4', priority: 20 },
        { slug: 'gpt-5.5', priority: 10 },
        { slug: 'gpt-5.4-mini', priority: 20 },
      ],
    })
    expect(slugs).toEqual(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'])
  })

  it('drops hidden models (visibility hide/hidden)', () => {
    const slugs = parseCodexModels({
      models: [
        { slug: 'gpt-5.5', priority: 1 },
        { slug: 'secret', priority: 0, visibility: 'hidden' },
        { slug: 'legacy', priority: 2, visibility: 'hide' },
      ],
    })
    expect(slugs).toEqual(['gpt-5.5'])
  })

  it('dedups repeated slugs', () => {
    expect(parseCodexModels({ models: [{ slug: 'gpt-5.5' }, { slug: 'gpt-5.5' }] })).toEqual(['gpt-5.5'])
  })

  it('returns [] for a malformed payload', () => {
    expect(parseCodexModels({})).toEqual([])
    expect(parseCodexModels(null)).toEqual([])
    expect(parseCodexModels({ models: 'nope' })).toEqual([])
  })
})

describe('fetchCodexModels', () => {
  it('queries the codex models endpoint with bearer auth and returns parsed slugs', async () => {
    const fetchImpl = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      expect(url).toBe('https://chatgpt.com/backend-api/codex/models?client_version=1.0.0')
      expect(init.headers.authorization).toBe('Bearer AT')
      return { ok: true, status: 200, json: async () => ({ models: [{ slug: 'gpt-5.5', priority: 1 }] }) }
    })
    const slugs = await fetchCodexModels(cred, fetchImpl as unknown as typeof fetch)
    expect(slugs).toEqual(['gpt-5.5'])
  })

  it('falls back to the known model list on HTTP error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    const slugs = await fetchCodexModels(cred, fetchImpl as unknown as typeof fetch)
    expect(slugs).toEqual([...FALLBACK_CODEX_MODELS])
  })

  it('falls back when the live list is empty', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ models: [] }) }))
    const slugs = await fetchCodexModels(cred, fetchImpl as unknown as typeof fetch)
    expect(slugs).toEqual([...FALLBACK_CODEX_MODELS])
  })
})
