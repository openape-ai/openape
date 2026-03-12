import { describe, expect, it } from 'vitest'
import { createClientMetadata, serveClientMetadata } from '../sp/manifest.js'

describe('sP Client Metadata', () => {
  const config = {
    client_id: 'sp.example.com',
    client_name: 'Example SP',
    redirect_uris: ['https://sp.example.com/callback'],
  }

  it('creates a client metadata object', () => {
    const metadata = createClientMetadata(config)
    expect(metadata.client_id).toBe('sp.example.com')
    expect(metadata.client_name).toBe('Example SP')
  })

  it('serves client metadata as JSON response', () => {
    const response = serveClientMetadata(config)
    expect(response.headers.get('Content-Type')).toBe('application/json')
  })
})
