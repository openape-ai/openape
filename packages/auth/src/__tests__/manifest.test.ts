import { describe, expect, it } from 'vitest'
import { serveClientMetadata } from '../sp/manifest.js'

describe('sP Client Metadata', () => {
  const config = {
    client_id: 'sp.example.com',
    client_name: 'Example SP',
    redirect_uris: ['https://sp.example.com/callback'],
  }

  it('serves client metadata as JSON response', () => {
    const response = serveClientMetadata(config)
    expect(response.headers.get('Content-Type')).toBe('application/json')
  })
})
