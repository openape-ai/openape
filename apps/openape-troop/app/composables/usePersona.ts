import { getPersona } from '~/server/utils/persona-catalog'

/**
 * Look up a persona by its key (e.g., "backend-engineer").
 * Returns the persona with title and icon, or undefined if not found.
 */
export function usePersona(key: string | null | undefined) {
  return getPersona(key)
}
