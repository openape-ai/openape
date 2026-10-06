// @vitest-environment node
import { expect, it } from 'vitest'
import { administrationActions, parseAdministration } from '../../src/contracts/codex-admin'
import { codexTool } from '../../src/contracts/codex'

// Codex raises a secret request only by alias, purpose and epoch; it never carries a value or a path.
const podId = '00000000-0000-4000-8000-000000000001'

it('parses requestSecret with alias, purpose and epoch and offers it in the tool schema', () => {
  expect(administrationActions).toContain('requestSecret')
  expect((codexTool.inputSchema.properties.action as { enum: string[] }).enum).toContain('requestSecret')
  expect(parseAdministration({ action: 'requestSecret', revision: 3, command: { podId, alias: 'telegram_bot_token', purpose: 'PR reports to the team chat', epoch: 2 } })).toEqual({ kind: 'requestSecret', revision: 3, command: { podId, alias: 'telegram_bot_token', purpose: 'PR reports to the team chat', epoch: 2 } })
  expect(() => parseAdministration({ action: 'requestSecret', revision: 3, command: { podId, alias: 'Telegram Token', purpose: '', epoch: 2 } })).toThrow('Credential aliases')
  expect(() => parseAdministration({ action: 'requestSecret', revision: 3, command: { podId, alias: 'token', purpose: '', epoch: 2, value: 'secret' } })).toThrow('Invalid secret request')
  expect(() => parseAdministration({ action: 'requestSecret', revision: 3, command: { podId, alias: 'token', purpose: 'x'.repeat(501), epoch: 2 } })).toThrow('Invalid secret request')
  expect(() => parseAdministration({ action: 'requestSecret', revision: 3, command: { podId, alias: 'token', purpose: '', epoch: 2 }, path: '/private/token' })).toThrow()
  expect(() => parseAdministration({ action: 'requestSecret', revision: 0, command: { podId, alias: 'token', purpose: '', epoch: 2 } })).toThrow('Current Pod revision required')
})
