import { describe, expect, it } from 'vitest'
import { assetPath, assertStatusRequest } from '../src/main/security'
import { isPodStatus } from '../src/contracts/ipc'

describe('renderer boundary', () => {
  it('serves bundled assets and rejects unassigned origins and path traversal', () => {
    expect(assetPath('pods://app/assets/main.js', '/app/renderer')).toBe('/app/renderer/assets/main.js')
    for (const url of ['https://app/index.html', 'pods://other/index.html', 'pods://user@app/index.html', 'pods://app:123/index.html', 'pods://app/..%2f..%2fprivate', 'pods://app/index.html?path=/private', 'pods://app/%00']) expect(() => assetPath(url, '/app/renderer')).toThrow()
  })
  it('accepts only a trusted top-frame status request without a payload', () => {
    expect(() => assertStatusRequest(true, [])).not.toThrow()
    expect(() => assertStatusRequest(false, [])).toThrow('Rejected')
    expect(() => assertStatusRequest(true, [{ command: 'execute', path: '/private' }])).toThrow('Rejected')
  })
  it('rejects malformed process messages and enabled execution', () => {
    const status = { version: 1, mode: 'fixture', executionEnabled: false, worker: { state: 'ready', pid: 42, error: null }, runtime: { electron: '40.9.3', node: '24.14.1' } }
    expect(isPodStatus(status)).toBe(true)
    for (const bad of [null, {}, { ...status, executionEnabled: true }, { ...status, mode: 'production' }, { ...status, worker: { state: 'ready', pid: -1, error: null } }]) expect(isPodStatus(bad)).toBe(false)
  })
})
