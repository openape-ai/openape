import { describe, expect, it } from 'vitest'
import { resolveClientId } from '../src/runtime/server/utils/client-id'

describe('resolveClientId', () => {
  it('uses the pinned client_id when one is configured', () => {
    expect(resolveClientId('chat.openape.ai', 'pr-1.preview.openape.ai')).toBe('chat.openape.ai')
  })

  it('derives the client_id from the request host when not configured', () => {
    // A dynamic preview host self-identifies as its own host (DDISA: an SP's
    // identity IS its domain), so no per-deploy client_id config is needed.
    expect(resolveClientId('', 'pr-1.preview.openape.ai')).toBe('pr-1.preview.openape.ai')
  })

  it('treats a whitespace-only config as unset', () => {
    expect(resolveClientId('   ', 'sp-demo.preview.openape.ai')).toBe('sp-demo.preview.openape.ai')
  })
})
