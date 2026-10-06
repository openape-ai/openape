import type { NitroFetchOptions } from 'nitropack'

/**
 * `$fetch` mit Template-Literal-URLs sprengt Nuxts typisierte Routen-Inferenz.
 * This one deliberate widening replaces casts scattered everywhere: the caller gives
 * den erwarteten Antworttyp an.
 */
export const apiFetch = $fetch as <T = unknown>(url: string, opts?: NitroFetchOptions<string>) => Promise<T>
