import { describe, expect, it } from 'vitest'
import { agentNameFromEmail, planSecretRevoke, planSecretWrite, SECRETS_REL_DIR } from '../src/lib/secret-relay'

describe('agentNameFromEmail', () => {
  it.each([
    // DDISA agent emails always carry the +owner-local+owner-domain
    // suffix, so split('+')[0] isolates the `<name>-<hash>` slug. Same
    // derivation the config-update path has always used.
    ['agent-a-9f1c2ab+patrick+hofmann_eco@id.openape.ai', 'agent-a'],
    ['bsky-deadbeef+p+h_eco@id.openape.ai', 'bsky'],
    ['multi-word-name-cafe1234+p+h_eco@id.openape.ai', 'multi-word-name'],
  ])('%s → %s', (email, name) => {
    expect(agentNameFromEmail(email)).toBe(name)
  })

  it('returns null for an empty local part', () => {
    expect(agentNameFromEmail('+x+y@id')).toBeNull()
  })
})

describe('planSecretWrite', () => {
  it('writes into the agent secrets dir via stdin with mode 600', () => {
    const p = planSecretWrite('BLUESKY_APP_PASSWORD')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.script).toContain(`"$HOME/${SECRETS_REL_DIR}/BLUESKY_APP_PASSWORD.blob"`)
    expect(p.script).toContain('umask 077')
    expect(p.script).toContain('cat > ')
    // env strictly validated → no shell metacharacters can reach the path
    expect(p.script).not.toMatch(/[;&|`$(]\(/)
  })

  it.each(['lower', 'HAS-DASH', 'HAS SPACE', 'X;rm -rf ~', '../escape', ''])('rejects unsafe env %s', (env) => {
    const p = planSecretWrite(env)
    expect(p.ok).toBe(false)
    if (p.ok) return
    expect(p.reason).toMatch(/invalid env name/)
  })
})

describe('planSecretRevoke', () => {
  it('removes exactly the env blob', () => {
    const p = planSecretRevoke('TOKEN')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.script).toBe(`rm -f "$HOME/${SECRETS_REL_DIR}/TOKEN.blob"`)
  })

  it('rejects an unsafe env', () => {
    expect(planSecretRevoke('a b').ok).toBe(false)
  })
})
