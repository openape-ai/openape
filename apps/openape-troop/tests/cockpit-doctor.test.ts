import { describe, expect, it } from 'vitest'
import { cliNamesFromToolPatterns } from '../server/utils/cockpit/doctor'
import { agentStatus, markAgentDoctor, markAgentPoll, missingTools } from '../server/utils/cockpit/queue'

describe('cliNamesFromToolPatterns', () => {
  it('extracts the command name from wildcard patterns, deduped and sorted', () => {
    expect(cliNamesFromToolPatterns(['gmail-cli *', 'o365-cli mail *', 'gmail-cli mail list', 'pdftotext *']))
      .toEqual(['gmail-cli', 'o365-cli', 'pdftotext'])
  })

  it('skips the all-tools wildcard and unnameable tokens', () => {
    expect(cliNamesFromToolPatterns(['*', '', '   ', '$(rm -rf /) *', 'ape-tasks *']))
      .toEqual(['ape-tasks'])
  })
})

describe('doctor report in presence', () => {
  it('missing tools surface in agentStatus regardless of mode', () => {
    const owner = 'doctor-test@example.com'
    expect(missingTools(owner)).toEqual([]) // no report yet → nothing to warn about
    markAgentDoctor(owner, { 'gmail-cli': false, 'o365-cli': true, 'pdftotext': false })
    expect(missingTools(owner)).toEqual(['gmail-cli', 'pdftotext'])
    expect(agentStatus(owner).missingTools).toEqual(['gmail-cli', 'pdftotext']) // offline: still reported
    markAgentPoll(owner, 5000)
    expect(agentStatus(owner).mode).toBe('active')
    expect(agentStatus(owner).missingTools).toEqual(['gmail-cli', 'pdftotext'])
    markAgentDoctor(owner, { 'gmail-cli': true, 'o365-cli': true, 'pdftotext': true }) // fixed → clears
    expect(agentStatus(owner).missingTools).toEqual([])
  })

  it('a tool scope hides misses that belong to another org (#996)', () => {
    const owner = 'doctor-scope@example.com'
    markAgentDoctor(owner, { 'iurio': false, 'gmail-cli': false })
    expect(agentStatus(owner).missingTools).toEqual(['gmail-cli', 'iurio']) // ohne Scope: owner-weit
    expect(agentStatus(owner, new Set(['gmail-cli'])).missingTools).toEqual(['gmail-cli']) // OpenApe sieht iurio nicht
    expect(agentStatus(owner, new Set(['iurio'])).missingTools).toEqual(['iurio'])
  })
})
