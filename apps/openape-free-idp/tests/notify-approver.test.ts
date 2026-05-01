import { describe, expect, it } from 'vitest'
import { summarizeRequest } from '../server/utils/summarize-grant'

// Pure helper test for `summarizeRequest`. The full notifyApprover
// fan-out is exercised end-to-end via the manual deploy probe
// (described in this PR's plan); spinning up an in-memory IdP +
// mocked web-push to mirror that here is more ceremony than value
// at this stage.

describe('summarizeRequest', () => {
  it('joins command array with spaces', () => {
    expect(summarizeRequest({
      requester: 'a@b', target_host: 'h', audience: 'shapes',
      command: ['git', 'status'],
    } as Parameters<typeof summarizeRequest>[0])).toBe('git status')
  })

  it('truncates long commands with an ellipsis', () => {
    const cmd = ['bash', 'a'.repeat(200)]
    const out = summarizeRequest({
      requester: 'a@b', target_host: 'h', audience: 'shapes', command: cmd,
    } as Parameters<typeof summarizeRequest>[0])
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(91) // 90 + ellipsis
  })

  it('falls back to reason when no command', () => {
    expect(summarizeRequest({
      requester: 'a@b', target_host: 'h', audience: 'escapes',
      reason: 'restart database',
    } as Parameters<typeof summarizeRequest>[0])).toBe('restart database')
  })

  it('falls back to audience when no command and no reason', () => {
    expect(summarizeRequest({
      requester: 'a@b', target_host: 'h', audience: 'shapes',
    } as Parameters<typeof summarizeRequest>[0])).toBe('shapes')
  })

  it('handles empty command array via reason fallback', () => {
    expect(summarizeRequest({
      requester: 'a@b', target_host: 'h', audience: 'shapes',
      command: [], reason: 'deploy',
    } as Parameters<typeof summarizeRequest>[0])).toBe('deploy')
  })
})
