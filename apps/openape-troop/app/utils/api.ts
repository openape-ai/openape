import type { NitroFetchOptions } from 'nitropack'

/**
 * `$fetch` with dynamic (template-literal) URLs blows Nuxt's typed-route
 * inference, which is why the app grew 69 scattered `($fetch as any)` casts.
 * This is the one deliberate widening that replaces them: callers pass the
 * expected response type instead of casting the function.
 */
export const apiFetch = $fetch as <T = unknown>(url: string, opts?: NitroFetchOptions<string>) => Promise<T>
