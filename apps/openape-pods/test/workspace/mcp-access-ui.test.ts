import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import McpAccess from '../../src/renderer/McpAccess.vue'
import type { McpAccess as Access, McpAccessCommand } from '../../src/contracts/mcp-access'
import { installWorkspace } from '../layout/workspace-fixture'

afterEach(() => vi.useRealTimers())
it('uses one app-wide selector, preserves the chosen duration and displays expiry from the main process', async () => {
  let state: Access = { mode: 'off', duration: 'hour', expiresAt: null }
  const mcpAccess = vi.fn(async (command: McpAccessCommand) => {
    if (command.type === 'set') state = { mode: command.mode, duration: command.duration, expiresAt: command.mode === 'off' ? null : 1790003600000 }
    return { ...state }
  })
  installWorkspace({ mcpAccess })
  const wrapper = mount(McpAccess); await flushPromises()
  expect(wrapper.get('.mcp-levels [aria-pressed="true"]').text()).toBe('Off')
  await wrapper.findAll('.mcp-levels button')[1]!.trigger('click'); await flushPromises()
  expect(mcpAccess).toHaveBeenLastCalledWith({ type: 'set', mode: 'read', duration: 'hour' })
  expect(wrapper.get('[role="status"]').text()).toContain('changes and runs are blocked')
  await wrapper.findAll('.mcp-duration button')[1]!.trigger('click'); await flushPromises()
  expect(mcpAccess).toHaveBeenLastCalledWith({ type: 'set', mode: 'read', duration: 'day' })
  await wrapper.findAll('.mcp-levels button')[2]!.trigger('click'); await flushPromises()
  expect(mcpAccess).toHaveBeenLastCalledWith({ type: 'set', mode: 'write', duration: 'day' })
  expect(wrapper.text()).toContain('Then MCP switches off')
  expect(wrapper.findAll('button').some(button => button.text() === 'Stop')).toBe(false)
  wrapper.unmount()
})
it('shows automatic expiry without granting access again and exposes update errors', async () => {
  vi.useFakeTimers()
  let state: Access = { mode: 'read', duration: 'hour', expiresAt: 1000 }
  const mcpAccess = vi.fn(async (_command: McpAccessCommand) => ({ ...state }))
  installWorkspace({ mcpAccess })
  const wrapper = mount(McpAccess); await flushPromises()
  state = { mode: 'off', duration: 'hour', expiresAt: null }
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(wrapper.get('.mcp-levels [aria-pressed="true"]').text()).toBe('Off')
  expect(mcpAccess.mock.calls.every(([command]) => command.type === 'get')).toBe(true)
  mcpAccess.mockRejectedValueOnce(new Error('Access settings could not be saved'))
  await wrapper.findAll('.mcp-levels button')[2]!.trigger('click'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('could not be saved')
  expect(wrapper.find('.mcp-levels [aria-pressed="true"]').exists()).toBe(false)
  wrapper.unmount()
})
