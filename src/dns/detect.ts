export type Runtime = 'node' | 'deno' | 'bun' | 'edge' | 'browser'

declare const Deno: { resolveDns?: unknown } | undefined
declare const Bun: unknown | undefined

export function detectRuntime(): Runtime {
  if (typeof Deno !== 'undefined' && Deno?.resolveDns) {
    return 'deno'
  }
  if (typeof Bun !== 'undefined') {
    return 'bun'
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      if (typeof require !== 'undefined') {
        require.resolve('dns')
        return 'node'
      }
    }
    catch {
      // dns module not available
    }
    return 'edge'
  }
  if (typeof globalThis !== 'undefined' && 'document' in globalThis) {
    return 'browser'
  }
  return 'edge'
}
