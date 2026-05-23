import type { AgentRecipe, MaterializedRecipe } from './agent-recipe'
import { parseRecipe, parseRepoRef } from './agent-recipe'

// Deploy-flow core: turn a validated + param-materialized recipe (M1)
// into the concrete things troop applies to a freshly-spawned agent —
// its system prompt (the intent), its scheduled task rows, and the
// list of capability envs the owner still has to bind (M2c). Pure +
// unit-tested; the endpoint wires it to spawn-intent + the DB. See
// plans.openape.ai 01KRTAE8 (M3).

// Recipe agents drive everything through the built-in toolset — the
// repo's tools/ scripts are invoked via bash; http/file/time round it
// out. Owners can narrow later in the troop UI.
export const RECIPE_AGENT_TOOLS = ['bash', 'http', 'file', 'time'] as const

export interface DeploySchedule {
  taskId: string
  name: string
  cron: string
  userPrompt: string
  /** Deterministic shell command (gated ape-shell, no LLM). Optional. */
  command?: string
  tools: string[]
}

export interface DeployPlan {
  agentName: string
  systemPrompt: string
  /**
   * Optional free-text behaviour layer the owner typed alongside the
   * recipe. Applied as the agent's user_addendum (M5) so the recipe
   * intent stays the immutable base and the owner's prompt is purely
   * additive — no special-casing, recipe + spawn coexist.
   */
  userAddendum?: string
  schedules: DeploySchedule[]
  requiredCapabilities: string[]
}

function agentNameFromRecipe(name: string): string {
  // recipe.name is already kebab (M1); spawn-intent caps the slug at
  // 24 chars ([a-z][a-z0-9-]{0,23}).
  return name.slice(0, 24).replace(/-+$/, '')
}

/**
 * Map a materialized recipe to its deploy plan. `mat.intent` is the
 * fully-interpolated system prompt; each manifest schedule becomes a
 * task whose user prompt is the (interpolated) schedule description or
 * a sensible default.
 */
export interface DeployPlanOptions {
  /** Use this agent name instead of deriving it from the recipe (the
   *  owner named the agent in the spawn dialog — recipe is additive). */
  agentName?: string
  /** Free-text prompt the owner added; becomes the agent's
   *  user_addendum on top of the recipe intent. */
  userAddendum?: string
}

export function buildDeployPlan(recipe: AgentRecipe, mat: MaterializedRecipe, opts: DeployPlanOptions = {}): DeployPlan {
  const schedules: DeploySchedule[] = mat.schedules.map((s, i) => ({
    taskId: `recipe-${i}`,
    name: s.description ?? s.command ?? `${recipe.name} #${i + 1}`,
    cron: s.cron,
    userPrompt: s.description ?? 'Run your configured task as described in your instructions.',
    ...(s.command ? { command: s.command } : {}),
    tools: [...RECIPE_AGENT_TOOLS],
  }))
  return {
    agentName: opts.agentName ? agentNameFromRecipe(opts.agentName) : agentNameFromRecipe(recipe.name),
    systemPrompt: mat.intent,
    ...(opts.userAddendum ? { userAddendum: opts.userAddendum } : {}),
    schedules,
    requiredCapabilities: recipe.capabilities.filter(c => !c.optional).map(c => c.env),
  }
}

export type FetchManifest = (rawUrl: string) => Promise<{ ok: boolean, status: number, text: string }>

/**
 * Resolve `<repo>@<ref>` to the GitHub raw URL of its `ape-agent.yaml`
 * and fetch it. Ref-pin is enforced by parseRepoRef (M1): a floating
 * ref is rejected before any network call. `repo` may be
 * `github.com/owner/name` or `owner/name`.
 */
export async function fetchRecipeManifest(
  spec: string,
  fetchImpl: FetchManifest,
): Promise<{ ok: true, recipe: AgentRecipe, ref: string } | { ok: false, reason: string }> {
  const ref = parseRepoRef(spec)
  if (!ref.ok) return { ok: false, reason: ref.reason }
  let host = ref.value.repo.replace(/^https?:\/\//, '').replace(/\.git$/, '')
  if (host.startsWith('github.com/')) {
    host = host.slice('github.com/'.length)
  }
  else {
    // A leading segment with a dot means a host other than github.com
    // (gitlab.com/…, etc.) — not supported in v1.
    const slash = host.indexOf('/')
    if (slash > 0 && host.slice(0, slash).includes('.')) {
      return { ok: false, reason: `unsupported repo "${ref.value.repo}" — expected github.com/<owner>/<name>` }
    }
  }
  const slug = host
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) {
    return { ok: false, reason: `unsupported repo "${ref.value.repo}" — expected github.com/<owner>/<name>` }
  }
  const rawUrl = `https://raw.githubusercontent.com/${slug}/${ref.value.ref}/ape-agent.yaml`
  let res: Awaited<ReturnType<FetchManifest>>
  try {
    res = await fetchImpl(rawUrl)
  }
  catch (e) {
    return { ok: false, reason: `fetch failed: ${(e as Error).message}` }
  }
  if (!res.ok) {
    return { ok: false, reason: `manifest not found at ${slug}@${ref.value.ref} (HTTP ${res.status})` }
  }
  const parsed = parseRecipe(res.text)
  if (!parsed.ok) return { ok: false, reason: `invalid ape-agent.yaml: ${parsed.reason}` }
  return { ok: true, recipe: parsed.value, ref: ref.value.ref }
}
