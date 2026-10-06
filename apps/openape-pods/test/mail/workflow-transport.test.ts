import { expect, it, vi } from 'vitest'
import { createWorkflowMailTransport } from '../../src/worker/mail/workflow-transport'
import type { MailWorkflowConfiguration } from '../../src/contracts/mail-workflow'

const configuration: MailWorkflowConfiguration = { mailbox: 'owner@example.invalid', filterPodId: '00000000-0000-4000-8000-000000000001', notifyPodId: '00000000-0000-4000-8000-000000000002', applicationId: '00000000-0000-4000-8000-000000000003', telegramCredential: 'telegram_bot_token', telegramChatId: '12345', protectedPartners: [], rules: [], mode: 'preview' }
const destination = { chatId: configuration.telegramChatId, credential: configuration.telegramCredential }
it.each([
  [200, '{', 'unknown'],
  [503, '{"ok":false}', 'unknown'],
  [403, '{"ok":false}', 'notApplied'],
  [200, '{"ok":true,"result":{"message_id":42,"chat":{"id":999}}}', 'unknown'],
  [200, '{"ok":true,"result":{"message_id":0,"chat":{"id":12345}}}', 'unknown'],
  [200, '{"ok":true,"result":{"message_id":42,"chat":{"id":12345}}}', 'confirmed'],
])('requires a bound Telegram receipt (%s, %s)', async (status, body, expected) => {
  const http = vi.fn(async () => ({ status, headers: {}, body }))
  const transport = createWorkflowMailTransport(configuration, { tool: vi.fn(), credential: async () => 'synthetic-token', http, assertCurrent: () => {} })
  expect((await transport.send('Frozen synthetic report', destination)).state).toBe(expected)
  expect(http).toHaveBeenCalledTimes(1)
  expect(transport.conditionalMoveVerified).toBe(false)
})
it('binds CLI reads to the assigned application and rejects account substitution', async () => {
  const tool = vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify({ protocol: 'pods-mail/v1', account: 'other@example.invalid', operation: 'delta', outcome: 'confirmed', items: [], delta: 'boundary' }) }))
  const transport = createWorkflowMailTransport(configuration, { tool, credential: vi.fn(), http: vi.fn(), assertCurrent: () => {} })
  await expect(transport.delta(null)).rejects.toThrow('account or operation')
  expect(tool).toHaveBeenCalledWith({ applicationId: configuration.applicationId, argv: ['workflow', 'delta', '--account', configuration.mailbox] })
})
