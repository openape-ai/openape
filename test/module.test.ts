import { describe, expect, it, vi } from 'vitest'

// Capture the setup function passed to defineNuxtModule
let capturedSetup: (options: any, nuxt: any) => void
let capturedDefaults: Record<string, unknown>

vi.mock('@nuxt/kit', () => ({
  defineNuxtModule: (def: any) => {
    capturedSetup = def.setup
    capturedDefaults = def.defaults || {}
    return {
      getMeta: () => Promise.resolve(def.meta || {}),
      defaults: capturedDefaults,
    }
  },
  createResolver: () => ({ resolve: (p: string) => p }),
  addServerHandler: vi.fn(),
  addImportsDir: vi.fn(),
  addServerImportsDir: vi.fn(),
  extendPages: vi.fn(),
}))

// Import module to trigger defineNuxtModule and capture setup
import('../src/module')

function buildNuxtStub() {
  return {
    options: {
      runtimeConfig: {},
      routeRules: {},
    },
  }
}

function runModuleSetup(options: Record<string, unknown> = {}) {
  const nuxt = buildNuxtStub()
  const mergedOptions = { ...capturedDefaults, ...options }
  capturedSetup(mergedOptions, nuxt)
  return nuxt
}

describe('nuxt-auth-idp module', () => {
  it('exposes expected metadata', async () => {
    const mod = await import('../src/module')
    const meta = await mod.default.getMeta()
    expect(meta.name).toBe('@openape/nuxt-auth-idp')
    expect(meta.configKey).toBe('openapeIdp')
  })

  it('adds X-Content-Type-Options header', () => {
    const nuxt = runModuleSetup()
    const rules = nuxt.options.routeRules as Record<string, any>
    expect(rules['/**']?.headers?.['X-Content-Type-Options']).toBe('nosniff')
  })

  it('adds X-Frame-Options header', () => {
    const nuxt = runModuleSetup()
    const rules = nuxt.options.routeRules as Record<string, any>
    expect(rules['/**']?.headers?.['X-Frame-Options']).toBe('DENY')
  })

  it('adds CSP frame-ancestors header', () => {
    const nuxt = runModuleSetup()
    const rules = nuxt.options.routeRules as Record<string, any>
    expect(rules['/**']?.headers?.['Content-Security-Policy']).toContain('frame-ancestors')
  })
})
