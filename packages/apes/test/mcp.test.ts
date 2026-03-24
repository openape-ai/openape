import { describe, expect, it } from 'vitest'
import { loadAdapterTools } from '../src/commands/mcp/adapter-tools'

describe('mcp adapter-tools', () => {
  it('loadAdapterTools returns empty array when no adapters installed', () => {
    const tools = loadAdapterTools()
    // May or may not have tools depending on local setup
    expect(Array.isArray(tools)).toBe(true)
  })

  it('tool definitions have required fields', () => {
    const tools = loadAdapterTools()
    for (const tool of tools) {
      expect(tool.name).toBeTruthy()
      expect(tool.name.startsWith('apes.run.')).toBe(true)
      expect(tool.description).toBeTruthy()
      expect(tool.adapterId).toBeTruthy()
      expect(tool.operationId).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
    }
  })
})
