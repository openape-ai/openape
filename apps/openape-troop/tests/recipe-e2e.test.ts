import { generateX25519KeyPair, openString, seal } from '@openape/core'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { materializeRecipe, parseRecipe } from '../server/utils/agent-recipe'
import { buildDeployPlan } from '../server/utils/recipe-deploy'

// End-to-end of the Agent Recipe code path against the REAL reference
// recipe artifact (examples/agent-recipes/bluesky-summary). Exercises
// M1 (parse + materialize) → M3 (deploy plan) → M2a (seal/open) with
// no mocks. The live infra run (nest spawns, cron fires, Bluesky API)
// is the documented runbook in that recipe's README.

const here = dirname(fileURLToPath(import.meta.url))
const RECIPE_DIR = resolve(here, '../../../examples/agent-recipes/bluesky-summary')
const manifestText = readFileSync(join(RECIPE_DIR, 'ape-agent.yaml'), 'utf8')

describe('bluesky-summary recipe — end to end', () => {
  it('the manifest parses and points at a tool file that exists', () => {
    const r = parseRecipe(manifestText)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.name).toBe('bluesky-summary')
    expect(r.value.tools).toEqual(['tools/fetch-feed.mjs'])
    for (const t of r.value.tools) {
      expect(existsSync(join(RECIPE_DIR, t)), `${t} must exist in the recipe`).toBe(true)
    }
  })

  it('materializes the intent + schedules and builds the deploy plan', () => {
    const r = parseRecipe(manifestText)
    if (!r.ok) throw new Error(r.reason)
    const mat = materializeRecipe(r.value, { topic: 'AI agents' })
    expect(mat.ok).toBe(true)
    if (!mat.ok) return

    const plan = buildDeployPlan(r.value, mat.value)
    expect(plan.agentName).toBe('bluesky-summary')
    expect(plan.systemPrompt).toContain('focused on AI agents')
    expect(plan.systemPrompt).not.toContain('{{topic}}')
    expect(plan.schedules.map(s => s.cron)).toEqual(['0 8 * * *', '0 18 * * *'])
    expect(plan.schedules[0]!.name).toBe('morning Bluesky digest on AI agents')
    expect(plan.requiredCapabilities).toEqual(['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'])
  })

  it('fails deploy when a required param is missing', () => {
    const r = parseRecipe(manifestText)
    if (!r.ok) throw new Error(r.reason)
    expect(materializeRecipe(r.value, {}).ok).toBe(false)
  })

  it('seals each capability to the agent and only the agent can open it', () => {
    const agent = generateX25519KeyPair()
    const value = 'abcd-efgh-ijkl-mnop' // a Bluesky app password shape

    // troop seals on submit; only ciphertext is ever stored/relayed.
    const box = seal(value, agent.publicKey)
    expect(JSON.stringify(box)).not.toContain(value)

    // the agent (and only the agent) opens it
    expect(openString(box, agent.privateKey)).toBe(value)

    // revoke / wrong key → clean failure, never plaintext
    const other = generateX25519KeyPair()
    expect(() => openString(box, other.privateKey)).toThrow()
  })
})
