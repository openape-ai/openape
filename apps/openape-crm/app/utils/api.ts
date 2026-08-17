import type { NitroFetchOptions } from 'nitropack'

/**
 * `$fetch` mit Template-Literal-URLs sprengt Nuxts typisierte Routen-Inferenz.
 * Diese eine bewusste Aufweitung ersetzt verstreute Casts: der Aufrufer gibt
 * den erwarteten Antworttyp an.
 */
export const apiFetch = $fetch as <T = unknown>(url: string, opts?: NitroFetchOptions<string>) => Promise<T>
