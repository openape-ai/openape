// Vitest stub for `nitropack/runtime`. The store utils import `useDb` (which
// imports useRuntimeConfig from nitropack/runtime) at module level, but the
// store tests inject their own in-memory db and never call useDb — so this
// only needs to be importable, never correct.
export function useRuntimeConfig(): Record<string, unknown> {
  return {}
}
