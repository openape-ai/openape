import { describe, expect, it } from 'vitest'
import { checkBlockers, forgejoApiBase, normalizeForgejoChecks, reviewedHeadsMatch } from '../server/utils/branch-checks'

const sha = 'a'.repeat(40)
describe('required checks at reviewed heads', () => {
  it.each(['missing', 'pending', 'failure', 'error'])('blocks %s checks', (state) => {
    expect(checkBlockers(['ci'], state === 'missing' ? [] : [{ context: 'ci', state, sha }], sha)).toHaveLength(1)
  })
  it('blocks green checks from another commit or another context', () => {
    expect(checkBlockers(['ci'], [{ context: 'ci', state: 'success', sha: 'b'.repeat(40) }], sha)).toEqual(['ci: missing'])
    expect(checkBlockers(['ci'], [{ context: 'lint', state: 'success', sha }], sha)).toEqual(['ci: missing'])
  })
  it('accepts only the reviewed pair and all successful required contexts', () => {
    expect(reviewedHeadsMatch(sha, 'target', sha, 'target')).toBe(true)
    expect(reviewedHeadsMatch(undefined, undefined, sha, 'target')).toBe(false)
    expect(reviewedHeadsMatch('old', 'target', sha, 'target')).toBe(false)
    expect(reviewedHeadsMatch(sha, 'old', sha, 'target')).toBe(false)
    expect(checkBlockers(['ci', 'layout'], ['ci', 'layout'].map(context => ({ context, state: 'success', sha })), sha)).toEqual([])
  })
})

describe('trusted Forgejo status adapter', () => {
  it('rejects unexpected SHAs and uses the newest status for each context', () => {
    const statuses = [
      { id: 1, context: 'ci', status: 'success' },
      { id: 2, context: 'ci', status: 'pending', target_url: '/o/r/actions/runs/2/jobs/0' },
    ]
    expect(() => normalizeForgejoChecks({ sha: 'wrong', statuses }, sha, 'https://git.example')).toThrow(/unexpected commit/)
    expect(normalizeForgejoChecks({ sha, statuses }, sha, 'https://git.example')).toMatchObject([{ state: 'pending', targetUrl: 'https://git.example/o/r/actions/runs/2/jobs/0' }])
  })
  it('does not forward credentials to a status URL or another origin', () => {
    expect(forgejoApiBase('https://git.example/o/r.git')).toBe('https://git.example/api/v1/repos/o/r')
    for (const url of ['http://git.example/o/r', 'https://u:p@git.example/o/r', 'https://git.example/o/r?x=1']) expect(() => forgejoApiBase(url)).toThrow()
    const checks = normalizeForgejoChecks({ sha, statuses: [{ id: 1, context: 'ci', status: 'success', target_url: 'https://attacker.example/log' }] }, sha, 'https://git.example')
    expect(checks[0]?.targetUrl).toBeNull()
  })
})
