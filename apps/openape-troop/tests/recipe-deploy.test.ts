import { describe, expect, it } from 'vitest'
import { materializeRecipe, parseRecipe } from '../server/utils/agent-recipe'
import toolCatalog from '../server/tool-catalog.json'
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
  it('uses only known catalog tool names for recipe agents', () => {
    const knownTools = new Set(toolCatalog.tools.map(t => t.name))
    expect(RECIPE_AGENT_TOOLS.length).toBeGreaterThan(0)
    expect(RECIPE_AGENT_TOOLS.every(tool => knownTools.has(tool))).toBe(true)
  })

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

  it('gives scheduled tasks the recipe-declared tools when present (orchestrator pattern)', () => {
    const manifest = `
name: pm
kind: agent
intent: Orchestrate {{org}}.
params:
  - name: org
    type: string
    required: true
schedules:
  - cron: "*/10 * * * *"
    description: triage + dispatch
tools:
  - tasks.list
  - agent.spawn
  - agent.destroy
`
    const r = parseRecipe(manifest)
    if (!r.ok) throw new Error(r.reason)
    const mat = materializeRecipe(r.value, { org: 'Werkstatt' })
    if (!mat.ok) throw new Error(mat.reason)
    const plan = buildDeployPlan(r.value, mat.value)

    // declared tools flow onto the scheduled task — NOT the bash-centric default
    expect(plan.schedules[0]!.tools).toEqual(['tasks.list', 'agent.spawn', 'agent.destroy'])
  })

  it('excludes optional capabilities from requiredCapabilities (multi-forge recipe)', () => {
    const manifest = `
name: coding-agent
kind: agent
intent: Code on {{repo}}.
capabilities:
  - env: GH_TOKEN
    optional: true
  - env: AZ_PAT
    optional: true
  - env: LLM_API_KEY
params:
  - name: repo
    type: string
    required: true
schedules:
  - cron: "*/10 * * * *"
`
    const r = parseRecipe(manifest)
    if (!r.ok) throw new Error(r.reason)
    const mat = materializeRecipe(r.value, { repo: 'x/y' })
    if (!mat.ok) throw new Error(mat.reason)
    const plan = buildDeployPlan(r.value, mat.value)
    // Only the non-optional capability is required at deploy time; the
    // forge tokens are offered, not demanded.
    expect(plan.requiredCapabilities).toEqual(['LLM_API_KEY'])
  })

  it('threads an interpolated schedule command onto the deploy plan', () => {
    const manifest = `
name: coding-agent
kind: agent
intent: Code on {{repo}}.
params:
  - name: repo
    type: string
    required: true
schedules:
  - cron: "*/10 * * * *"
    command: apes agents code --poll-label agent --repo {{repo}}
    description: Poll {{repo}} for issues.
`
    const r = parseRecipe(manifest)
    if (!r.ok) throw new Error(r.reason)
    const mat = materializeRecipe(r.value, { repo: 'x/y' })
    if (!mat.ok) throw new Error(mat.reason)
    // materialize interpolates the command's {{repo}} placeholder
    expect(mat.value.schedules[0]!.command).toBe('apes agents code --poll-label agent --repo x/y')
    const plan = buildDeployPlan(r.value, mat.value)
    expect(plan.schedules[0]!.command).toBe('apes agents code --poll-label agent --repo x/y')
  })

  it('leaves command undefined for chat-style schedules', () => {
    const rec = recipe()
    const mat = materializeRecipe(rec, { topic: 'x' })
    if (!mat.ok) throw new Error(mat.reason)
    expect(buildDeployPlan(rec, mat.value).schedules[0]!.command).toBeUndefined()
  })

  it('honours an agent-name override + additive userAddendum (recipe is additive to a named spawn)', () => {
    const rec = recipe()
    const mat = materializeRecipe(rec, { topic: 'AI agents' })
    if (!mat.ok) throw new Error(mat.reason)
    const plan = buildDeployPlan(rec, mat.value, { agentName: 'my-own-name', userAddendum: 'Focus on negatives.' })
    expect(plan.agentName).toBe('my-own-name')
    expect(plan.systemPrompt).toBe('Summarize the Bluesky feed about AI agents.')
    expect(plan.userAddendum).toBe('Focus on negatives.')
  })

  it('omits userAddendum when none is given (back-compat with the M4 CLI path)', () => {
    const rec = recipe()
    const mat = materializeRecipe(rec, { topic: 'x' })
    if (!mat.ok) throw new Error(mat.reason)
    expect(buildDeployPlan(rec, mat.value).userAddendum).toBeUndefined()
  })

  it('carries recipeRef through when provided', () => {
    const rec = recipe()
    const mat = materializeRecipe(rec, { topic: 'AI agents' })
    if (!mat.ok) throw new Error(mat.reason)
    const plan = buildDeployPlan(rec, mat.value, { recipeRef: 'owner/name@v1.0.0' })
    expect(plan.recipeRef).toBe('owner/name@v1.0.0')
  })

  it('omits recipeRef when not given', () => {
    const rec = recipe()
    const mat = materializeRecipe(rec, { topic: 'x' })
    if (!mat.ok) throw new Error(mat.reason)
    expect(buildDeployPlan(rec, mat.value).recipeRef).toBeUndefined()
  })

  it('caps the agent name at the spawn-intent slug limit', () => {
    const rec = { ...recipe(), name: 'a-very-long-recipe-name-way-over-limit' }
    const mat = materializeRecipe(rec, { topic: 'x' })
    if (!mat.ok) throw new Error(mat.reason)
    expect(buildDeployPlan(rec, mat.value).agentName.length).toBeLessThanOrEqual(24)
  })
})

describe('fetchRecipeManifest', () => {
  it('resolves a catalog subdirectory to <owner>/<name>/<ref>/<subdir>/ape-agent.yaml', async () => {
    let url = ''
    const r = await fetchRecipeManifest('github.com/openape-ai/agent-catalog/ceo@v0.1.0', async (u) => {
      url = u
      return { ok: true, status: 200, text: MANIFEST }
    })
    expect(url).toBe('https://raw.githubusercontent.com/openape-ai/agent-catalog/v0.1.0/ceo/ape-agent.yaml')
    expect(r.ok).toBe(true)
  })

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

  it('rejects a path-traversal subdir (no fetch)', async () => {
    let fetched = false
    const r = await fetchRecipeManifest('github.com/openape-ai/agent-catalog/../../etc@v1.0.0', async () => { fetched = true; return { ok: true, status: 200, text: '' } })
    expect(r.ok).toBe(false)
    expect(fetched).toBe(false)
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
