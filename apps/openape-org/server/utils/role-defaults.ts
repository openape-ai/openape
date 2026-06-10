// Per-role spawn defaults: which Recipe ref + which params + which
// system-prompt fallback every newly-spawned member of a given role
// should get on troop. Owner can override at spawn-time via a future
// UI surface; for v1 the chart "Spawn agent" button uses these as
// the one-click default.
//
// Keep this file as the *single source of truth* — both the spawn
// API and any future chart "what will this spawn produce?" preview
// read it.

export interface RoleDefaults {
  /**
   * Optional Recipe @ref (github.com/owner/repo@tag). When omitted,
   *  the spawn uses no recipe and falls back to systemPrompt.
   */
  recipeRef?: string
  /**
   * Recipe params (only used when recipeRef is set). Can include
   *  template variables {{org_id}} / {{org_name}} which the spawn
   *  endpoint substitutes from the actual organization.
   */
  recipeParams?: Record<string, string>
  /**
   * Free-text system prompt — used when there's no recipe, or as
   *  the user_addendum on top of a recipe's intent.
   */
  systemPrompt?: string
}

export function getRoleDefaults(role: string): RoleDefaults {
  switch (role) {
    case 'ceo':
      return {
        // Published standalone (the nest checkout needs a public repo with a
        // pinned ref) — authored from examples/agent-recipes/ceo.
        recipeRef: 'github.com/openape-ai/agent-catalog/ceo@v0.1.0',
        recipeParams: { org_id: '{{org_id}}', org_name: '{{org_name}}' },
      }

    // Sanierer recipe not yet authored (plan 01KSYCHBQ7WNE5GS338PH89DFM M3).
    // Until then, spawn with a role-defining system prompt.
    case 'sanierer':
      return {
        systemPrompt: `Du bist der Sanierer für {{org_name}} (org_id={{org_id}}).
Deine einzige Aufgabe: das Budget und Output/Cost-Ratio dieser Organisation überwachen und dem Owner direkt berichten — nie über den CEO. Lies LiteLLM-Kostenlogs + org.openape.ai/api/orgs/{{org_id}}/cost-snapshots. Bei Schwellenüberschreitung sofort den Owner alarmieren.`,
      }

    case 'teamlead':
      return {
        systemPrompt: `Du bist Teamlead in {{org_name}} (org_id={{org_id}}).
Deine Aufgabe: Decomposition + Delegation + Status. KEINE technischen Design-Entscheidungen — die gehören dem Implementer. Lies vom CEO zugewiesene Objectives, brich sie in Stories runter, weise sie an Specialists zu, reporte Status zurück an den CEO.`,
      }

    case 'specialist':
      return {
        systemPrompt: `Du bist Specialist in {{org_name}} (org_id={{org_id}}).
Deine Aufgabe: Stories ausführen die dir der Teamlead zuweist. Lies bei jeder Story zuerst die CONTRIBUTING.md des betroffenen Repos. Mach kleine, fokussierte Edits + verifizier. Eskalier an den Teamlead wenn unklar.`,
      }

    default:
      return {}
  }
}

/**
 * Substitute {{org_id}} / {{org_name}} placeholders in a defaults
 *  object so the same RoleDefaults shape is usable for any org.
 */
export function instantiateRoleDefaults(
  defaults: RoleDefaults,
  ctx: { org_id: string, org_name: string },
): RoleDefaults {
  function sub(s?: string) {
    if (!s) return s
    return s.replace(/\{\{org_id\}\}/g, ctx.org_id).replace(/\{\{org_name\}\}/g, ctx.org_name)
  }
  return {
    recipeRef: defaults.recipeRef,
    recipeParams: defaults.recipeParams
      ? Object.fromEntries(Object.entries(defaults.recipeParams).map(([k, v]) => [k, sub(v)!]))
      : undefined,
    systemPrompt: sub(defaults.systemPrompt),
  }
}
