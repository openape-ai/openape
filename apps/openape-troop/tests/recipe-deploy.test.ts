import { describe, expect, it } from 'vitest'
import { materializeRecipe, parseRecipe } from '../server/utils/agent-recipe'
import { buildDeployPlan, fetchRecipeManifest, RECIPE_AGENT_TOOLS } from '../server/utils/recipe-deploy'

const MANIFEST = `
name: bluesky-summary
kind: agent
intent: Summarize the Bluesky feed about {{topic}}.
capabilities:
  - env: BLUESKY_HANDLE
  - env: BLUESKY_APP_PASSWORD
params:
  - name: topic
    type: string
    required: true
schedules:
  - cron: "0 8 * * *"
    description: morning digest for {{topic}}
  - cron: "0 18 * * *"
`

function recipe() {
  const r = parseRecipe(MANIFEST)
  if (!r.ok) throw new Error(r.reason)
  return r.value
}

describe('buildDeployPlan', () => {
  it('maps a materialized recipe to system prompt + schedules + caps', () => {
    const rec = recipe()
    const mat = materializeRecipe(rec, { topic: 'AI agents' })
    if (!mat.ok) throw new Error(mat.reason)
    const plan = buildDeployPlan(rec, mat.value)

    expect(plan.agentName).toBe('bluesky-summary')
    expect(plan.systemPrompt).toBe('Summarize the Bluesky feed about AI agents.')
    expect(plan.requiredCapabilities).toEqual(['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'])
    expect(plan.schedules).toHaveLength(2)
    expect(plan.schedules[0]).toMatchObject({
      taskId: 'recipe-0',
      cron: '0 8 * * *',
      name: 'morning digest for AI agents',
      userPrompt: 'morning digest for AI agents',
      tools: [...RECIPE_AGENT_TOOLS],
    })
    // schedule without description gets a sensible default user prompt
    expect(plan.schedules[1]!.userPrompt).toMatch(/Run your configured task/)
  })

  it('caps the agent name at the spawn-intent slug limit', () => {
    const rec = { ...recipe(), name: 'a-very-long-recipe-name-way-over-limit' }
    const mat = materializeRecipe(rec, { topic: 'x' })
    if (!mat.ok) throw new Error(mat.reason)
    expect(buildDeployPlan(rec, mat.value).agentName.length).toBeLessThanOrEqual(24)
  })
})

describe('fetchRecipeManifest', () => {
  const okFetch = async () => ({ ok: true, status: 200, text: MANIFEST })

  it('fetches + parses a pinned manifest from a github raw URL', async () => {
    let calledUrl = ''
    const r = await fetchRecipeManifest('github.com/openape-official-ape-agents/bluesky-summary@v0.1.0', async (u) => {
      calledUrl = u
      return { ok: true, status: 200, text: MANIFEST }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(calledUrl).toBe('https://raw.githubusercontent.com/openape-official-ape-agents/bluesky-summary/v0.1.0/ape-agent.yaml')
    expect(r.recipe.name).toBe('bluesky-summary')
    expect(r.ref).toBe('v0.1.0')
  })

  it('rejects a floating ref before any fetch (ref-pin)', async () => {
    let fetched = false
    const r = await fetchRecipeManifest('github.com/o/r@main', async () => { fetched = true; return { ok: true, status: 200, text: '' } })
    expect(r.ok).toBe(false)
    expect(fetched).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/floating ref/)
  })

  it('rejects an unsupported repo shape', async () => {
    const r = await fetchRecipeManifest('https://gitlab.com/o@v1.0.0', okFetch)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/unsupported repo|expected github/)
  })

  it('surfaces an HTTP error from the raw host', async () => {
    const r = await fetchRecipeManifest('github.com/o/r@v1.0.0', async () => ({ ok: false, status: 404, text: '' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/HTTP 404/)
  })

  it('rejects an invalid manifest body', async () => {
    const r = await fetchRecipeManifest('github.com/o/r@v1.0.0', async () => ({ ok: true, status: 200, text: 'kind: script\n' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/invalid ape-agent\.yaml/)
  })
})
