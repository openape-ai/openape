// @vitest-environment node
import { expect, it } from 'vitest'
import type { ProxyAgentRequest } from '../../src/contracts/agent'
import type { AgentBackendStatus } from '../../src/contracts/agent-status'
import type { ProxyAgentCall } from '../../src/worker/agent/proxy-client'
import { descriptionProvider, summarizeConversation } from '../../src/worker/master/summarize'

function stub(response: string, requests: ProxyAgentRequest[] = []): ProxyAgentCall {
  return async (request) => { requests.push(request); return { response, threadId: 'proxy-call:fixture' } }
}

it('makes one tool-free small proxy call and returns the description', async () => {
  const requests: ProxyAgentRequest[] = []
  const description = await summarizeConversation({ call: stub(JSON.stringify({ description: 'Checks mail hourly.' }), requests), provider: 'claude' }, '{"conversation":[]}', new AbortController().signal)
  expect(description).toBe('Checks mail hourly.')
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ backend: 'proxy', provider: 'claude', modelSize: 'small', tools: [] })
  expect(requests[0]!.prompt).toContain('{"description":')
  expect(requests[0]!.prompt.endsWith('{"conversation":[]}')).toBe(true)
})

it('accepts a fenced JSON answer and rejects anything else', async () => {
  const signal = new AbortController().signal
  await expect(summarizeConversation({ call: stub('```json\n{"description":"Daily report."}\n```'), provider: 'codex' }, '{}', signal)).resolves.toBe('Daily report.')
  await expect(summarizeConversation({ call: stub('Daily report.'), provider: 'codex' }, '{}', signal)).rejects.toThrow('invalid result')
  await expect(summarizeConversation({ call: stub('{"description":"x","extra":1}'), provider: 'codex' }, '{}', signal)).rejects.toThrow('invalid result')
})

it('needs a configured model API connection', async () => {
  await expect(summarizeConversation(undefined, '{}', new AbortController().signal)).rejects.toThrow('Configure a model API connection')
})

it('picks the first provider whose small model and connection are usable', () => {
  const mapping: Omit<AgentBackendStatus['mappings'][number], 'provider'> = { modelSize: 'small', modelId: 'm', enabled: true, defaultThinking: 'low', thinking: ['low'], capabilityEvidenceVersion: '1' }
  const connection = { enabled: true, baseUrl: 'http://127.0.0.1:8317/v1', format: 'responses', authentication: 'token', defaultThinking: 'low', hasToken: true } as const
  const status = (connections: AgentBackendStatus['connections']): AgentBackendStatus => ({ configured: true, enabled: true, available: true, mappings: [{ ...mapping, provider: 'claude' }, { ...mapping, provider: 'codex' }], connections })
  expect(descriptionProvider(status([{ ...connection, id: 'openai' }, { ...connection, id: 'anthropic', enabled: false }] as AgentBackendStatus['connections']))).toBe('codex')
  expect(descriptionProvider(status([{ ...connection, id: 'anthropic' }] as AgentBackendStatus['connections']))).toBe('claude')
  expect(descriptionProvider({ ...status([{ ...connection, id: 'openai' }] as AgentBackendStatus['connections']), available: false })).toBeUndefined()
  expect(descriptionProvider(undefined)).toBeUndefined()
})
