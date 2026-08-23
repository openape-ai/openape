import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

// Route inventory vs. dead-by-shadowing (#1045 idea 2; class found in #1043).
//
// The module serves its routes via `addServerHandler`. A consumer app that
// ALSO ships `server/api/<same route>.ts` produces two handlers for one path,
// and one of them never answers a request. No import graph reveals it: knip
// treats every `server/api/**` file as an entrypoint (Nuxt: file = route), so
// troop's shadowed `/api/cli/exchange` stayed dead in production for months.
// Comparing the two inventories catches the class structurally and cheaply.
//
// Overriding a module route from an app is a legitimate, used pattern — so a
// duplicate is not automatically a defect. It has to be a DECIDED one: every
// pair is declared below with its reason, and anything undeclared fails here.

// Capture the setup passed to defineNuxtModule (harness copied from
// nuxt-auth-idp's module.test.ts) so registrations come from the real module
// code rather than a regex over its source.
let capturedSetup: (options: any, nuxt: any) => void
let capturedDefaults: Record<string, unknown>

vi.mock('@nuxt/kit', () => ({
  defineNuxtModule: (def: any) => {
    capturedSetup = def.setup
    capturedDefaults = def.defaults || {}
    return { getMeta: () => Promise.resolve(def.meta || {}), defaults: capturedDefaults }
  },
  createResolver: () => ({ resolve: (p: string) => p }),
  useLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  addServerHandler: vi.fn(),
  addServerPlugin: vi.fn(),
  addImportsDir: vi.fn(),
  addComponentsDir: vi.fn(),
  addServerImportsDir: vi.fn(),
}))

/**
 * Reviewed app-over-module duplicates, keyed `<app> <METHOD> <path>`.
 * Add an entry only with the reason why both handlers may coexist; an
 * undeclared duplicate — and a declared one that is gone — fails the test.
 */
const DECLARED_DUPLICATES: Record<string, string> = {
  'openape-troop GET /.well-known/openape.json':
    'deliberate override: injects TROOP_SCOPES into the manifest without forking the module (see the file header)',
  'openape-chat POST /api/cli/exchange':
    're-exports the module factory createCliExchangeHandler(), so both handlers behave identically — removal tracked in #1305',
}

interface Route { method: string, path: string, source: string }

/** `undefined`/`*` means "every method" — Nuxt matches such a handler for all. */
const ANY = '*'

function methodsCollide(a: string, b: string): boolean {
  return a === ANY || b === ANY || a === b
}

/** The registrations the module actually performs, via the mocked @nuxt/kit. */
async function moduleRoutes(): Promise<Route[]> {
  await import('../src/module')
  const kit = await import('@nuxt/kit')
  capturedSetup({ ...capturedDefaults }, { options: { dev: false, runtimeConfig: {}, routeRules: {} } })
  return vi.mocked(kit.addServerHandler).mock.calls.map(([handler]) => ({
    method: (handler.method ?? ANY).toLowerCase(),
    path: handler.route!,
    source: '@openape/nuxt-auth-sp',
  }))
}

/** Every `server/<sub>/**` file of an app as a route, `[param]` → `:param`. */
function fileRoutes(appDir: string, sub: 'api' | 'routes', prefix: string): Route[] {
  const root = join(appDir, 'server', sub)
  if (!existsSync(root)) return []
  const routes: Route[] = []
  const walk = (dir: string, at: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full, `${at}/${entry}`)
        continue
      }
      if (entry.endsWith('.d.ts')) continue
      const m = /^(.*?)(?:\.(get|post|put|patch|delete))?\.ts$/.exec(entry)
      if (!m) continue
      const segment = m[1] === 'index' ? '' : `/${m[1]}`
      routes.push({
        method: m[2] ?? ANY,
        path: `${at}${segment}`.replace(/\[(\w+)\]/g, ':$1'),
        source: full,
      })
    }
  }
  walk(root, prefix)
  return routes
}

/** Apps in this monorepo that declare a dependency on the module. */
function consumerApps(): string[] {
  const appsDir = fileURLToPath(new URL('../../../apps', import.meta.url))
  return readdirSync(appsDir)
    .map(name => join(appsDir, name))
    .filter((dir) => {
      const pkg = join(dir, 'package.json')
      return existsSync(pkg) && readFileSync(pkg, 'utf8').includes('"@openape/nuxt-auth-sp"')
    })
}

/** Keys of the module routes this app also defines itself. */
function duplicatesOf(appDir: string, registered: Route[]): string[] {
  const app = basename(appDir)
  const own = [...fileRoutes(appDir, 'api', '/api'), ...fileRoutes(appDir, 'routes', '')]
  return own
    .filter(o => registered.some(m => m.path === o.path && methodsCollide(m.method, o.method)))
    .map(o => `${app} ${o.method.toUpperCase()} ${o.path}`)
    .sort()
}

const registered = await moduleRoutes()
const apps = consumerApps()

describe('nuxt-auth-sp route inventory', () => {
  it('reads the registrations from the module, not from a stale copy', () => {
    // Guards the harness itself: a silently empty inventory would make every
    // shadowing assertion below pass vacuously.
    expect(registered.length).toBeGreaterThanOrEqual(9)
    expect(registered).toContainEqual({ method: 'post', path: '/api/cli/exchange', source: '@openape/nuxt-auth-sp' })
    expect(registered.map(r => r.path)).toContain('/.well-known/openape.json')
  })

  it('registers each route+method exactly once', () => {
    const seen = registered.map(r => `${r.method} ${r.path}`)
    expect(seen).toEqual([...new Set(seen)])
  })

  it('finds the consumer apps to check', () => {
    expect(apps.length).toBeGreaterThan(0)
  })

  it('declares no duplicate that no longer exists', () => {
    const found = apps.flatMap(dir => duplicatesOf(dir, registered))
    // Keeps the register honest: once an app copy is deleted, its entry goes too.
    expect(Object.keys(DECLARED_DUPLICATES).sort()).toEqual(found.sort())
  })
})

describe.each(apps.map(dir => [basename(dir), dir] as const))('%s', (_app, appDir) => {
  it('shadows no module route that is not declared', () => {
    // Every duplicate is dead code on one side — whichever handler loses is
    // never reached. Delete the app copy, opt out of the module route
    // (`openapeSp.routes: false`), or declare it in DECLARED_DUPLICATES.
    const undeclared = duplicatesOf(appDir, registered).filter(key => !(key in DECLARED_DUPLICATES))
    expect(undeclared).toEqual([])
  })
})
