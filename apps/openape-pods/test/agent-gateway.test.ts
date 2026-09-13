// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { startAgentGateway } from '../src/worker/agent/gateway'

describe('agent capability gateway', () => {
  it('rejects foreign capabilities, browser origins, resource helpers and post-cancellation calls', async () => {
    const controller = new AbortController(); const tool = vi.fn(); const provider = vi.fn()
    const first = await startAgentGateway({ tool, provider }, controller.signal)
    const second = await startAgentGateway({ tool, provider }, new AbortController().signal)
    const request = (token: string, value: unknown, origin?: string) => fetch(`http://127.0.0.1:${first.port}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(value) })
    try {
      const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
      expect((await request(second.capability, list)).status).toBe(403)
      expect((await request(first.capability, list, 'https://unassigned.invalid')).status).toBe(403)
      const body = await (await request(first.capability, list)).json()
      expect(body.result.tools.map((entry: { name: string }) => entry.name)).toEqual(['ape_shell'])
      for (const method of ['resources/list', 'resources/read', 'resources/templates/list', 'prompts/get']) {
        expect(await (await request(first.capability, { ...list, method })).json()).toMatchObject({ error: { code: -32601 } })
      }
      expect(await (await request(first.capability, { ...list, method: 'tools/call', params: { name: 'exec_command', arguments: {} } })).json()).toMatchObject({ error: { code: -32601 } })
      controller.abort()
      expect((await request(first.capability, list)).status).toBe(403)
      expect(tool).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled()
    }
    finally { await first.close(); await second.close() }
  })
})
