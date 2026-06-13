import { PERSONA_CATEGORIES, PERSONAS } from '../utils/persona-catalog'

// Public catalog of company personas the Owner can pick from when adding a
// member. Mirrors the agent-catalog recipes; spawn-member deploys the matching
// recipe. No org context needed — this is static catalog metadata.
export default defineEventHandler(() => {
  return {
    categories: PERSONA_CATEGORIES,
    personas: PERSONAS.map(p => ({
      key: p.key,
      title: p.title,
      role: p.role,
      category: p.category,
      icon: p.icon,
      summary: p.summary,
      coding: p.coding,
    })),
  }
})
