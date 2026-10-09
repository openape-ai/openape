import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import McpSession from '../../src/renderer/McpSession.vue'
import type { McpSessionCommand, McpSessionView } from '../../src/contracts/mcp-session'
import { applyLanguage } from '../../src/renderer/i18n'
import { installWorkspace } from '../layout/workspace-fixture'

afterEach(() => { vi.useRealTimers(); applyLanguage('en') })
it('shows the session end from the main process and ends it immediately', async () => {
  vi.useFakeTimers()
  const end = new Date(2026, 9, 9, 14, 30).getTime()
  let state: McpSessionView = { expiresAt: null, pending: false }
  const mcpSession = vi.fn(async (command: McpSessionCommand) => {
    if (command.type === 'end') state = { expiresAt: null, pending: false }
    return { ...state }
  })
  installWorkspace({ mcpSession })
  const wrapper = mount(McpSession); await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toBe('Codex not signed in')
  expect(wrapper.findAll('button').some(button => button.text() === 'End session')).toBe(false)
  state = { expiresAt: null, pending: true }
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toBe('Sign-in waiting for you in the browser')
  state = { expiresAt: end, pending: false }
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toBe('Codex signed in until 14:30')
  expect(mcpSession.mock.calls.every(([command]) => command.type === 'get')).toBe(true)
  await wrapper.findAll('button').find(button => button.text() === 'End session')!.trigger('click'); await flushPromises()
  expect(mcpSession).toHaveBeenLastCalledWith({ type: 'end' })
  expect(wrapper.get('[role="status"]').text()).toBe('Codex not signed in')
  expect(wrapper.findAll('button').some(button => button.text() === 'End session')).toBe(false)
  applyLanguage('de'); state = { expiresAt: end, pending: false }
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toBe('Codex angemeldet bis 14:30')
  wrapper.unmount()
})
it('exposes a failed End session without hiding the active session', async () => {
  const state: McpSessionView = { expiresAt: new Date(2026, 9, 9, 9, 5).getTime(), pending: false }
  const mcpSession = vi.fn(async (_command: McpSessionCommand) => ({ ...state }))
  installWorkspace({ mcpSession })
  const wrapper = mount(McpSession); await flushPromises()
  mcpSession.mockRejectedValueOnce(new Error('Session could not be ended'))
  await wrapper.findAll('button').find(button => button.text() === 'End session')!.trigger('click'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('could not be ended')
  expect(wrapper.get('[role="status"]').text()).toBe('Codex signed in until 09:05')
  wrapper.unmount()
})
